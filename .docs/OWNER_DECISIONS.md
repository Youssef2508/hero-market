# Owner Decisions

Two business policies are undecided. Current behaviour stays unchanged until the owner answers. Evidence was gathered on 2026-10-14 from the code and from a scripted scenario on a throw-away database (`k24.js` in the QA notes).

## K-24 / G-27 – Expected cash when closing a shift

> **Decided by the owner on 2026-10-14: option 1. Implemented.** Both close dialogs, the hourly audit, the saved shift record and the printed report use one formula (`drawerFigures` in `src/server/modules/shifts.js`); the dialogs display the service's figure instead of computing their own. Regression tests: `tests/service/shiftClose.test.js` (the example below gives 650 everywhere). The analysis below is kept as the record.

### What the code does today

Three different "expected cash in the drawer" figures exist for the same shift:

| Where                                                                         | Formula (`src/server/modules/shifts.js`, `CloseShiftModal.jsx`)                                                                                                                                       | Used for                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Saved on close** (`closeFigures`) and the **hourly audit** (`auditFigures`) | opening cash + cash sales **as sold** (before returns) + drawer inflows (customer repayments, partial-payment deposits) − **all** drawer outflows (returns paid in cash, supplier payments, expenses) | `shifts.expected_end_cash`, `difference` (shortage/overage), shift history, reports, the printed shift-close report |
| **Simple close dialog** (cashiers)                                            | opening cash + cash sales **after returns** + inflows − **all** outflows                                                                                                                              | The figure shown to the cashier and the "تعبئة المبلغ المتوقع" button                                               |
| **Detailed close dialog** (multi-till)                                        | opening cash + cash sales **after returns** + inflows − (supplier payments + expenses), with **returns left out**                                                                                     | The figure shown and the "تطبيق السوبر ماركت فقط" button                                                            |

A cash return is recorded twice: the sale line is reduced, and a "مرتجع…" outflow is written for the cash handed back. The three formulas treat that pair differently.

### Example (real run through the service)

Opening cash 500. The shift contains:

- a cash sale of 200, of which 40 is returned in the same shift;
- a return of 20 against **yesterday's** cash sale;
- a customer repayment of 25 and an expense of 15;
- a credit sale of 50 and a Vodafone Cash sale of 30 (no drawer cash).

Physical cash in the drawer: 500 + 200 − 40 − 20 + 25 − 15 = **650**.

| Figure                        | Result          | Why                                                                                          |
| ----------------------------- | --------------- | -------------------------------------------------------------------------------------------- |
| Saved on close / hourly audit | **650** ✔       | Counts each cash movement once                                                               |
| Simple dialog                 | **610** ✘ (−40) | The same-shift return is subtracted twice: once in "sales after returns", once as an outflow |
| Detailed dialog               | **670** ✘ (+20) | The return of yesterday's sale left the drawer today, but it is not subtracted               |

**Consequence today:** a cashier who presses "تعبئة المبلغ المتوقع" in the simple dialog after a same-shift return records an actual cash 40 below the saved expectation. That shift then shows a **false shortage of 40**. In the detailed dialog the same button produces a false overage after any cross-shift return.

### Options

1. **(Recommended) Show the saved formula in both dialogs.** Both dialogs display exactly what `shifts.close` stores: one formula everywhere, the same as the hourly audit and reports. No stored value changes; past shifts are unaffected because their saved figures already use it. Only the on-screen guidance and pre-fill buttons change.
2. Keep the simple dialog's "sales after returns" view, but stop subtracting same-shift returns again; keep the detailed dialog as is. This needs a new formula that tracks which shift each return belongs to. It is more complex and still differs from what is saved.
3. Keep everything as it is (known false shortages and overages).

_Recommendation, not an established requirement:_ option 1. The saved formula is the one that matches the cash physically in the drawer in every case we tested.

## K-10 / G-13 – Supervisor approval

> **Owner decision, 2026-10-14:** option A is **rejected**. Ordinary edits to an unfinished cart (add, remove, change quantity or weight, clear, correct a scan) never require supervisor approval. A risk-based policy for completed sales, returns, prices, discounts, inventory and administration is proposed in [STAGE4_ARCHITECTURE_REVIEW.md](STAGE4_ARCHITECTURE_REVIEW.md) §7 and awaits the owner's choices. Nothing has been implemented.

### What exists

- `auth.verifyApprover` (service) checks another user's PIN and requires the `pos.approve` permission. It has a lockout (5 wrong attempts per till, 20 per address) and logs **successful** approvals as `manager_approval` ("اعتماد عملية للكاشير … بواسطة …").
- The approval dialog (`ManagerApprovalModal`) and its handler were built for three **cart actions before payment**: deleting a line, reducing a line's quantity and clearing the cart. **Nothing opens the dialog today**, so cashiers do these freely.
- **Rejected attempts are not logged.** Approval is checked by the till and not linked to a specific action on the server, which is fine for cart edits because the server never sees an unpaid cart.

### Sensitive actions that exist

| Action                                                                    | Today                                                                      | Approval candidate?                                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Delete a scanned line, reduce a quantity, clear the cart (before payment) | Any cashier, no trace                                                      | **Yes.** This is the classic "scan then void" loss path, and the dialog already exists. |
| Invoice discount                                                          | Needs `pos.discount` (cashiers have it); limited to the subtotal           | Optional, above a limit the owner sets (no limit is invented here)                      |
| Returns and refunds                                                       | Need `sales.return`; cashiers do not have it, so a supervisor must do them | Optional: let cashiers return **with** approval instead of handing over the till        |
| Price override                                                            | **Does not exist** (the service sets prices)                               | –                                                                                       |
| Deleting expenses, damaged goods or till movements; reprints              | Manager permissions                                                        | No: already restricted by role                                                          |

### Proposed minimal policy (choose)

- **A. Voids after scanning:** require approval to delete a line, reduce a quantity or clear the cart once it has items. Log every approval **and every rejection**, with the action, product and amount.
- **B. Discount limit:** discounts above X EGP or Y % of the invoice need approval. The owner sets X/Y in settings; "off" by default. The server enforces it with a one-time approval token.
- **C. Cashier returns with approval:** cashiers may start a return, and a supervisor's PIN completes it (server-enforced and logged).
- **D. Keep as today:** no approval anywhere; remove the unused dialog later.

_Recommendation, not an established requirement:_ **A** only. It closes the main shrinkage path with the dialog that already exists, changes nothing about prices or money calculations, and adds the missing rejection log. B and C change who may do what and should wait until the store has used A for a while.
