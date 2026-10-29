# Owner requests for 1.5.2: tracker

Written for the developer. The status of each of the owner's 1.5.2 requirements, with its evidence. Branch `feature/owner-requests-1.5.2` from `main` at 1.5.1.

**Status values:** Not started · In progress · Implemented, verification pending · Implemented and verified.

| Phase | Requirement                                                     | Status                            | Evidence                                                                                                                         |
| ----- | --------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 4     | Scale-label defaults, configurable, migrated, tested            | Implemented and verified          | D-084; `units.test.mjs`, `units.test.js`, `scaleDefaultsMigration.test.js` (22/22)                                               |
| 3     | Input validation audit                                          | Implemented and verified          | D-085; `numberInput.test.mjs`, `supplierOpening.test.js`; Arabic digits checked in the app                                       |
| 6     | Manual customer codes                                           | Implemented, verification pending | D-086; `customerCodesManual.test.js` (8), `customerCodes.test.js`; the windows are checked in the Phase 14 app sweep             |
| 10    | Latest purchase price instead of moving average                 | Implemented, verification pending | D-087; migration 0026; `latestPurchasePrice.test.js` (13), `stockCost.test.mjs`; purchase form checked in the Phase 14 app sweep |
| 8     | Administrator purchase without a shift → treasury               | Implemented, verification pending | D-089; migration 0027; `adminPurchaseTreasury.test.js` (4); form note checked in the Phase 14 app sweep                          |
| 5     | Supplier invoices: view and edit                                | Implemented, verification pending | D-088; `purchaseViewEdit.test.js` (4); window checked in the Phase 14 app sweep                                                  |
| 1     | Supplier debt-payment requests with approval                    | Implemented, verification pending | D-090; migration 0028; `supplierPaymentRequests.test.js` (8); screens checked in the Phase 14 app sweep                          |
| 2, 11 | Shift details, closing report and receipt: every event itemized | Implemented, verification pending | D-091; reconciliation in `supplierPaymentRequests.test.js`; printing and screens checked in the Phase 14 app sweep               |
| 9     | One search input at the till                                    | Not started                       |                                                                                                                                  |
| 7     | Keyboard navigation across the app                              | Not started                       |                                                                                                                                  |
| 12    | Permission review                                               | Not started                       |                                                                                                                                  |
| 13    | Sidebar reorganization                                          | Not started                       |                                                                                                                                  |
| 14    | Full regression                                                 | Not started                       |                                                                                                                                  |
| 15    | Release 1.5.2                                                   | Not started                       |                                                                                                                                  |
