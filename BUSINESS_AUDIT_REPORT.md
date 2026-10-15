# Supermarket Business & Accounting Audit Report
**Target System:** HeroMarket POS (code base v1.2.3, before the HeroMarket redesign)  
**Audit Domain:** Supermarket & Grocery Retail Operations, Accounting Mathematics, and Inventory Control  
**Audit Date:** August 1, 2026  
**Auditor Role:** Senior Retail Operations Consultant & Retail ERP Specialist  

---

## Executive Overview

This audit evaluates the **business logic, accounting mathematics, supermarket domain workflows, and fraud prevention mechanisms** of the HeroMarket POS system. Beyond code syntax, retail software requires watertight financial math, precise inventory deduction, non-manipulable shift closures, and true profit/loss accounting.

While the core checkout and shift mechanics are functional, this audit identified **critical accounting leaks, profit inflation vulnerabilities, and missing supermarket domain workflows** that create real-world financial risk.

---

## Domain Audit Matrix & Risk Summary

| Domain Area | Business & Accounting Finding | Risk Level | Operational Impact |
| :--- | :--- | :---: | :--- |
| **1. Scale Barcodes & Packaging** | Hardcoded `'20'` prefix scale parser; assumes grams to KG; no scale price-embedded mode support. | 🟠 **High** | Price-embedded scale barcodes (prefix `22`) fail or miscalculate item quantities. |
| **1. Multi-Unit Packaging** | No Box-to-Piece unit conversion matrix (e.g. 1 Carton = 24 Cartons). | 🟡 **Medium** | Stock of bulk cartons and individual items must be maintained manually, risking stock mismatches. |
| **1. Expiry & Damage Control** | Damaged goods write-offs work & deduct profit, but no expiry date (`expiry_date`) batch tracking exists. | 🟡 **Medium** | Store cannot track near-expiry items or issue early discount alerts. |
| **2. Partial Returns & Discounts** | Returning 1 item from a discounted multi-item invoice over-refunds cash by keeping 100% of global discount on remaining items. | 🔴 **Critical** | Financial leakage & cash drawer loss during customer partial returns. |
| **2. Partial Cash/Credit Sales** | No unified Split Payment (`دفع جزئي`) at checkout (Cash + Credit split). | 🟡 **Medium** | Cashiers must process partial payments via two separate screens, increasing entry errors. |
| **3. Shift Loss Prevention** | Shift close modal displays **Expected Cash Amount** to cashiers prior to drawer entry (Not a Blind Audit). | 🔴 **Critical** | Cashiers can manipulate physical cash counts to match expected totals, hiding cash theft. |
| **3. Permission Boundaries** | Inventory manual stock overrides and cost price edits do not require Manager PIN authorization. | 🟠 **High** | Cashiers with access to admin tab can alter cost prices or inject inventory without oversight. |
| **4. Purchasing & Costing** | Supplier purchase invoices do NOT automatically update product stock or cost prices. | 🔴 **Critical** | Purchasing stock requires double data entry; profit margins become inaccurate if cost changes. |
| **5. Net Profit Accuracy** | General Operating Expenses (`totalExpenses`) are NOT subtracted from Net Profit calculation in analytics. | 🔴 **Critical** | Reported Net Profit is artificially inflated by omitting rent, electricity, and salary expenses. |

---

## Detailed Business Domain Analysis

---

### Domain 1: Inventory & Stock Movement Audit (Supermarket Specifics)

#### A. Weighing Scale Barcodes (20XXXXX vs 22XXXXX & Grams vs EGP)
* **Code Location**: `src/renderer/src/hooks/useBarcode.js` (Lines 166–178)
* **Current Business Logic**:
  ```javascript
  const parseScaleBarcode = (rawBarcode) => {
    const clean = rawBarcode.trim()
    if (clean.length === 13 && clean.startsWith('20')) {
      const productCode = clean.substring(2, 7)
      const weightVal = parseFloat(clean.substring(7, 12)) / 1000.0
      return { isWeighted: true, barcode: productCode, qty: weightVal }
    }
    return { isWeighted: false, barcode: clean }
  }
  ```
* **Business Flaw & Risk**:
  1. Supermarkets commonly use scale prefixes **`22`**, **`21`**, or **`25`** in addition to `20`.
  2. Scale barcodes come in two standard formats: **Weight-Embedded** (digits 7-11 represent grams) and **Price-Embedded** (digits 7-11 represent total price in EGP).
  3. If a scale generates a price-embedded barcode (e.g., `2200123005001` = 50.00 EGP of Cheese), the system divides 5000 by 1000 and treats it as **5.000 KG of Cheese**, causing massive inventory deduction errors and billing discrepancies.
* **Remediation Recommendation**: Support configurable scale prefixes (`20`, `21`, `22`, `25`) and add a toggle for **Weight-Embedded** vs. **Price-Embedded** barcode parsing.

#### B. Multi-Unit & Bulk Packaging (Box vs. Piece Conversion)
* **Code Location**: `src/main/db.js` (`products` schema) & `products.dao.js`
* **Current Business Logic**: `products` table has a single text column `unit` (`'قطعة'`, `'علبة'`, `'كرتونة'`).
* **Business Flaw & Risk**: In supermarkets, items arrive in bulk cartons (e.g., A box of 24 juice cans) but are sold both as whole boxes and individual cans. Currently, selling 1 can from a opened box requires manually adjusting two separate product entries. There is no automated parent-child unit conversion (e.g. `1 Carton = 24 Units`).
* **Remediation Recommendation**: Add a `parent_barcode` and `conversion_factor` relation to `products` so selling individual units automatically decrements parent bulk stock.

#### C. Expiry Date Tracking & Stock Write-offs (الهالك والعدم)
* **Code Location**: `src/renderer/src/hooks/useDamagedGoodsManager.js` & `src/main/db.js` (`damaged_goods`)
* **Business Evaluation**:
  - **Damaged Goods (الهالك)**: Properly implemented! Recording damaged items deducts physical stock from `products` and subtracts total cost (`quantity * cost_price`) from net profit in financial reports.
  - **Expiry Tracking**: Missing. No `expiry_date` column exists on product batches, preventing near-expiry warning alerts (e.g., 7 days before dairy expiration).

---

### Domain 2: Supermarket Accounting & Mathematical Integrity

#### A. Partial Returns & Invoice Discount Pro-Rating (المرتجعات والخصومات)
* **Code Location**: `src/renderer/src/hooks/useSalesManager.js` (Lines 115, 172)
* **Current Business Logic**:
  ```javascript
  UPDATE sales SET total_amount = MAX(0, (SELECT IFNULL(SUM(total_price), 0) FROM sale_items WHERE sale_id = X) - discount) WHERE id = X;
  ```
* **Business Flaw & Risk (Financial Leakage)**:
  Suppose an invoice has 5 items totaling 500 EGP, and the cashier applies a **50 EGP invoice discount** (Net Total = 450 EGP).
  If the customer returns 1 item worth 100 EGP:
  - The customer is refunded 100 EGP cash.
  - The database recalculates remaining `total_amount` as `(400 - 50) = 350 EGP`.
  - **Accounting Flaw**: The customer received a 100 EGP refund AND kept 100% of the 50 EGP discount on the remaining items! The refund should have been pro-rated based on the net item value (`100 - (100/500 * 50) = 90 EGP`).
  - **Result**: The store loses 10 EGP on every partial return from discounted invoices.
* **Remediation Recommendation**: Pro-rate global invoice discounts across line items during returns, or adjust `discount` proportionally when items are returned.

#### B. Digital Wallets & Till Segregation (ممكن / فودافون كاش / انستاباي)
* **Code Location**: `src/renderer/src/components/admin/TillsManagerTab.jsx` & `src/renderer/src/lib/dao/mobile_money.dao.js`
* **Business Evaluation**: Excellent segregation! Physical Cash, Momkn Machine Till, and Mobile Money (Vodafone Cash, InstaPay, Bank Transfer) have dedicated balances, transaction ledgers, and commission calculations.

#### C. Wholesale & Partial Payments (البيع الآجل والجزئي)
* **Code Location**: `src/renderer/src/hooks/usePOSController.js` (`handleCheckout`)
* **Current Business Logic**: `payment_type` supports `'نقدي'` or `'آجل'`.
* **Business Flaw & Risk**: If a wholesale customer buys goods for 2,000 EGP and pays 500 EGP cash upfront while putting 1,500 EGP on credit, the cashier cannot select a "Partial Cash/Credit" option during checkout. Selecting `'آجل'` adds the full 2,000 EGP to customer debt, requiring the cashier to open `ClientsTab` separately to record the 500 EGP repayment.
* **Remediation Recommendation**: Support a `دفع جزئي` (Split Payment) payment mode directly in `CheckoutTerminal.jsx`.

---

### Domain 3: Shift Lifecycle & Loss Prevention (منع السرقة والتلاعب)

#### A. Shift Expected Cash Formula Validation
* **Code Location**: `src/renderer/src/hooks/usePOSController.js` (Lines 236–245) & `TillsManagerTab.jsx`
* **Formula Verification**:
  $$\text{Expected Cash} = \text{Initial Cash} + \text{Cash Sales} + \text{Client Debt Repayments} - \text{Refunds} - \text{Supplier Payments} - \text{Expenses}$$
* **Evaluation**: Mathematically accurate and fully includes safe inflows and outflows.

#### B. Blind Closing vs. Visible Drawer Totals (الجرد الأعمى)
* **Code Location**: `src/renderer/src/components/modals/CloseShiftModal.jsx` & `AppModals.jsx`
* **Current Business Logic**: The shift close modal calculates and **displays the exact Expected Cash total on screen** to the cashier before they enter their counted cash.
* **Business Flaw & Risk (Loss Prevention Failure)**: In retail operations, displaying expected cash to cashiers enables drawer theft. A cashier who stole 200 EGP can simply enter the displayed expected number into the input field to pass the check or cover up discrepancies.
* **Remediation Recommendation**: Implement **Blind Closing (الجرد الأعمى)** for cashier roles: hide the expected total until *after* the cashier submits their physical count, displaying variance only to managers.

#### C. Permission Control Boundaries
* **Code Location**: `src/renderer/src/hooks/usePOSController.js` (`handleManagerAuthSubmit`)
* **Business Evaluation**: Voiding items, reducing item quantities, and clearing cart require Manager PIN approval (`ManagerApprovalModal`). However, modifying product cost prices or manually editing stock quantities in `AdminDashboard` only checks role `admin`/`manager` on tab view, not per transaction.

---

### Domain 4: Supplier Ledger & Purchasing Workflow (حسابات الموردين والشراء)

#### A. Supplier Invoice Cost Price & Stock Synchronization
* **Code Location**: `src/renderer/src/lib/dao/suppliers.dao.js` (`addSupplierPurchase`)
* **Current Business Logic**:
  ```javascript
  INSERT INTO supplier_purchases (supplier_id, invoice_ref, total_amount, paid_amount, remaining, payment_type, timestamp, notes)
  ```
* **Business Flaw & Risk (Critical Workflow Disconnect)**:
  1. Entering a supplier purchase invoice in `SuppliersTab` updates the supplier's debt balance and logs a safe outflow for paid amounts.
  2. **CRITICAL GAP**: It does **NOT** update physical product stock (`products.stock_qty`) nor update product cost prices (`products.cost_price`)!
  3. Staff must manually navigate to `InventoryTab` to re-enter stock quantities and cost prices item by item.
  4. If a supplier changes cost prices, old cost prices remain on the product, rendering COGS and net profit calculations invalid.
* **Remediation Recommendation**: Upgrade `addSupplierPurchase` to accept itemized purchase lines, automatically incrementing product `stock_qty` and updating `cost_price` (using Last Cost or Weighted Average Cost).

---

### Domain 5: Reporting & Profitability Accuracy (التقارير وصافي الربح)

#### A. Net Profit Calculation Accuracy
* **Code Location**: `src/renderer/src/hooks/useAdminController.js` (Lines 98–120)
* **Current Business Logic**:
  ```javascript
  const netProfitSales = profitRes[0]?.profit || 0; // Gross Profit (Sales - COGS)
  const totalDamagedCost = damagedRes[0]?.total_damaged_cost || 0;
  const netProfit = netProfitSales - totalDamagedCost;
  ```
* **Business Flaw & Risk (Financial Distortion)**:
  - `totalExpenses` (`SUM(amount)` from `expenses` table, e.g., rent, electricity, wages, tea/coffee) is fetched separately in Line 123 BUT **IS NOT SUBTRACTED** from `netProfit`!
  - **Financial Impact**: Reported "Net Profit" is actually **Gross Margin after Damaged Goods**, NOT Net Profit. Store owners viewing this number will see artificially inflated profits because operating expenses are completely ignored.
* **Remediation Recommendation**: Correct formula to:
  $$\text{True Net Profit} = \text{Gross Profit} - \text{Damaged Goods Loss} - \text{Total Operating Expenses}$$

---

## Prioritized Action Plan & Business Recommendations

### 🔴 Critical Business Risk (Address Immediately)
1. **Subtract Operating Expenses from Net Profit**: Fix `useAdminController.js` line 119 to compute `netProfit = netProfitSales - totalDamagedCost - totalExpenses`.
2. **Pro-Rate Discounts on Item Returns**: Update `sales.dao.js` and `useSalesManager.js` to adjust refund amounts or discount proportions during partial returns.
3. **Link Supplier Purchases to Inventory**: Extend `addSupplierPurchase` to update product stock quantities and cost prices automatically.
4. **Enforce Blind Shift Closing for Cashiers**: Hide expected cash amounts in `CloseShiftModal.jsx` until cashier submits physical cash count.

### 🟠 Medium Business Risk (Next Sprint)
1. **Expand Scale Barcode Parser**: Add support for prefix `22` and Price-Embedded scale barcodes in `useBarcode.js`.
2. **Implement Split Checkout (`دفع جزئي`)**: Allow cashiers to split payment between Cash and Credit in a single checkout operation.
3. **Add Expiry Date Tracking**: Add `expiry_date` column to `products` to enable near-expiry inventory notifications.

---
*Report prepared by Senior Retail Operations & ERP Specialist.*
