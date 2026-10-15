# Project Brief: HeroMarket POS

## 1. Project Vision
**HeroMarket POS** is a production-grade, offline-first Point of Sale (POS) and inventory management desktop application designed specifically for supermarket cashier desks. The primary focus of the system is to ensure lightning-fast operations, crash resilience, absolute transaction integrity, and precise financial ledger tracking for both client and supplier accounts.

---

## 2. Core Objectives
*   **High Performance Checkout:** Keep cashier checkout lag-free under constant barcode scanner inputs.
*   **Shift Auditing & Security:** Prevent checkout errors or cash leakages by enforcing strict cashier shift opening/closing protocols.
*   **Financial Integrity:** Keep a unified, historical journal of client debt ledger, supplier invoice payments, and the registers safe ledger.
*   **Offline Resilience:** Operate fully offline without cloud dependencies, utilizing SQLite local persistence.
*   **Localized Print Support:** Generate thermal checkout receipts and PDF shortage reports with native, highly aligned Arabic RTL support.

---

## 3. Key Feature Specifications

### A. Point of Sale (POS) Checkout
*   **Barcode Scanner Hook:** Intercepts keyboard events from barcode scanners, looks up items instantly, and adds them to the checkout queue.
*   **Dual Price Tiers:** Support for retail prices and wholesale prices based on volume or manual selection.
*   **Loyalty Points:** Accumulates points for registered clients based on purchase amount.
*   **Print Engine:** Prints direct thermal receipts using localized Arabic layouts.

### B. Shift Lifecycle Management
*   **Shift Opening:** Requires inputting the drawer's initial cash.
*   **Active Shift Audits:** Tracks real-time cash sales, outflows (expenses/refunds), and inflows (client repayments).
*   **Shift Closing:** Requires cashiers to count drawer cash. The system calculates expected vs. actual differences and files audit logs.
*   **Trigger Protections:** Database-level triggers prevent registering sales on closed shifts or opening multiple concurrent shifts for a cashier.

### C. Client & Supplier Ledgers
*   **Client Ledger:** Records credit/debit balances, payments, and points history.
*   **Supplier Ledger:** Tracks purchase invoices, paid amounts, remaining debts, and check schedules.
*   **Checks Register:** Records incoming/outgoing bank checks, due dates, bank names, and payment status.

### D. Inventory & Stock Controls
*   **Stock Levels:** Real-time stock decrementing upon checkout.
*   **Low Stock Alerts:** Highlights items that have fallen under their reorder limit.
*   **Damaged Goods Registry:** Logs defective items and subtracts them from stock, noting cost price and shift context.
*   **Negative Stock Protection:** Database-level trigger to prevent transactions that would lead to negative stock.

### E. Financial Safe & Expenses
*   **Safe Ledger:** Tracks direct cash inflows and outflows (e.g., miscellaneous expenses, supplier payments).
*   **Audit Trail:** Event logs capturing administrative actions like deleting sales or altering product info.
