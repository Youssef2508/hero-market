const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const rootDir = path.join(__dirname, '..')
// Windows uses the bundled sqlite3.exe; other platforms (CI/Docker) use sqlite3 from PATH.
const sqlitePath =
  process.env.SQLITE3_BIN ||
  (process.platform === 'win32' ? path.join(rootDir, 'sqlite3.exe') : 'sqlite3')
// Source database to copy. Order: TEST_SOURCE_DB → the local installed DB (Windows) →
// a freshly bootstrapped schema + sample data (scripts/init-dev-db.js).
const installedDbPath = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'elnagdi-pos', 'market_unified.db')
  : null
const testDbPath = path.join(__dirname, 'temp_test.db')

// Execute SQL queries on the test database
function executeSql(q) {
  return new Promise((resolve, reject) => {
    const child = spawn(sqlitePath, [testDbPath, '-json'])
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString('utf8')))
    child.stderr.on('data', (d) => (err += d.toString('utf8')))
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err || `Exit code ${code}`))
      else resolve(out.trim() ? JSON.parse(out.trim()) : [])
    })
    // Prepend PRAGMA foreign_keys = ON; to enforce constraints during tests
    child.stdin.write(`PRAGMA foreign_keys = ON;\n${q}`)
    child.stdin.end()
  })
}

// Function to copy production db to test db
function resolveSourceDb() {
  if (process.env.TEST_SOURCE_DB) return process.env.TEST_SOURCE_DB
  if (process.env.TEST_FRESH_DB !== '1' && installedDbPath && fs.existsSync(installedDbPath))
    return installedDbPath
  return null
}

async function setupTestDb() {
  cleanupTestDb()
  const source = resolveSourceDb()
  if (source) {
    if (!fs.existsSync(source)) throw new Error(`Source database not found at ${source}`)
    fs.copyFileSync(source, testDbPath)
    console.log(`[TEST DB] Copied ${source} to ${testDbPath}`)
  } else {
    const { execFileSync } = require('child_process')
    execFileSync(
      process.execPath,
      [path.join(rootDir, 'scripts', 'init-dev-db.js'), '--db', testDbPath, '--reset'],
      {
        stdio: 'inherit',
        env: { ...process.env, SQLITE3_BIN: sqlitePath }
      }
    )
    console.log(`[TEST DB] Bootstrapped a fresh database at ${testDbPath}`)
  }

  // Migrate sale_items table to ensure it has cost_price column in tests
  try {
    await executeSql(`ALTER TABLE sale_items ADD COLUMN cost_price REAL DEFAULT 0.0;`)
  } catch (e) {
    /* Ignore if already exists */
  }

  // Register the new triggers on the test DB in a single SQL execution to prevent lockups
  await executeSql(`
    CREATE TRIGGER IF NOT EXISTS prevent_negative_stock
    BEFORE UPDATE OF stock_qty ON products
    FOR EACH ROW
    WHEN NEW.stock_qty < 0
    BEGIN
      SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن أن تقل كمية المخزون عن صفر (نفاد الكمية).');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_sale_on_closed_shift
    BEFORE INSERT ON sales
    FOR EACH ROW
    WHEN (SELECT status FROM shifts WHERE id = NEW.shift_id) = 'closed'
    BEGIN
      SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن تسجيل عملية بيع على وردية مغلقة.');
    END;

    CREATE TRIGGER IF NOT EXISTS prevent_multiple_open_shifts
    BEFORE INSERT ON shifts
    FOR EACH ROW
    WHEN NEW.status = 'open' AND (SELECT COUNT(*) FROM shifts WHERE user_id = NEW.user_id AND status = 'open') > 0
    BEGIN
      SELECT RAISE(ROLLBACK, 'خطأ: يوجد وردية مفتوحة بالفعل لهذا المستخدم.');
    END;
  `)
  console.log(
    `[TEST DB] Registered triggers (prevent_negative_stock, prevent_sale_on_closed_shift, prevent_multiple_open_shifts) on test DB.`
  )
}

// Function to clean up test db
function cleanupTestDb() {
  for (const f of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
    if (fs.existsSync(f)) {
      try {
        fs.unlinkSync(f)
      } catch (err) {
        // On Windows, child processes might hold the handle for a few milliseconds
        try {
          setTimeout(() => {
            try {
              if (fs.existsSync(f)) fs.unlinkSync(f)
            } catch (_) {}
          }, 100)
        } catch (_) {}
      }
    }
  }
  console.log(`[TEST DB] Cleaned up temporary test database.`)
}

module.exports = {
  setupTestDb,
  cleanupTestDb,
  executeSql,
  testDbPath
}
