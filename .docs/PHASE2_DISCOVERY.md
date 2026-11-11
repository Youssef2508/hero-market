# Phase 2 discovery: owner access from the cloud, two-way synchronisation

Written for the owner and the developer, 2026-11-11, from the code on `main` at `342ca52` (HeroMarket 1.5.2). Nothing was implemented, deployed, bought or changed for this document. It records what exists, what the new requirement changes, the hosting research, and the open decisions. The architecture proposal and roadmap follow once the owner has answered the questions in §8.

> **Superseded in part (same day).** The owner then clarified that the cloud must work on its own with the shop PC switched off. Sections 2, 3, 4, 5 and 6 below are replaced by [PHASE2_ARCHITECTURE.md](PHASE2_ARCHITECTURE.md) and [PHASE2_CAPABILITY_MATRIX.md](PHASE2_CAPABILITY_MATRIX.md). Section 1 (what exists) and section 7 (baseline) stand.

## 1. What exists today (verified in the code)

### 1.1 The program

- **One service, three ways to run it** (`src/server/app.js`, `src/main/backend.js`):
  - _local_: inside the desktop program, against the PC's own PostgreSQL 17 (the shop);
  - _standalone_: the same, against a PostgreSQL the store manages;
  - _client_: a till that calls a store server over HTTPS (`src/server/cli.js`, `Dockerfile.server`, `docker-compose.yml`, Caddy for TLS).
- **Every screen talks to the service through one function**, `api(operation, data)` (`src/renderer/src/lib/api.js`). The service has **161 named operations** (82 change data), each with its permission checked in the service, never in the screen.
- **Sign-in:** username and password (scrypt), sessions stored hashed, 12 hours, attempt limits per terminal and per address, a recovery code for the system administrator.
- **Money:** immutable ledgers (shift drawers `safe_ledger`, treasury by payment method `treasury_ledger`, customers, suppliers), closed shifts are final, corrections are reversals. Stock is the sum of immutable `stock_movements`.
- **Retries:** most money operations carry a request id (`clientRef`) and are recorded once.
- **Desktop-only parts:** printing (15 calls), backup and restore files, connection settings. The screens are designed for a desktop width (31,630 lines; layouts stop adapting below about 720–900 px).
- **Tests:** 61 service test files and 35 unit test files; CI runs them on Linux, Windows (bundled PostgreSQL) and Docker.

### 1.2 Synchronisation that is already built (stage 4, phase 4)

Built, tested with fault injection (21 scenarios in `sync.test.js` and `syncRecovery.test.js`), shipped in the installer, **never connected to a real cloud** (nothing is hosted).

| Part                | What it does                                                                                                                                                   | Where                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Change capture      | A trigger on 40 of the 52 tables writes each changed row to an outbox **in the same transaction** as the sale, payment or movement                             | migration 0009 and later               |
| Push                | The PC sends unacknowledged rows in batches cut at transaction boundaries; acknowledged only after the cloud committed                                         | `sync/agent.js`                        |
| Cloud store         | Rows kept as versioned JSON; a row is replaced only by a strictly newer version; one transaction per batch                                                     | `cloud/app.js`, `cloud_rows`           |
| Owner commands      | The owner's operation is queued in the cloud; the PC applies it **exactly once**, in one transaction with its own record; the result travels back like any row | `sync/commands.js`, `applied_commands` |
| Conflicts           | Field edits carry the values the owner saw; a field changed in the shop meanwhile is kept and reported                                                         | same                                   |
| Epochs and recovery | A restored backup starts a new epoch; rows that reached the cloud after the backup are written back; an old copy of the PC is refused                          | `sync/recovery.js`                     |
| Check               | Per-table count and fingerprint compared after each cycle                                                                                                      | `agent.check`                          |
| Secrets             | Password data, sessions, role permissions and the link token never leave the PC                                                                                | `hm_sync_row`, `sync_tables`           |

Decisions in force from that stage (owner, 2026-10-14, D-042 / D-047): the PC is the only writer of store data; the cloud is for the owner only, with mandatory two-factor sign-in; remote writes limited to supplier invoices, stock receipts, product edits and price edits; nothing remote touches a drawer.

### 1.3 What is missing for the new requirement

| Missing                                    | Detail                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The owner's web application                | No sign-in, no screens, no hosting. The cloud service today only talks to the PC                                                                                                                 |
| Remote operations beyond four types        | The four command handlers are written by hand. Supplier payments, preliminary invoices, payment-request approval, returns, customers, expenses, treasury, users and settings have no remote path |
| A cloud copy the existing reports can read | The cloud keeps JSON rows. The 79 read operations (reports, shifts, invoices, balances) need real tables                                                                                         |
| Near real time                             | The PC polls every 15 seconds; the cloud cannot tell the PC "a command is waiting", and cannot tell whether the shop is connected right now                                                      |
| Sync while the program is closed           | The agent runs inside the desktop program. With the program closed, nothing is sent or applied                                                                                                   |
| Cost of the check                          | The fingerprint check reads every synchronised row on both sides in every cycle. Fine in tests; too heavy after a year of sales                                                                  |
| Tables not sent                            | `role_permissions`, `receipt_templates` and three bookkeeping tables. Needed only if roles or receipt design are managed remotely                                                                |

## 2. The central decision: one set of books

Two designs can satisfy "both sides work while disconnected".

|                                                                                                 | A. The shop PC stays the only book; the owner's operations are requests it applies | B. Two books (shop and cloud) that each accept operations and merge later                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Shop works with no internet                                                                     | Yes                                                                                | Yes                                                                                                                |
| Owner works while the shop is offline                                                           | Yes: saved in the cloud, shown as waiting, applied when the shop reconnects        | Yes: final in the cloud at once                                                                                    |
| Invoice numbers                                                                                 | One sequence, the shop's                                                           | Two sequences or global ids: every table and every printed number changes                                          |
| Business rules                                                                                  | Run once, in the shop, by the existing code                                        | Run twice, on different data, and must give the same answer                                                        |
| Order-dependent values (latest purchase price, package prices, balances limits, request states) | Decided once, in one order                                                         | Must be recomputed after every merge                                                                               |
| A conflict                                                                                      | The request is refused or partly applied, with the reason, and the owner decides   | Two committed facts disagree; one must be reversed after the fact                                                  |
| What already exists                                                                             | Engine, proof suite, recovery                                                      | Nothing                                                                                                            |
| Risk                                                                                            | Low                                                                                | High, for no gain in the shop: the shop PC cannot know the owner's operation before it reconnects in either design |

**Recommended: A**, extended so that it covers the owner's whole role instead of four operations. The only thing B adds is that the owner's entry is "final" in the cloud while the shop is still offline, and that is exactly the part that cannot be made safe: an operation that the shop's latest state would refuse cannot honestly be final.

**What the owner experiences with A**

- Shop connected: the operation reaches the shop in about a second and the phone shows the real result (for example the invoice number).
- Shop not connected: the phone says "saved, waiting for the shop", and the operation is listed until the shop applies it. Then it becomes "applied", "applied in part" or "refused", with the reason.
- The figures on the phone always carry the time of the last synchronisation, and are never called live when they are not.

**The honest limit:** while the two sides are apart, the phone shows the shop as of the last synchronisation plus the owner's own waiting operations. They become one consistent state when the shop reconnects, without losing or doubling anything.

## 3. How each kind of operation would reconcile

| Kind                        | Examples                                                                       | Rule when it reaches the shop                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Adds to a ledger            | Supplier invoice with goods, stock receipt, expense or deposit on the treasury | Applied; it adds to whatever the shop did meanwhile. Refused only if what it names no longer exists                |
| Money against a balance     | Supplier payment, customer collection                                          | The existing limits are checked against the balance at that moment; refused with the reason if they no longer hold |
| Field edit                  | Product, price, supplier or customer details, settings                         | Fields unchanged in the shop since the owner looked are applied; the others are kept and reported                  |
| Change of state             | Approve or reject a payment request, complete or cancel a preliminary invoice  | Applied only if the record is still in the state the owner saw; otherwise refused                                  |
| Needs the cash or the goods | Till sale, drawer movement, opening or closing a shift, stock count            | Not remote                                                                                                         |
| Never remote                | System reset, restore, the cloud link itself                                   | Not remote                                                                                                         |

Remote money never enters or leaves a drawer: it is on credit, or on the treasury by payment method, as the service already does for an administrator with no open shift (D-089).

## 4. Feature parity matrix (first draft; the "remote" column follows §8)

| Module                                     | Works offline in the shop | Remote: view                                  | Remote: change (proposed)                              | Sync                  | Special rule                                                            |
| ------------------------------------------ | ------------------------- | --------------------------------------------- | ------------------------------------------------------ | --------------------- | ----------------------------------------------------------------------- |
| Till sale (`pos.*`)                        | Yes                       | Invoices appear                               | No                                                     | Rows up               | Needs goods and drawer                                                  |
| Shifts: open, close, audit                 | Yes                       | Open and closed shifts, details, close report | No                                                     | Rows up               | Counted cash is physical; a closed shift is final                       |
| Shift details and reports                  | Yes                       | Yes                                           | –                                                      | Rows up               | Expected amounts only for administrators (blind close)                  |
| Sales list and invoice detail              | Yes                       | Yes                                           | –                                                      | Rows up               | –                                                                       |
| Customer returns                           | Yes                       | Yes                                           | To decide (Q3)                                         | Rows up; command down | Refund goes to debt, credit, or an open drawer                          |
| Payment method correction                  | Yes                       | Yes                                           | Possible                                               | Command down          | Only while the sale's shift is open                                     |
| Reprint                                    | Yes                       | View only (no printer)                        | –                                                      | –                     | Desktop printer                                                         |
| Products, units, barcodes, categories      | Yes                       | Yes                                           | Yes                                                    | Command down          | Field conflicts; a barcode change moves its history                     |
| Prices                                     | Yes                       | Yes                                           | Yes                                                    | Command down          | Field conflicts; package price follows the piece price                  |
| Stock movements, negative stock, valuation | Yes                       | Yes                                           | –                                                      | Rows up               | –                                                                       |
| Stock count, adjustment, damaged goods     | Yes                       | Yes                                           | No                                                     | Rows up               | Physical observation                                                    |
| Suppliers                                  | Yes                       | Yes                                           | Yes                                                    | Command down          | Field conflicts                                                         |
| Supplier invoices (purchases)              | Yes                       | Yes                                           | Yes                                                    | Command down          | Adds stock and payable; latest purchase price (Q6)                      |
| Purchase returns                           | Yes                       | Yes                                           | Yes                                                    | Command down          | Limited to what was received                                            |
| Preliminary supplier invoices              | Yes                       | Yes                                           | Complete or cancel: yes; create: on credit or treasury | Command down          | State must be unchanged; 30-minute reservation                          |
| Supplier debt payments                     | Yes                       | Yes                                           | From the treasury: yes                                 | Command down          | Limit checked at apply time                                             |
| Supplier payment requests                  | Yes                       | Yes, with a notice                            | Approve or reject: yes                                 | Command down          | State must be pending; 5-minute reservation; rejection reverses in full |
| Customers and addresses                    | Yes                       | Yes                                           | Yes                                                    | Command down          | Field conflicts; phone and code stay unique                             |
| Customer collections                       | Yes                       | Yes                                           | To the treasury: to decide (Q4)                        | Command down          | –                                                                       |
| Expenses and categories                    | Yes                       | Yes                                           | On the treasury: yes                                   | Command down          | –                                                                       |
| Treasury                                   | Yes                       | Yes                                           | Yes                                                    | Command down          | Rows never change; corrections are reversals                            |
| Discount rules                             | Yes                       | Yes                                           | Yes                                                    | Command down          | Applies to future sales only                                            |
| Reports and dashboard                      | Yes                       | Yes                                           | –                                                      | Rows up               | Labelled with the sync time                                             |
| Users and roles                            | Yes                       | Yes                                           | To decide (Q9)                                         | Command down          | No password ever leaves the PC                                          |
| Settings, receipt design                   | Yes                       | Yes                                           | To decide (Q9)                                         | Command down          | Field conflicts                                                         |
| Audit log                                  | Yes                       | Yes                                           | –                                                      | Rows up               | Remote actions marked with their request id                             |
| Backup, restore, import, reset             | Yes                       | No                                            | No                                                     | –                     | Local only                                                              |
| Cheque archive, old till services          | Yes                       | Yes                                           | No                                                     | Rows up               | Read-only history                                                       |

## 5. Hosting research (official pages read on 2026-11-11)

**What has to run:** one always-on Linux server with the cloud service, PostgreSQL and a TLS proxy, in Docker Compose. About 2 GB of memory is comfortable (1 GB is tight once the cloud holds real tables). Data: roughly 1–2 GB per year.

**Measured from the development PC in Egypt** (TCP connect, best of four): Frankfurt and Milan 80–90 ms, Hetzner Nuremberg and Falkenstein about 100 ms, Helsinki 218 ms, UAE 169 ms, US East 157 ms.

| Option                                         | Configuration                                                                       | Listed price                                                                                                                          | With backups                                                                             | Sleeps                                                                       | Notes                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Hetzner Cloud CX23**                         | 2 vCPU, 4 GB, 40 GB, IPv4 included, 20 TB                                           | €5.99 / month excl. VAT                                                                                                               | + automatic backups, 7 kept (page shows "from €1.098"; 20 % is my arithmetic) ≈ **€7.2** | No                                                                           | Nuremberg or Helsinki. **The page marked these plans "currently not available" today**; must be checked at order time |
| **AWS Lightsail**                              | 2 vCPU, 2 GB, 60 GB, 3 TB, IPv4                                                     | $12 / month                                                                                                                           | + snapshots $0.05 / GB-month ≈ **$13–15**                                                | No                                                                           | Frankfurt. The $7 plan (1 GB) is tight                                                                                |
| **DigitalOcean Droplet**                       | 1 vCPU, 2 GB, 50 GB, 2 TB                                                           | $12 / month                                                                                                                           | + weekly backups 20 % = **$14.40**                                                       | No                                                                           | Frankfurt, Amsterdam, London                                                                                          |
| Akamai (Linode)                                | 1 CPU, 2 GB, 50 GB, 2 TB                                                            | $12 / month                                                                                                                           | + backups $2.50 = $14.50                                                                 | No                                                                           | European regions not named on the page                                                                                |
| Render                                         | Web service 512 MB + Postgres 1 GB                                                  | $7 + $19 + storage $0.30 / GB (**from Render's own articles and search results; the pricing page did not show its tables**) ≈ **$29** | Point-in-time recovery, 3 days                                                           | Paid: no. Free: sleeps after 15 minutes, free database deleted after 30 days | Two managed services; least to maintain; most expensive                                                               |
| Railway                                        | Usage: RAM $10 / GB, CPU $20 / vCPU, volume $0.15 / GB, egress $0.05 / GB; Hobby $5 | **My estimate ≈ $17–22** for 1.5 GB always on                                                                                         | Volume backups not shown                                                                 | Not shown                                                                    | Hobby volumes limited to 5 GB; the bill moves with usage                                                              |
| Fly.io                                         | Two 1 GB machines (Frankfurt $7.73 each), 10 GB volume $1.50, IPv4 $2               | **≈ $19**; managed Postgres from $38                                                                                                  | Snapshots $0.08 / GB, 10 GB free                                                         | No                                                                           | No free allowance for new organisations                                                                               |
| Google Cloud e2-micro (earlier recommendation) | 1 GB, US regions only                                                               | Free VM and disk; IPv4 price not readable today (about $3.65 in the October estimate)                                                 | –                                                                                        | No                                                                           | Now too small: 1 GB for the service plus a real database copy                                                         |

Extras for every option: a domain name (about $10–15 per year; my estimate, no official figure read), off-site encrypted database copies (Backblaze B2: first 10 GB free; Cloudflare R2: 10 GB free), Let's Encrypt certificate (free). Egyptian VAT (14 %) may be added by the provider; not confirmed.

**Recommendation:** one small server with Docker Compose (service, PostgreSQL, Caddy). First choice Hetzner CX23 in Nuremberg, about €7.2 per month (≈ €86 per year) plus the domain, **if it can be ordered**; otherwise AWS Lightsail $12 in Frankfurt, about $13–15 per month. Both are fixed-price and always on. The managed platforms cost two to four times more for nothing this project needs.

Sources: [Hetzner cost-optimized](https://www.hetzner.com/cloud/cost-optimized/), [Hetzner regular performance](https://www.hetzner.com/cloud/regular-performance/), [Hetzner backups](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/), [Hetzner Storage Box](https://www.hetzner.com/storage/storage-box/), [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets), [DigitalOcean backups](https://docs.digitalocean.com/products/backups/details/pricing/), [DigitalOcean managed databases](https://www.digitalocean.com/pricing/managed-databases), [AWS Lightsail](https://aws.amazon.com/lightsail/pricing/), [Lightsail FAQ](https://aws.amazon.com/lightsail/faq/), [Akamai Cloud](https://www.akamai.com/cloud/pricing/cpu), [Render pricing](https://render.com/pricing), [Render free](https://render.com/docs/free), [Render Postgres backups](https://render.com/docs/postgresql-backups), [Render bandwidth](https://render.com/docs/outbound-bandwidth), [Railway pricing](https://railway.com/pricing), [Fly.io pricing](https://docs.fly.io/about/pricing), [Fly.io Postgres](https://docs.fly.io/postgres), [Google Cloud free tier](https://docs.cloud.google.com/free/docs/free-cloud-features), [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/), [Backblaze B2](https://www.backblaze.com/cloud-storage/pricing), [Hetzner availability report](https://www.vincentschmalbach.com/hetzner-cheap-cloud-unavailable-price-increases/). Vultr's pricing page refused the request and is not included.

## 6. Direction of the technical design (to be detailed in the proposal)

1. **Remote operations run the shop's own code.** A request names a service operation and its data. The PC runs that operation's registered handler as the owner, inside the one transaction that also records the request, so there is no second copy of any rule. Every handler already takes its transaction from one place (`ctx.tx`), which makes this possible. An allow-list decides which operations are remote.
2. **The cloud gets real tables**, rebuilt from the versioned rows it already stores, so the existing read operations and reports run there unchanged.
3. **One outgoing connection from the PC** tells it at once that a request is waiting and tells the cloud that the shop is connected. Polling stays only as a slow fallback.
4. **The owner's application** is the existing screens' data layer behind a new phone-first layout, installable from the browser (PWA). It never works without a connection to the cloud.
5. **Cloud sign-in** is separate from the shop's: one owner account, password plus authenticator code, no registration.
6. **The fingerprint check** moves from every cycle to a schedule.

## 7. Baseline

The full suite on `main` (`342ca52`) before any Phase 2 change, run on 2026-11-11 against disposable databases: **487 of 487 pass**, none skipped.

## 8. Questions for the owner

Listed in the hand-over message of 2026-11-11, with a recommended answer for each.
