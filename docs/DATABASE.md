# Database Documentation

The database for HeroMarket POS is managed locally in an offline-first **SQLite 3** database file named `market_unified.db`. To optimize performance and ensure data safety, the journal mode is configured to **WAL (Write-Ahead Logging)**, and foreign key constraints are enforced on every session.

---

## 1. Core Schema Tables

### A. Inventory & Products
#### `products`
*   `barcode` (TEXT PRIMARY KEY) - Barcode scanned value.
*   `name` (TEXT NOT NULL) - Product description.
*   `cost_price` (REAL) - Purchasing cost.
*   `retail_price` (REAL) - Customer retail price.
*   `wholesale_price` (REAL) - Wholesaler discounted price.
*   `stock_qty` (REAL) - Current quantity in stock. Can not drop below 0 due to database trigger.
*   `reorder_limit` (REAL) - Threshold level. Stock at or below this value registers as low stock.
*   `unit` (TEXT) - Unit of measure (e.g., 'كرتونة', 'كيس', 'علبة').

#### `damaged_goods`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `shift_id` (INTEGER) - Links to current active shift.
*   `product_barcode` (TEXT) - Foreign key referencing `products(barcode)`.
*   `quantity` (REAL) - Amount damaged.
*   `reason` (TEXT) - Cause of damage.
*   `cost_price` (REAL) - Cost of product when logged.
*   `timestamp` (TEXT)

---

### B. Shift & User Administration
#### `users`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `username` (TEXT UNIQUE)
*   `password_hash` (TEXT) - Stores PIN credentials.
*   `role` (TEXT) - Options: `'admin'`, `'cashier'`.

#### `shifts`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `user_id` (INTEGER) - Foreign key referencing `users(id)`.
*   `start_time` (TEXT)
*   `end_time` (TEXT NULL)
*   `initial_cash` (REAL) - Beginning cash in drawer.
*   `expected_end_cash` (REAL) - Expected amount computed on shift close.
*   `actual_end_cash` (REAL) - Cash counted by hand.
*   `difference` (REAL) - Discrepancy between expected and actual cash.
*   `status` (TEXT) - Options: `'open'`, `'closed'`.

#### `shift_audits`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `shift_id` (INTEGER) - References `shifts(id)`.
*   `timestamp` (TEXT)
*   `expected_cash` (REAL)
*   `actual_cash` (REAL)
*   `difference` (REAL)
*   `notes` (TEXT)

---

### C. POS Sales & Checkout Ledger
#### `sales`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `shift_id` (INTEGER) - References `shifts(id)`.
*   `user_id` (INTEGER) - References `users(id)`.
*   `timestamp` (TEXT)
*   `total_amount` (REAL) - Net paid amount (original - discount).
*   `discount` (REAL) - Price reduction applied.
*   `payment_type` (TEXT) - Options: `'نقدي'` (Cash), `'آجل'` (Debt), `'فيزا'` (Visa).
*   `client_id` (INTEGER NULL) - References `clients(id)` if registered client.
*   `original_amount` (REAL) - Gross amount before discount.

#### `sale_items`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `sale_id` (INTEGER) - References `sales(id)` (ON DELETE CASCADE).
*   `product_barcode` (TEXT) - References `products(barcode)`.
*   `quantity` (REAL) - Number of items sold.
*   `unit_price` (REAL) - Price per item sold.
*   `cost_price` (REAL) - Cost of product when sold (used for profit analytics).
*   `returned_qty` (REAL DEFAULT 0.0) - Quantity returned by customer.

---

### D. Clients (Accounts Receivable)
#### `clients`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `name` (TEXT NOT NULL)
*   `phone` (TEXT UNIQUE NULL)
*   `address` (TEXT NULL)
*   `debt_balance` (REAL DEFAULT 0.0) - Unpaid balance owed by client.
*   `points` (INTEGER DEFAULT 0) - Accumulated reward points.
*   `created_at` (TEXT)

#### `client_ledger`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `client_id` (INTEGER) - References `clients(id)`.
*   `type` (TEXT) - Options: `'debt'` (credit invoice checkout), `'payment'` (debt payment).
*   `amount` (REAL)
*   `description` (TEXT)
*   `timestamp` (TEXT)

---

### E. Suppliers (Accounts Payable)
#### `suppliers`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `name` (TEXT NOT NULL)
*   `phone` (TEXT NULL)
*   `address` (TEXT NULL)
*   `contact_person` (TEXT NULL)
*   `debt_balance` (REAL DEFAULT 0.0) - Debt owed to supplier.
*   `created_at` (TEXT)

#### `supplier_purchases`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `supplier_id` (INTEGER) - References `suppliers(id)`.
*   `invoice_ref` (TEXT NULL) - Supplier's invoice identifier.
*   `total_amount` (REAL) - Invoice total.
*   `paid_amount` (REAL DEFAULT 0.0)
*   `remaining` (REAL DEFAULT 0.0) - Unpaid invoice amount.
*   `payment_type` (TEXT) - Options: `'نقدي'` (Cash), `'آجل'` (Debt).
*   `timestamp` (TEXT)
*   `notes` (TEXT NULL)

#### `supplier_ledger`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `supplier_id` (INTEGER) - References `suppliers(id)`.
*   `type` (TEXT) - Options: `'purchase'` (new inventory credit), `'payment'` (paying supplier).
*   `amount` (REAL)
*   `description` (TEXT)
*   `timestamp` (TEXT)

---

### F. Banking & Auxiliary
#### `checks_register`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `check_type` (TEXT) - Options: `'issued'` (to suppliers), `'received'` (from clients).
*   `check_number` (TEXT NULL)
*   `bank_name` (TEXT NULL)
*   `party_name` (TEXT) - Name of client or supplier.
*   `issue_date` (TEXT NULL)
*   `due_date` (TEXT) - Maturity date of the check.
*   `amount` (REAL)
*   `status` (TEXT) - Options: `'غير مسدد'` (Unsettled), `'مسدد'` (Settled).
*   `notes` (TEXT NULL)
*   `created_at` (TEXT)

#### `expenses`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `shift_id` (INTEGER) - References `shifts(id)`.
*   `amount` (REAL)
*   `category` (TEXT) - Expense type (e.g., rent, utility, wages).
*   `description` (TEXT)
*   `timestamp` (TEXT)

#### `settings`
*   `key` (TEXT PRIMARY KEY) - Key options: `'store_name'`, `'branch_name'`, `'printer_name'`.
*   `value` (TEXT)

#### `system_logs`
*   `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
*   `timestamp` (TEXT)
*   `user_id` (INTEGER)
*   `username` (TEXT)
*   `action_type` (TEXT)
*   `description` (TEXT)
*   `details` (TEXT NULL)

---

## 2. Installed SQL Database Triggers
The SQLite database contains strict business rule constraints compiled directly as engine-level triggers:

### A. Prevent Negative Stock Levels
```sql
CREATE TRIGGER prevent_negative_stock
BEFORE UPDATE OF stock_qty ON products
FOR EACH ROW
WHEN NEW.stock_qty < 0
BEGIN
  SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن أن تقل كمية المخزون عن صفر (نفاد الكمية).');
END;
```

### B. Block Sales on Closed Shifts
```sql
CREATE TRIGGER prevent_sale_on_closed_shift
BEFORE INSERT ON sales
FOR EACH ROW
WHEN (SELECT status FROM shifts WHERE id = NEW.shift_id) = 'closed'
BEGIN
  SELECT RAISE(ROLLBACK, 'خطأ: لا يمكن تسجيل عملية بيع على وردية مغلقة.');
END;
```

### C. Enforce Single Open Shift per Cashier
```sql
CREATE TRIGGER prevent_multiple_open_shifts
BEFORE INSERT ON shifts
FOR EACH ROW
WHEN NEW.status = 'open' AND (SELECT COUNT(*) FROM shifts WHERE user_id = NEW.user_id AND status = 'open') > 0
BEGIN
  SELECT RAISE(ROLLBACK, 'خطأ: يوجد وردية مفتوحة بالفعل لهذا المستخدم.');
END;
```
