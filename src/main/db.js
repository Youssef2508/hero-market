import { spawn } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

const isDev = !app.isPackaged

// Resolve the sqlite3.exe binary path
const sqlitePath = isDev
  ? path.join(process.cwd(), 'sqlite3.exe')
  : path.join(process.resourcesPath, 'sqlite3.exe')

// Resolve the database path (Testing Sandbox Instance).
// HEROMARKET_DB_PATH lets QA/automation point a dev session at a disposable copy;
// it is ignored in packaged builds.
const devDbPath = process.env.HEROMARKET_DB_PATH
  ? path.resolve(process.env.HEROMARKET_DB_PATH)
  : path.join(process.cwd(), 'market_unified_testing.db')
const prodDbPath = path.join(app.getPath('userData'), 'market_unified.db')
export const dbPath = isDev ? devDbPath : prodDbPath

export async function initializeDatabase() {
  console.log('Database Path:', dbPath)
  console.log('SQLite Bin Path:', sqlitePath)

  if (!isDev) {
    if (!fs.existsSync(prodDbPath)) {
      const sourceDbPath = path.join(process.resourcesPath, 'market_unified.db')
      if (fs.existsSync(sourceDbPath)) {
        try {
          fs.copyFileSync(sourceDbPath, prodDbPath)
          console.log('Successfully copied base database to userData directory.')
        } catch (e) {
          console.error('Failed to copy base database:', e)
        }
      }
    }
  }

  // Create tables and migrations
  try {
    // Enable WAL mode for concurrent read/write and crash resilience
    try {
      await executeSql('PRAGMA journal_mode=WAL;')
      console.log('[DB] SQLite WAL mode activated successfully.')
    } catch (walErr) {
      console.error('[DB] Failed to enable WAL mode:', walErr)
    }

    await executeSql(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        address TEXT,
        debt_balance REAL DEFAULT 0.0,
        points INTEGER DEFAULT 0,
        created_at TEXT
      );
    `)
    await executeSql(`
      CREATE TABLE IF NOT EXISTS client_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        type TEXT,
        amount REAL,
        description TEXT,
        timestamp TEXT,
        FOREIGN KEY(client_id) REFERENCES clients(id)
      );
    `)
    // --- Suppliers Module ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        address TEXT,
        contact_person TEXT,
        debt_balance REAL DEFAULT 0.0,
        created_at TEXT
      );
    `)
    await executeSql(`
      CREATE TABLE IF NOT EXISTS supplier_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        timestamp TEXT,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
      );
    `)
    await executeSql(`
      CREATE TABLE IF NOT EXISTS supplier_purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL,
        invoice_ref TEXT,
        total_amount REAL NOT NULL,
        paid_amount REAL DEFAULT 0.0,
        remaining REAL DEFAULT 0.0,
        payment_type TEXT DEFAULT 'آجل',
        timestamp TEXT,
        notes TEXT,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
      );
    `)
    // --- Checks Register ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS checks_register (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_type TEXT NOT NULL,
        check_number TEXT,
        bank_name TEXT,
        party_name TEXT NOT NULL,
        issue_date TEXT,
        due_date TEXT NOT NULL,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'غير مسدد',
        notes TEXT,
        created_at TEXT
      );
    `)
    // --- Expenses Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER,
        amount REAL NOT NULL,
        category TEXT,
        description TEXT,
        timestamp TEXT
      );
    `)
    // --- Damaged Goods Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS damaged_goods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER,
        product_barcode TEXT NOT NULL,
        quantity REAL NOT NULL,
        reason TEXT,
        cost_price REAL NOT NULL,
        timestamp TEXT,
        FOREIGN KEY(product_barcode) REFERENCES products(barcode)
      );
    `)
    // Settings Table
    await executeSql(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    // --- Shift Audits Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS shift_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER,
        timestamp TEXT NOT NULL,
        expected_cash REAL NOT NULL,
        actual_cash REAL NOT NULL,
        difference REAL NOT NULL,
        notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id)
      );
    `)

    // --- System Logs / Event Log Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user_id INTEGER,
        username TEXT,
        action_type TEXT NOT NULL,
        description TEXT,
        details TEXT
      );
    `)

    // --- Momkn Transactions Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS momkn_transactions (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id        INTEGER NOT NULL,
        timestamp       TEXT NOT NULL,
        operation_type  TEXT NOT NULL,
        description     TEXT,
        digital_impact  REAL NOT NULL,
        cash_impact     REAL NOT NULL,
        commission      REAL DEFAULT 0.0,
        notes           TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id)
      );
    `)

    // --- Mobile Money / Wallets Transactions Table ---
    await executeSql(`
      CREATE TABLE IF NOT EXISTS mobile_money_transactions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id         INTEGER NOT NULL,
        timestamp        TEXT NOT NULL,
        platform         TEXT NOT NULL,
        operation_type   TEXT NOT NULL,
        digital_impact   REAL NOT NULL,
        cash_impact      REAL NOT NULL,
        commission       REAL DEFAULT 0.0,
        recipient_name   TEXT,
        phone_or_account TEXT,
        notes            TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id)
      );
    `)

    await executeSql(`
      CREATE TABLE IF NOT EXISTS safe_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(shift_id) REFERENCES shifts(id)
      );
    `)

    // Performance optimization: foreign key indices
    try {
      await executeSql(`
        CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(shift_id);
        CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales(client_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_barcode ON sale_items(product_barcode);
        CREATE INDEX IF NOT EXISTS idx_safe_ledger_shift_id ON safe_ledger(shift_id);
        CREATE INDEX IF NOT EXISTS idx_client_ledger_client_id ON client_ledger(client_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id ON supplier_ledger(supplier_id);
      `)
      console.log('[DB] Installed performance indices on foreign keys.')
    } catch (e) {
      console.error('Failed to create performance indices:', e)
    }

    await executeSql(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('store_name', 'هيرو ماركت');
    `)
    await executeSql(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('branch_name', 'الفرع الرئيسي');
    `)
    await executeSql(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('printer_name', 'CITIZEN CT-S300');
    `)
    // Migrations for existing tables
    try {
      await executeSql(`ALTER TABLE sales ADD COLUMN client_id INTEGER REFERENCES clients(id);`)
      console.log('[DB] Migrated sales table: added client_id column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE shifts ADD COLUMN momkn_start_balance REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated shifts table: added momkn_start_balance column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE shifts ADD COLUMN momkn_start_cash REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated shifts table: added momkn_start_cash column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE shifts ADD COLUMN vfcash_start_balance REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated shifts table: added vfcash_start_balance column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE shifts ADD COLUMN vfcash_start_cash REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated shifts table: added vfcash_start_cash column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE sale_items ADD COLUMN cost_price REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated sale_items table: added cost_price column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`ALTER TABLE sales ADD COLUMN original_amount REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated sales table: added original_amount column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    try {
      await executeSql(`
        UPDATE sales 
        SET original_amount = IFNULL((
          SELECT SUM(si.quantity * si.unit_price) 
          FROM sale_items si 
          WHERE si.sale_id = sales.id
        ), total_amount) - discount
        WHERE original_amount = 0 OR original_amount IS NULL;
      `)
      console.log('[DB] Migrated sales table: populated original_amount for past sales.')
    } catch (e) {
      /* Ignore if already populated */
    }

    try {
      await executeSql(`ALTER TABLE sale_items ADD COLUMN returned_qty REAL DEFAULT 0.0;`)
      console.log('[DB] Migrated sale_items table: added returned_qty column.')
    } catch (e) {
      /* Ignore if column already exists */
    }

    // Enforce database-level triggers for integrity
    try {
      await executeSql(`
        CREATE TRIGGER IF NOT EXISTS prevent_negative_stock
        BEFORE UPDATE OF stock_qty ON products
        FOR EACH ROW
        WHEN NEW.stock_qty < 0
        BEGIN
          SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن أن تقل كمية المخزون عن صفر (نفاد الكمية).');
        END;
      `)
      console.log('[DB] Installed trigger: prevent_negative_stock')
    } catch (e) {
      console.error('Failed to create trigger prevent_negative_stock:', e)
    }

    try {
      await executeSql(`
        CREATE TRIGGER IF NOT EXISTS prevent_sale_on_closed_shift
        BEFORE INSERT ON sales
        FOR EACH ROW
        WHEN (SELECT status FROM shifts WHERE id = NEW.shift_id) = 'closed'
        BEGIN
          SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن تسجيل عملية بيع على وردية مغلقة.');
        END;
      `)
      console.log('[DB] Installed trigger: prevent_sale_on_closed_shift')
    } catch (e) {
      console.error('Failed to create trigger prevent_sale_on_closed_shift:', e)
    }

    try {
      await executeSql(`
        CREATE TRIGGER IF NOT EXISTS prevent_multiple_open_shifts
        BEFORE INSERT ON shifts
        FOR EACH ROW
        WHEN NEW.status = 'open' AND (SELECT COUNT(*) FROM shifts WHERE user_id = NEW.user_id AND status = 'open') > 0
        BEGIN
          SELECT RAISE(ROLLBACK, 'خطأ: يوجد وردية مفتوحة بالفعل لهذا المستخدم.');
        END;
      `)
      console.log('[DB] Installed trigger: prevent_multiple_open_shifts')
    } catch (e) {
      console.error('Failed to create trigger prevent_multiple_open_shifts:', e)
    }

    console.log('[DB] Database tables initialized successfully settings.')
  } catch (err) {
    console.error('[DB] Database initialization error:', err)
  }
}

export function executeSql(sqlQuery) {
  return new Promise((resolve, reject) => {
    // Spawn sqlite3.exe CLI with -json flag
    const child = spawn(sqlitePath, [dbPath, '-json'])

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8')
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8')
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `sqlite3 exited with code ${code}`))
        return
      }
      try {
        const trimmed = stdout.trim()
        if (!trimmed) {
          resolve([])
          return
        }
        const matches = trimmed.match(/\[[\s\S]*?\]/g)
        if (matches && matches.length > 0) {
          // Filter out PRAGMA busy_timeout output
          const validMatches = matches.filter((m) => !m.includes('{"timeout":10000}'))

          if (validMatches.length > 0) {
            const lastMatch = validMatches[validMatches.length - 1]
            const result = JSON.parse(lastMatch)
            resolve(result)
          } else {
            resolve([])
          }
        } else {
          resolve([])
        }
      } catch (e) {
        console.error('SQL Execution JSON Parse Error:', e.message, 'Raw stdout:', stdout)
        reject(e)
      }
    })

    // Prepend PRAGMA foreign_keys = ON and set busy_timeout to 10s to prevent 'database is locked' errors under concurrency
    const queryToRun = `PRAGMA foreign_keys = ON;\nPRAGMA busy_timeout = 10000;\n${sqlQuery}`

    // Write SQL command to stdin and close the stream
    child.stdin.write(queryToRun)
    child.stdin.end()
  })
}
