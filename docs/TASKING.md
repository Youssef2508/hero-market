# Tasking & Roadmap

This document outlines the development status of the **HeroMarket POS** system, showing completed modules, ongoing revisions, and planned features.

---

## 1. System Version Checklist (`v1.2.2-stable`)

### A. Point of Sale (POS) & Checkout
- [x] Barcode scanning keyboard hook listener (`useBarcode.js`).
- [x] Barcode suffix match fallback (to support partial barcodes).
- [x] Cart calculations, unit discount models, and loyalty points accumulation.
- [x] Client credit checkout option (deducting/adding to client debt balance).
- [x] Native RTL Arabic receipt format rendering.

### B. Shift & Auditing
- [x] Shift opening cash verification system.
- [x] Real-time expected cash calculations: `Initial + Cash Sales + Safe Inflows - Safe Outflows`.
- [x] Safe ledger audit trails.
- [x] Cashier shift handoff difference calculation and closing database locking.

### C. Client & Supplier Financial Ledgers
- [x] Clients management, ledger entries, and historical debt repayments.
- [x] Suppliers invoicing, payment tracking, and remaining debt calculation.
- [x] Checks register (due date notifications and payment status toggle).

### D. Inventory & Shortages Reports
- [x] Real-time stock quantity decrements.
- [x] Low stock warnings relative to reorder limits.
- [x] Damaged goods registry linked to cost prices and current shift.
- [x] Shortages PDF compilation via local Typst compiler.

---

## 2. Upcoming Features & Roadmap

### Milestone 1: Multi-Till Drawer Management (Three drawers)
To support diverse payment and utility operations, the supermarket requires tracking three distinct physical cash flows under each shift:
1.  **Main Supermarket Drawer:** Handles standard cash checkout invoices.
2.  **Momkn Utility Drawer:** Handles cash received/spent for the Momkn payment machine.
3.  **Mobile Wallets Drawer:** Vodafone Cash, Instapay transfers, and bank deposits.

#### Action Items:
- [ ] Create `momkn_transactions` and `mobile_money_transactions` schema tables.
- [ ] Implement `momkn.dao.js` and `mobile_money.dao.js`.
- [ ] Add `useMomknTill.js` and `useMobileMoneyTill.js` controller hooks.
- [ ] Create `TillsManagerTab.jsx` dashboard component for managers with sub-tabs.
- [ ] Design operation forms (modals) for utility payments and mobile money transfers.
- [ ] Implement thermal report templates for print-outs at shift handoff.

### Milestone 2: Cloud Sync & Automated Backups
- [ ] Create background task to sync encrypted db snapshots to cloud storage (e.g., Cloudflare R2 bucket) on shift close.
- [ ] Implement local database backup scheduler (spooling `.db` copies to secondary partition).
