# Owner requests for 1.5.2: tracker

Written for the developer. The status of each of the owner's 1.5.2 requirements, with its evidence. Branch `feature/owner-requests-1.5.2` from `main` at 1.5.1.

**Status values:** Not started · In progress · Implemented, verification pending · Implemented and verified.

| Phase | Requirement                                                     | Status                   | Evidence                                                                                                                                          |
| ----- | --------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | Scale-label defaults, configurable, migrated, tested            | Implemented and verified | D-084; `units.test.mjs`, `units.test.js`, `scaleDefaultsMigration.test.js`; settings screen shows 13/1/6/7/5/1000/100 in the app                  |
| 3     | Input validation audit                                          | Implemented and verified | D-085; `numberInput.test.mjs`, `supplierOpening.test.js`; Arabic digits checked in the app                                                        |
| 6     | Manual customer codes                                           | Implemented and verified | D-086; `customerCodesManual.test.js` (8); code choice in the add-customer window in the app                                                       |
| 10    | Latest purchase price instead of moving average                 | Implemented and verified | D-087; migration 0026; `latestPurchasePrice.test.js` (13), `shiftReconciliation152.test.js`; «سعر آخر شراء» in the app                            |
| 8     | Administrator purchase without a shift → treasury               | Implemented and verified | D-089; migration 0027; `adminPurchaseTreasury.test.js` (4); the form's treasury note in the app                                                   |
| 5     | Supplier invoices: view and edit                                | Implemented and verified | D-088, D-094; `purchaseViewEdit.test.js` (4); invoice window opened, notes saved in the app                                                       |
| 1     | Supplier debt-payment requests with approval                    | Implemented and verified | D-090; migration 0028; `supplierPaymentRequests.test.js` (8), `shiftReconciliation152.test.js`; request, notice and approval in the running app   |
| 2, 11 | Shift details, closing report and receipt: every event itemized | Implemented and verified | D-091; `supplierPaymentRequests.test.js`, `shiftReconciliation152.test.js` (printed lines, saved close); the shift's lines seen in the app        |
| 9     | One search input at the till                                    | Implemented and verified | D-092; checked in the running app (`till-search.js`, 20 checks; simulated keys, not a physical scanner)                                           |
| 7     | Keyboard navigation across the app                              | Implemented and verified | D-093; `.docs/KEYBOARD_COVERAGE.md`; 16 checks in the running app (simulated keys)                                                                |
| 12    | Permission review                                               | Implemented and verified | D-094; `suppliers.purchase_edit` added with a prerequisite grant; `permissionUpgrade.test.js` (3), `permissionsAudit.test.js`; matrix regenerated |
| 13    | Sidebar reorganization                                          | Implemented and verified | D-095; `navigationLayout.test.mjs` (3); checked in the running app (owner 31 screens, folding, 1024 px, compact, cashier)                         |
| 14    | Full regression                                                 | In progress              | 463/463 tests, lint 0 errors, format clean; Sandbox upgrades from 1.4.0, 1.5.0, 1.5.1 and CI pending                                              |
| 15    | Release 1.5.2                                                   | Not started              |                                                                                                                                                   |
