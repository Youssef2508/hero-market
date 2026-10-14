/* eslint-disable */
// ─────────────────────────────────────────────────────────────
// Legacy SQLite fixture builder (NOT part of upstream).
//
// HeroMarket now runs on PostgreSQL (see .docs/DATABASE_ARCHITECTURE.md). This script still creates a
// database in the ORIGINAL SQLite format, with the original schema and sample data, so the legacy
// importer can be developed and tested against a realistic source:
//
//   node scripts/init-dev-db.js [--db file.db] [--reset]
//   node scripts/import-sqlite.js --sqlite file.db --database-url postgres://…
//
// It uses Node's built-in SQLite engine (the same one the importer reads with); no sqlite3 binary needed.
// ─────────────────────────────────────────────────────────────
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- Core: Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'cashier'
);

-- Core: Products
CREATE TABLE IF NOT EXISTS products (
  barcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cost_price REAL DEFAULT 0.0,
  retail_price REAL DEFAULT 0.0,
  wholesale_price REAL DEFAULT 0.0,
  stock_qty REAL DEFAULT 0.0,
  reorder_limit REAL DEFAULT 0.0,
  unit TEXT,
  category TEXT
);

-- Core: Clients
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  address TEXT,
  debt_balance REAL DEFAULT 0.0,
  points INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS client_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER,
  type TEXT,
  amount REAL,
  description TEXT,
  timestamp TEXT,
  FOREIGN KEY(client_id) REFERENCES clients(id)
);

-- Core: Shifts
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  initial_cash REAL DEFAULT 0.0,
  expected_end_cash REAL DEFAULT 0.0,
  actual_end_cash REAL DEFAULT 0.0,
  difference REAL,
  status TEXT DEFAULT 'open',
  momkn_start_balance REAL DEFAULT 0.0,
  momkn_start_cash REAL DEFAULT 0.0,
  vfcash_start_balance REAL DEFAULT 0.0,
  vfcash_start_cash REAL DEFAULT 0.0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Core: Sales
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER,
  user_id INTEGER,
  timestamp TEXT,
  total_amount REAL DEFAULT 0.0,
  original_amount REAL DEFAULT 0.0,
  discount REAL DEFAULT 0.0,
  payment_type TEXT,
  client_name TEXT,
  client_id INTEGER REFERENCES clients(id),
  FOREIGN KEY(shift_id) REFERENCES shifts(id)
);

-- Core: Sale Items
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  product_barcode TEXT,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,
  cost_price REAL DEFAULT 0.0,
  returned_qty REAL DEFAULT 0.0,
  FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY(product_barcode) REFERENCES products(barcode)
);

-- Auxiliary Modules
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  contact_person TEXT,
  debt_balance REAL DEFAULT 0.0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  timestamp TEXT,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
);

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

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER,
  amount REAL NOT NULL,
  category TEXT,
  description TEXT,
  timestamp TEXT
);

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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

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

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action_type TEXT NOT NULL,
  description TEXT,
  details TEXT
);

CREATE TABLE IF NOT EXISTS momkn_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  description TEXT,
  digital_impact REAL NOT NULL,
  cash_impact REAL NOT NULL,
  commission REAL DEFAULT 0.0,
  notes TEXT,
  FOREIGN KEY(shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS mobile_money_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  platform TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  digital_impact REAL NOT NULL,
  cash_impact REAL NOT NULL,
  commission REAL DEFAULT 0.0,
  recipient_name TEXT,
  phone_or_account TEXT,
  notes TEXT,
  FOREIGN KEY(shift_id) REFERENCES shifts(id)
);

CREATE TABLE IF NOT EXISTS safe_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY(shift_id) REFERENCES shifts(id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales(client_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_barcode ON sale_items(product_barcode);
CREATE INDEX IF NOT EXISTS idx_safe_ledger_shift_id ON safe_ledger(shift_id);
CREATE INDEX IF NOT EXISTS idx_client_ledger_client_id ON client_ledger(client_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier_id ON supplier_ledger(supplier_id);

-- Settings Defaults
INSERT OR IGNORE INTO settings (key, value) VALUES ('store_name', 'هيرو ماركت');
INSERT OR IGNORE INTO settings (key, value) VALUES ('branch_name', 'الفرع الرئيسي');
INSERT OR IGNORE INTO settings (key, value) VALUES ('printer_name', 'CITIZEN CT-S300');

`

// Development/CI sample data (NOT for releases: includes test users with well-known PINs).
const sampleSql = `
-- Users
INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', '1234', 'admin');
INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (2, 'cashier1', '1111', 'cashier');
INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (3, 'manager', '9999', 'manager');
INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (5, 'cashier_test', '5555', 'cashier');

-- Clients
INSERT OR IGNORE INTO clients (id, name, phone, address, debt_balance, points, created_at) VALUES
 (1, 'عميل عام', '01099999999', 'الفرع', 0.0, 0, '2026-01-01 00:00:00'),
 (3, 'سحس', '01111111111', 'المعادي', 0.0, 10, '2026-01-01 00:00:00');

-- Initial baseline closed shift
INSERT OR IGNORE INTO shifts (id, user_id, start_time, end_time, initial_cash, expected_end_cash, actual_end_cash, difference, status)
VALUES (1, 1, '2026-01-01 08:00:00', '2026-01-01 16:00:00', 500, 500, 500, 0, 'closed');

-- Sample products
INSERT OR IGNORE INTO products (barcode, name, cost_price, retail_price, wholesale_price, stock_qty, reorder_limit, unit, category) VALUES
 ('6223001876366', 'زبادي المراعي كامل الدسم', 11.00, 13.00, 12.00, 120, 20, 'علبة', 'ألبان'),
 ('6223000660515', 'لوبيا الضحى 500جم',        98.00, 112.70, 105.00, 45, 10, 'كيس', 'بقوليات'),
 ('6223000660508', 'فاصوليا الضحى 500جم',      90.00, 103.50, 97.00, 3, 5, 'كيس', 'بقوليات'),
 ('6223000661512', 'كمون الضحى علبة',          20.00, 24.15, 22.00, 12, 5, 'علبة', 'بهارات'),
 ('00515',         'جبنة رومي قديم فرط',       200.00, 240.00, 225.00, 35, 5, 'كجم', 'جبن'),
 ('00516',         'حلاوة طحينية رشيدي فرط',   150.00, 180.00, 170.00, 20, 5, 'كجم', 'حلاوة'),
 ('6223000661505', 'فلفل أسود ناعم الضحى',     21.00, 25.30, 23.00, 18, 5, 'علبة', 'بهارات'),
 ('6624000301000', 'نشا ايزي فودز كيس',        1.40, 1.72, 1.60, 80, 15, 'كيس', 'نشويات'),
 ('6223001360568', 'ميرندا برتقال 2 لتر',      19.00, 23.00, 21.00, 5, 10, 'زجاجة', 'مشروبات');

`

/** Create (or complete) a legacy-format SQLite database at dbPath. Returns row counts. */
function buildLegacyFixture(dbPath, { reset = false } = {}) {
  if (reset) {
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`])
      if (fs.existsSync(f)) fs.unlinkSync(f)
  }
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(schemaSql + sampleSql + 'COMMIT;')
    return db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM clients) AS clients'
      )
      .get()
  } finally {
    db.close()
  }
}

module.exports = { buildLegacyFixture }

if (require.main === module) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--db')
  const dbPath = i >= 0 ? path.resolve(args[i + 1]) : path.join(root, 'market_unified_testing.db')
  const counts = buildLegacyFixture(dbPath, { reset: args.includes('--reset') })
  console.log(`[init-dev-db] Legacy SQLite fixture ready at ${dbPath}`)
  console.log(`[init-dev-db] Counts: ${JSON.stringify(counts)}`)
  console.log(
    '[init-dev-db] Legacy PINs (upgraded on first login after import): admin=1234, cashier1=1111, manager=9999, cashier_test=5555'
  )
}
