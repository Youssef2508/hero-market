# Stage 4 – Architecture Review: Local-First Store with an Online Owner Experience

Date: 2026-10-14. Basis: the code on `feature/k24-close-formula` (PR stack #1 → #4 plus the K-24 change), its tests, and the owner's requirements of 2026-10-14. Nothing in §4–§9 is implemented. Decisions marked **[Owner]** are listed together in §10.

## 1. Executive assessment

HeroMarket today is a sound **single-site** system:

- Checkout, returns, credit, payments and shifts run as server-side transactions on PostgreSQL.
- The money and permission logic is tested, and retries are idempotent.
- Several tills can share one store server over HTTPS.

It is **not yet** the product described in the requirements. Three foundations are missing, and they cannot be added as features on top; the data model has to change first:

1. **No movement history for stock.** `products.stock_qty` is a single number that operations overwrite. The product form even writes an absolute stock value. History cannot be reconstructed, concurrent changes can be lost (a defect today, see K-37 below), and two sites cannot merge their changes. Every requirement in §5 of the owner's message (sync, remote stock receipts, negative stock with correct history) depends on stock and balances being **sums of immutable movements**.
2. **Single-site identity.** All 21 business tables use local integer ids and local sequences, and invoice numbers are those ids. Two databases (store and cloud) would issue the same numbers.
3. **One unit per product.** A product has one barcode, one price and one free-text unit. Fractional quantities already work (the cheese case at a per-kilogram price), but packaging, conversions, alternative barcodes and bulk prices do not exist.

**Recommendation in one sentence:** keep the store server as the place where the store runs (it never needs the internet), add a cloud copy of the same service for the owner, and connect them by exchanging **immutable business events** (sales, returns, stock receipts, payments, edits), applied exactly once on each side. Stock and balances become sums of movements, which merge correctly in any order.

This is a substantial change, roughly the size of stage 2. It can be delivered in phases. The store keeps working throughout, and each phase is testable on its own (§9).

## 2. Requirements audit

| Requirement                                                    | Today                                                                                                  | Status                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| K-24 one close formula                                         | Implemented on this branch (`shiftClose.test.js`)                                                      | **Done**                                                                   |
| Free cart edits without approval                               | Add, remove, change quantity, clear: no approval anywhere (`useCart.js`)                               | **Supported** (matches the owner's decision)                               |
| Supervisor approval for sensitive operations                   | Dialog and `auth.verifyApprover` exist but are never used; control is by role permissions only         | Partial                                                                    |
| Sell by weight (200 g of cheese at a per-kg price)             | Quantity is `numeric`; the cashier can type 0.25; scale barcodes (prefixes 20, 21, 22, 25) are parsed  | **Partial**: no unit-aware entry (grams vs kilograms), prefixes hard-coded |
| Sell by piece                                                  | Yes                                                                                                    | Supported                                                                  |
| Packs, cartons, cases with equivalences; several barcodes      | One barcode = one product = one price                                                                  | **Missing**                                                                |
| Different purchase, stock and sale units                       | Purchases record only money; **supplier invoices do not add stock**                                    | **Missing**                                                                |
| Negative stock                                                 | Forbidden by a database trigger (`prevent_negative_stock`); damaged goods also refuse                  | **Conflicts** (deliberate today; must be reversed)                         |
| Stock movement history                                         | None; only the audit log text                                                                          | **Missing**                                                                |
| Username + password login                                      | PIN only; the PIN itself identifies the user (`pin_lookup` unique), so two staff can never share a PIN | **Missing** (usernames already exist and are unique: easy migration)       |
| Local operation without internet                               | Local and LAN modes never use the internet                                                             | **Supported**                                                              |
| Several tills in the store                                     | Docker store server, HTTPS with a pinned root                                                          | Supported                                                                  |
| A till keeps selling when the **store server** is down (D-040) | No; explicit failure                                                                                   | Missing (separate from the internet question, see §5.6)                    |
| Owner's remote access, read and write                          | None. The server must not be exposed to the internet as it is                                          | **Missing**                                                                |
| Sync with exactly-once effects                                 | Idempotent checkout (`client_ref`) is a building block; nothing else                                   | **Missing**                                                                |
| Sync status visibility                                         | –                                                                                                      | Missing                                                                    |
| Historical correctness after configuration changes             | Sale lines snapshot price and cost; returns use the line price                                         | Partial (units and factors will need snapshots too)                        |
| Audit across sites                                             | Server-side audit log with user id (local integer)                                                     | Partial                                                                    |

### Defects found during this review

| ID   | Finding                                                                                                                                                                                                                                                                                  | Severity |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| K-36 | **Change kept as customer credit is not counted in the drawer.** When the cashier keeps the change as store credit (حفظ الباقي في الرصيد), the drawer keeps that cash, but no drawer inflow is recorded. Expected cash is short by the deposited amount, so the cashier shows a surplus. | Medium   |
| K-37 | **Product edits overwrite stock.** `products.update` writes the stock value loaded into the form. A sale on another till between opening and saving the form is lost from stock. Same risk for every absolute stock write.                                                               | High     |
| K-38 | Purchase invoices do not add stock; staff edit stock by hand. Purchase history and stock history are therefore unconnected.                                                                                                                                                              | High     |
| K-39 | A `system.reset` sets every negative stock to 0 and restarts all id sequences: it would be destructive once data is synchronised.                                                                                                                                                        | Medium   |

K-36 changes the expected-cash figure. I have not fixed it without your confirmation (§10, question 2).

## 3. Architecture options

All options keep the current store server (local mode or Docker), because the store must run with no internet.

| Option                                                                                                                                  | How it works                                                                                                                                                                                                                                                    | Fit                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Cloud is the only database; tills use it over the internet**                                                                       | Usual SaaS POS                                                                                                                                                                                                                                                  | **Rejected**: an outage stops selling (priority 1).                                                                                                                                                                                                                                                                                         |
| **B. Expose the store server to the internet** (port forwarding, VPN or tunnel)                                                         | The owner connects to the store's own server                                                                                                                                                                                                                    | Simple, always consistent, but the owner sees **nothing** when the store is offline or the PC is off. Exposing a store PC is a security risk. A VPN (for example WireGuard or Tailscale) avoids the exposure and is a **useful stop-gap** for remote viewing only. It does not meet scenarios D and E.                                      |
| **C. One-way replication store → cloud** (PostgreSQL logical replication)                                                               | Cloud is a read-only mirror                                                                                                                                                                                                                                     | Reliable, built into PostgreSQL, but the owner cannot write remotely (scenario D fails).                                                                                                                                                                                                                                                    |
| **D. Two-way database replication** (logical replication both ways, PostgreSQL multi-master products, SymmetricDS, Bucardo and similar) | Rows are copied both ways; conflicts are resolved per row                                                                                                                                                                                                       | **Rejected for business data.** Row-level conflict handling is "last write wins" or "stop and wait for a person". For stock and balances that is exactly the forbidden overwrite (scenario E). Integer ids collide. Sequences, triggers and schema changes become fragile, and failures are hard to see.                                    |
| **E. Local-first sync frameworks** (designed for phones and browsers: a local SQLite copy plus an upload queue)                         | Each device keeps a partial copy and uploads writes                                                                                                                                                                                                             | They solve transport, not business merging: an application-defined upload path still has to apply each write correctly. They would put SQLite back on the tills and make the cloud the authority, which conflicts with "the store must run alone".                                                                                          |
| **F. Business-event exchange between two peers (recommended)**                                                                          | Store and cloud each run the HeroMarket service on their own PostgreSQL. Every change is recorded as an immutable event with a global id. A sync agent sends store events to the cloud and cloud events to the store; each side applies each event exactly once | Fits every scenario. Stock and balances are sums of movements, so concurrent offline changes merge correctly without overwriting. Retries are harmless (exactly-once by event id). The store never waits for the cloud. Cost: a significant data-model change (§5, §6) and a sync component that has to be engineered and tested carefully. |

### Failure modes compared

| Situation                              | B (VPN)            | C (one-way)           | D (row replication)                    | F (events)                                                         |
| -------------------------------------- | ------------------ | --------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Store internet down                    | Owner sees nothing | Owner sees stale data | Owner sees stale data                  | Owner sees stale data, clearly labelled with the last sync time    |
| Owner records a delivery during outage | Impossible         | Impossible            | Applied later; may **overwrite** stock | Queued in the cloud; added to stock on reconnect                   |
| Same stock changed on both sides       | –                  | –                     | Last write wins (**wrong**)            | Both movements kept; stock = sum (**correct**)                     |
| Reply lost / retry                     | Same as today      | Replication protocol  | Usually safe                           | Event id dedupe: exactly once                                      |
| Cloud down                             | Store unaffected   | Store unaffected      | Replication slot grows on the store    | Store unaffected; outbox grows; resumes automatically              |
| Bug or bad data in sync                | –                  | Hard to see           | Hard to see; may stop replication      | Event rejected → visible in a sync-problems screen, others proceed |

## 4. Recommended approach

```text
                 Store LAN (works with no internet)                         Internet
 ┌──────────┐
 │ Till 1   │──┐
 ├──────────┤  │  HTTPS (pinned)  ┌─────────────────────────┐   HTTPS, mutual auth   ┌─────────────────────────┐   HTTPS + 2FA  ┌─────────┐
 │ Till 2   │──┼─────────────────►│ Store server            │◄──────────────────────►│ Cloud service           │◄──────────────►│ Owner   │
 ├──────────┤  │                  │ HeroMarket service      │   sync agent:          │ same HeroMarket service │                │ browser │
 │ Till N   │──┘                  │ PostgreSQL (authority   │   events out / in      │ PostgreSQL (copy +      │                │ or app  │
 └──────────┘                     │ for in-store work)      │                        │ owner's remote work)    │                └─────────┘
                                  └─────────────────────────┘                        └─────────────────────────┘
```

- **Store server** (the existing local or Docker setup): authority for everything done in the store. Tills only ever talk to it.
- **Cloud service**: the same code base and schema, on a hosted server. Hosting options and cost: §9, phase 5, **[Owner]**. It serves the owner's remote screens and accepts the owner's remote operations.
- **Sync agent** (part of the store service): pushes the store's events, pulls the cloud's events, and retries forever with back-off. Only the store connects outwards, so nothing in the store is exposed to the internet.
- The owner's interface is the same React application, served by the cloud as a web app. The desktop app in "remote" mode is a second option.

Why this is the most reliable choice: the store's ability to sell never depends on anything outside the store. Correctness after reconnection comes from the data model (movements that add up and events with unique ids), not from timing or from a third-party replication product. It also reuses most of what exists: the service layer, idempotent checkout, permissions, audit and HTTPS.

## 5. Data consistency model

### 5.1 Events

Every state change is written, in the same transaction, as:

- the business rows (the sale, its lines, ledger rows);
- one or more **movements** (stock, customer balance, supplier balance, drawer cash);
- an **event** row containing:
  - a global id (UUID);
  - the origin site (store or cloud);
  - a per-origin sequence number;
  - the type, for example `sale.completed`, `return.recorded`, `stock.received`, `customer.payment` or `product.updated`;
  - the full payload;
  - the user and device;
  - the time in UTC plus the store's local time.

An event is never edited or deleted. A correction is a new event, for example a return or a reversal.

### 5.2 Applying events exactly once

- Each side keeps `applied_events(origin, sequence)` with a unique key.
- Applying an event writes its effects **and** marks it applied in one transaction. A crash before commit means "not applied", so the event is retried. After commit, a retry is detected and skipped.
- This gives **exactly-once effects** over an at-least-once transport. That covers repeated disconnects, a lost acknowledgement, a restart in the middle of a batch, and the same batch sent twice.
- Events from one origin are applied **in sequence order**. A gap stops that origin's stream until the missing event arrives, so a later event is never applied before an earlier one. The other origin's stream continues.

### 5.3 Why stock and balances merge correctly

Stock is the sum of signed movements in the product's base unit. Addition does not depend on order, so the result is the same however the events interleave.

Owner's example (scenario E plus F):

- recorded stock 1 can;
- the store sells 10 cans offline, giving the movement −10 and stock −9 at the store;
- the owner meanwhile records a delivery of 24 cans in the cloud: movement +24, cloud stock 25;
- on reconnection each side applies the other's movement, and both arrive at 1 − 10 + 24 = **15**.

No value is ever overwritten, so no update can be lost. Customer and supplier balances work the same way: they are sums of ledger movements.

### 5.4 Things that are not sums

Product name, prices, unit definitions, user accounts and settings are **edits**, not movements.

- Each edit event carries the version it was based on.
- If both sides changed the **same field** of the same record during an outage, the side that applies second detects a conflict. Recommended rule: keep the later edit by UTC time and record the conflict in a "sync problems" list for the owner to confirm (**[Owner]**).
- Different fields edited on each side are merged without a conflict.
- Price changes never alter history: each sale line keeps the price, cost, unit and conversion factor it was sold with.

### 5.5 Rules that need one authority

Some checks need the latest state:

- not returning more than was sold;
- not closing a shift twice;
- not repaying more than is owed, if that rule is kept.

Recommendation: each record has a **home site**. Sales, returns, shifts and the drawer belong to the store. Operations that check those rules run at the home site. The owner can do them remotely only while the store is online, by forwarding the operation to the store. They are refused, with a clear message, while it is offline. Supplier invoices, stock receipts and catalogue edits are allowed at either site (**[Owner]**).

### 5.6 Inside the store

Tills keep talking to the store server, which has one database, so they are consistent with each other at every moment. That is today's behaviour, tested with 10 parallel checkouts.

Selling on a till while the **store server** itself is down is a different problem (D-040). It needs the same event mechanism between till and server. I recommend solving the store-to-cloud link first, then reusing it for till-to-server if you still want it after the server has a UPS (**[Owner]**).

### 5.7 Identity and numbering

- All synchronised records get UUIDs. Existing integer ids stay as local keys, so current screens, reports and imports keep working.
- Invoice numbers become per-origin, for example store `1-000245` and cloud `C-000012`, so the two sites never issue the same number.
- Existing invoice numbers are preserved.

### 5.8 What is guaranteed and what is not

| Guarantee                                                                                                 | Realistic?                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| The store sells with no internet, indefinitely                                                            | **Yes**                                                                                                |
| No sale is lost once the till has shown the receipt                                                       | **Yes** (committed to the store database before the receipt prints; backups protect against disk loss) |
| No sale, stock movement or payment is applied twice anywhere                                              | **Yes** (event id dedupe in the same transaction)                                                      |
| After reconnection, both sides end with identical stock, balances and totals                              | **Yes** for movements, verified by an automatic **checksum comparison** after each sync                |
| Concurrent edits of the same field are merged "correctly"                                                 | **No**: there is no objectively correct merge. They are resolved by a rule and shown to the owner      |
| The owner sees store activity in real time                                                                | **Near real time** while online (target: a few seconds); not during an outage                          |
| Remote operations that need the store's latest state (returns of store sales, shift actions) work offline | **No**: refused while the store is offline (§5.5)                                                      |
| Permission changes reach an offline store immediately                                                     | **No**: they apply when it reconnects. Disabling a user **at the store** takes effect immediately      |

### 5.9 The 20 scenarios

| #   | Scenario                                     | Expected behaviour in the proposed design                                                                                                                                                                                                                 |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Internet drops during checkout               | No effect: checkout talks only to the store server. The event waits in the outbox.                                                                                                                                                                        |
| 2   | Internet reconnects repeatedly               | Each reconnection resumes from the last acknowledged sequence; partial batches are re-sent and deduplicated.                                                                                                                                              |
| 3   | Store server restarts                        | Committed sales are in PostgreSQL (WAL). Tills show "server unreachable" and retry with the same key (K-35). The outbox continues after the restart.                                                                                                      |
| 4   | Cloud unavailable                            | Store unaffected; the outbox grows; the status shows the time of the last sync.                                                                                                                                                                           |
| 5   | Cashier retries after an apparent failure    | Same `client_ref` → the stored sale is returned (K-35, tested end to end).                                                                                                                                                                                |
| 6   | Same operation submitted twice               | Checkout: `client_ref`. Sync: event id. Every other write operation gets a request key in phase 2.                                                                                                                                                        |
| 7   | Two cashiers sell the same product           | Row locks on the store server (tested). With negative stock allowed, neither sale is refused.                                                                                                                                                             |
| 8   | Owner changes stock remotely during sales    | Recorded as a movement (receipt or adjustment), never as "set stock to X". Adds to the store's movements on arrival.                                                                                                                                      |
| 9   | Independent changes during a partition       | Movements merge by sum; field edits merge by field, with conflicts shown (§5.4).                                                                                                                                                                          |
| 10  | Supplier invoice entered while store offline | Cloud records it at once; the store applies it on reconnection; stock = sum of both sides.                                                                                                                                                                |
| 11  | Price or unit factor changes while pending   | Pending sales keep the price and factor they were rung up with (snapshot). Checkout still refuses a price that changed on the store server between scan and payment, as today.                                                                            |
| 12  | History after configuration changes          | Sale lines keep price, cost, unit and factor; reports read the snapshot.                                                                                                                                                                                  |
| 13  | Failed or partial sync                       | Applied events are committed one by one; the rest is retried. An event that fails validation goes to "sync problems" with the reason; others continue. The owner is alerted.                                                                              |
| 14  | Unexpected shutdown                          | PostgreSQL recovery; outbox and applied markers are transactional; nothing is half-applied.                                                                                                                                                               |
| 15  | Large offline backlog                        | Batches of a few hundred events per transaction, resumable. Target: a day of sales syncs in under a minute; measured in phase 4.                                                                                                                          |
| 16  | Backup and restore                           | A restore at one site rewinds its event sequence. Phase 4 defines restore as "rejoin": the restored site pulls back the events it lost from the other site before selling. Restore is refused while unsynced events would be discarded, unless confirmed. |
| 17  | Auth, permissions and audit across sites     | Users and roles are synchronised edits; password hashes (never passwords) are copied to the store, so login works offline. Every audit entry carries site, device and user UUID.                                                                          |
| 18  | Local and remote stock disagree in an outage | Expected and labelled ("cloud figures as of 14:05"). Converges after sync; the checksum comparison confirms it.                                                                                                                                           |
| 19  | Several tills                                | Unchanged: tills → store server.                                                                                                                                                                                                                          |
| 20  | Conflicting edits to the same record         | Field-level conflict detection, a rule, and a visible list (§5.4).                                                                                                                                                                                        |

## 6. Units, packaging and inventory model

### 6.1 Proposed model

- **Base unit per product**: the unit stock is counted in. Examples: piece for cake packets, gram or kilogram for cheese (**[Owner]**: grams or kilograms with three decimals), millilitre or litre for liquids.
- **Product units (packaging)**: any number per product, each with:
  - a name, for example قطعة, علبة, كرتونة or كيلو;
  - a factor to the base unit, for example carton = 24 packets;
  - its own barcodes;
  - its own selling price, or a price derived from the base price;
  - flags for "can sell" and "can buy".
- **Barcodes table**: many barcodes per product unit. A scan identifies the product **and** the unit. Scale-label rules (prefix, code length, weight or price, decimals) become settings instead of being hard-coded.
- **Measurement dimension**: count, mass or volume. Conversions are only allowed within a dimension. Product-specific packaging can bridge dimensions only through an explicit factor, for example "1 tub = 500 g" for that product.
- **Sale and purchase lines** store the product, unit, quantity in that unit, factor (snapshot), base quantity, unit price (snapshot) and line total.
- **Cart**: one line per product **unit**, so a carton and two loose packets of the same product are separate lines. For products sold by weight the cashier enters grams or kilograms, or scans a scale label.

### 6.2 Stock movements and negative stock

- `stock_movements`: product, signed base quantity, type, document reference, site, user, event id and time.
  - Types: sale, return, purchase receipt, damaged, count adjustment, transfer, opening balance.
- `products.stock_qty` becomes a cached total, maintained in the same transaction and recomputable from the movements. A nightly check compares the two.
- **Negative stock is allowed**:
  - the database trigger is removed;
  - the "damaged goods" refusal is relaxed per policy;
  - reports and alerts list negative items;
  - in your example 1 − 10 = −9, then −9 + 24 = 15.
- **Stock counts** record the counted quantity **and** the quantity the system expected at that moment, and post the difference as an adjustment. Sales made after the count still apply, even from an offline site. An absolute "set stock" never exists again (this also fixes K-37).
- **Purchases** become proper documents: supplier, lines with unit and cost, receiving posts stock movements, and the payment part stays as it is (fixes K-38).

### 6.3 Money and rounding

- Line total = quantity × unit price, rounded to 0.01 per line, as today. Quantities are stored with up to 3 decimals in the selling unit.
- Example: 0.250 kg × 180 ج.م/kg = 45.00. A gram-based price is stored per kilogram to avoid tiny unit prices.
- Returns refund the original line's price per base unit. A partial return of a weighed item, for example 100 g of a 250 g line, refunds 100/250 of the line, discount share included (the current pro-rata rule).
- **[Owner]**: cash rounding of totals (to 0.25 or 0.50 ج.م), if wanted.

### 6.4 Costing

When stock is received at a new cost, the cost of goods sold can follow the **moving average** cost or the **last purchase** cost (today it is whatever the product form says). **[Owner]**. It matters for profit reports and for negative stock: a sale made at negative stock is costed at the current cost and is not revalued later, unless you want that.

## 7. Authentication and supervisor controls

### 7.1 Username and password

- **Login**: username + password on every till and remotely.
  - Passwords are hashed with scrypt, as PINs are now; the server secret pepper is kept.
  - The existing two-layer lockout stays.
  - Minimum 8 characters, checked against a list of common passwords.
- **Migration with no lock-out**:
  - Usernames already exist and are unique.
  - After the upgrade each user logs in once with **username + current PIN** and must set a password immediately. The PIN is then disabled.
  - The super administrator gets a one-time **recovery code**, shown once at upgrade and kept on paper. A command on the store server (`cli.js reset-password`, which needs physical access) can also reset an administrator.
- **Offline**: the store server validates logins locally against the synchronised password hashes. Nothing is weakened offline.
- **Remote**:
  - The cloud requires **two-factor authentication (TOTP app)** for every account that can sign in remotely.
  - Remote sign-in is limited to roles you choose (**[Owner]**), with short sessions and rate limiting.
  - Every action is audited with site, IP address and device.
- **Password reset**:
  - Staff passwords: an administrator resets them and the user must change the password at next login.
  - Administrators: the recovery code or the store-server command. No e-mail or SMS dependency (**[Owner]** if you want e-mail).
- **Fast switching at the till**: optional. A signed-in user may lock the till and unlock it with a short PIN **only for the same user**, within the shift. This is convenience, not identification (**[Owner]**).

### 7.2 Risk-based authorisation (proposal, nothing decided)

Today every control is a role permission. Approvals are never requested. The table is my recommendation; each "approval?" cell is a question for you.

| Operation                                      | Risk                                       | Recommended control                                                                             | Approval?                                                                                       |
| ---------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Edit an unfinished cart                        | None; nothing is recorded yet              | No control                                                                                      | **No (decided)**                                                                                |
| Complete a sale                                | Normal                                     | `pos.sell`                                                                                      | No                                                                                              |
| Credit (آجل) sale                              | Customer debt                              | `pos.credit`; optional credit limit per customer                                                | **[Owner]** over the limit                                                                      |
| Discount                                       | Revenue leakage                            | `pos.discount` + a maximum per role (amount or %)                                               | **[Owner]** above the role's maximum                                                            |
| Price override at checkout                     | Revenue leakage                            | Does not exist today. Recommend keeping it impossible; prices change only in the product screen | **[Owner]** if wanted                                                                           |
| Return or refund of a completed sale           | Cash leaves the drawer; classic fraud path | `sales.return` (cashiers do not have it today), reason required                                 | **[Owner]**: let cashiers return with supervisor approval, or keep returns manager-only (today) |
| Cancel a completed sale                        | Same as a full return                      | Only as a full return, never a deletion                                                         | Same as returns                                                                                 |
| Product price, unit or cost change             | Margins                                    | `products.manage`; every change audited with old and new values                                 | No                                                                                              |
| Stock receipt (purchase)                       | Stock value                                | `suppliers.manage` / `inventory`                                                                | No                                                                                              |
| Stock count adjustment, damaged goods          | Hides theft                                | `inventory.adjust` (new), reason required                                                       | **[Owner]**: above a value threshold                                                            |
| Expense or supplier payment from the drawer    | Cash leaves the drawer                     | `expenses.manage` / `suppliers.manage`                                                          | **[Owner]**: above a threshold                                                                  |
| Shift close with a difference                  | Cash loss                                  | Recorded, reported                                                                              | **[Owner]**: supervisor acknowledgement above a threshold                                       |
| Users, roles, settings, backup, restore, reset | Full control                               | Super/store admin + password re-entry; remote requires 2FA; reset unavailable once sync is on   | No (re-authentication instead)                                                                  |

- **How approval works when required**: the supervisor types their own username and password on the till, or uses a fast supervisor code (**[Owner]**).
- Approvals **and refusals** are both recorded, with the approver's identity, the till, the amount and the reason.

## 8. Risk register

| Risk                                                        | Impact                     | Likelihood | Mitigation                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data-model migration corrupts history                       | Severe                     | Medium     | Migration on a copy first; opening-balance movements reproduce today's stock and balances exactly; parity checks like the SQLite import; rollback = previous version + untouched backup |
| Sync applies an event twice                                 | Severe (money, stock)      | Low        | Unique applied-event key in the same transaction; failure-injection tests; nightly checksum comparison                                                                                  |
| Sync silently stalls                                        | High (owner sees old data) | Medium     | Status screen, last-sync time on every remote screen, alert after N minutes, sync-problems list                                                                                         |
| Field conflicts resolved wrongly                            | Medium                     | Low–medium | Field-level detection; visible list; owner confirms                                                                                                                                     |
| Long outage → large backlog                                 | Medium                     | Medium     | Batching, resumable transfer, load test with a month of data                                                                                                                            |
| Restore at one site rewinds events                          | Severe                     | Low        | "Rejoin" procedure; restore refused while unsynced events would be lost                                                                                                                 |
| Cloud breach (public exposure)                              | Severe                     | Medium     | 2FA, rate limits, minimal open ports, automatic security updates, encrypted backups, audit; only the store connects outwards                                                            |
| Store server disk failure                                   | Severe                     | Low        | The cloud copy becomes an **off-site backup**; local scheduled backups; UPS                                                                                                             |
| Negative stock hides data-entry problems                    | Medium                     | High       | Negative-stock report and alerts; receipts as documents; count adjustments with reasons                                                                                                 |
| Unit or factor misconfiguration (carton = 42 instead of 24) | Medium                     | Medium     | Factor snapshots; history unaffected; factor change requires confirmation and is audited; a stock count fixes the quantity                                                              |
| Clock drift between sites                                   | Low                        | Medium     | Order by per-origin sequence, not clocks; UTC stored; clocks only used for display and for the field-conflict rule                                                                      |
| Scope and timeline                                          | High                       | High       | Phased plan; each phase shippable; the store keeps working on the current version until each phase passes its acceptance criteria                                                       |

## 9. Implementation roadmap

Each phase is a separate PR series with its own tests and acceptance criteria. Phases 1–3 are useful even without the cloud.

| Phase                                               | Content                                                                                                                                                                                                                                                                                                | Depends on | Acceptance criteria                                                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Close-out** (now)                              | K-24 (done here); merge PRs #1–#5 after review; go-live checks on a test PC; K-36 fix if confirmed                                                                                                                                                                                                     | –          | Go-live plan checks 1–9 passed with evidence                                                                                                                                                                     |
| **1. Ledgers and negative stock**                   | `stock_movements`; opening balances from current stock; every stock change posts a movement; no absolute writes (K-37); purchase documents that receive stock (K-38); counts as adjustments; negative stock allowed with reports and alerts; customer/supplier balances verified against their ledgers | 0          | Migration parity (stock and balances identical before and after); stock = Σ movements for every product after the full test suite; concurrency tests (parallel sales, receipts and counts); K-37 regression test |
| **2. Units and packaging**                          | Base unit, product units with factors, multiple barcodes, configurable scale labels, unit-aware cart, sale, return and purchase lines with snapshots                                                                                                                                                   | 1          | Cheese, carton and mixed-unit scenarios end to end; returns of fractions and packs; rounding tests; reports in base units                                                                                        |
| **3. Username + password, supervisor controls**     | Password login, migration from PIN, recovery code, CLI reset; the policy chosen from §7.2; approvals and refusals audited                                                                                                                                                                              | –          | Upgrade test from a copy of the real store: every user can sign in once with the PIN and set a password; no lock-out; approval paths tested per role                                                             |
| **4. Event log and sync engine**                    | UUIDs, per-origin numbering, event outbox, applied-events inbox, ordered exactly-once apply, field-conflict detection, checksum comparison, sync status and problems screens, rejoin after restore                                                                                                     | 1, 2, 3    | Failure-injection suite (below) green; a month of synthetic data synced and verified; repeated disconnects every few seconds for an hour with zero differences                                                   |
| **5. Cloud deployment and owner web access**        | Hosted service (**[Owner]**: provider and budget), public TLS, 2FA, owner web app, forwarding of home-site operations, monitoring, encrypted backups                                                                                                                                                   | 4          | Security review (exposed ports, auth, rate limits); scenarios A–F rehearsed with the real store link; restore drill                                                                                              |
| **6. Optional: till offline from the store server** | D-040 using the phase 4 event mechanism                                                                                                                                                                                                                                                                | 4          | Same failure-injection suite between till and store server                                                                                                                                                       |

### Testing required for phase 4 and later

- **Property tests**: random interleavings of sales, returns, receipts, payments and edits on two sites with random disconnections. Afterwards both sites must have identical stock, balances, invoice sets and report totals, equal to a single-site replay.
- **Failure injection**:
  - drop the request;
  - drop the reply after commit (as in the K-35 test);
  - kill the process in the middle of a batch;
  - duplicate and reorder deliveries;
  - restart PostgreSQL;
  - fill the disk;
  - shift the clock.
- **Reconnection**: an outage of hours with thousands of events on both sides; flapping links.
- **Multi-till**: 3 or more tills selling the same products during the outage.
- **Migration**: a copy of the real store upgraded through every phase with parity reports, plus a rollback rehearsal.
- **Security**:
  - authentication bypass attempts;
  - replay of sync messages from another store key;
  - a tampered event payload;
  - cloud role escalation.
- **Release readiness**:
  - all suites green in CI on Linux and Windows;
  - a go-live rehearsal on a test PC with a real cloud instance;
  - a two-week pilot with the cloud in read-only mode before remote writes are enabled.

## 10. Owner decisions

### Required before the related phase starts

| #   | Question                                                                                                                                    | My recommendation                                          | Needed for |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| 1   | Approve the overall approach (§4: store authority + cloud copy + event sync) and the phase order                                            | Yes                                                        | All        |
| 2   | **K-36**: count change kept as customer credit as cash in the drawer?                                                                       | Yes, fix now (small change with a test)                    | Phase 0    |
| 3   | Negative stock: allowed for every product, or can some products (for example cigarettes or high-value items) block it?                      | Allowed everywhere, with a negative-stock alert            | Phase 1    |
| 4   | Cost method: moving average or last purchase cost?                                                                                          | Moving average                                             | Phase 1    |
| 5   | Weighed products: stock in grams or in kilograms (3 decimals)? Any cash rounding of totals?                                                 | Kilograms with 3 decimals; no cash rounding                | Phase 2    |
| 6   | Returns: managers only (today), or cashiers with supervisor approval?                                                                       | Cashiers with supervisor approval, reason required         | Phase 3    |
| 7   | Discount limits per role, and approval above them?                                                                                          | Cashier up to a fixed amount; above it supervisor approval | Phase 3    |
| 8   | Thresholds for approval of expenses, stock adjustments and shift differences (or none)                                                      | Shift difference above 50 ج.م: supervisor acknowledgement  | Phase 3    |
| 9   | Who may sign in remotely, and is 2FA acceptable for them?                                                                                   | Owner and store admin only; 2FA required                   | Phase 5    |
| 10  | Which operations the owner may perform remotely while the store is **offline** (supplier invoices, stock receipts, product and price edits) | Those three; returns and shift actions only while online   | Phase 4    |
| 11  | Same field edited at both sites during an outage: later edit wins and is shown to you, or both held until you choose?                       | Later edit wins, shown for confirmation                    | Phase 4    |
| 12  | Cloud hosting: provider, region and monthly budget                                                                                          | A small VPS in a nearby region, roughly 10–30 USD/month    | Phase 5    |

### Optional preferences

- A short PIN to unlock the till for the **same** user within a shift (§7.1).
- A remote password reset by e-mail (adds a dependency; not recommended at first).
- A VPN for read-only remote viewing of the store server before phase 5 (§3, option B), as a stop-gap.
- Till offline selling when the store server is down (phase 6).
