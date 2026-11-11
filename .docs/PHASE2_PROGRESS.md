# Phase 2 progress

Written for the owner. Updated as each part is finished. Branch `feature/phase2-owner-cloud`; nothing is merged, released, deployed or bought. The shop stays on 1.5.2.

## Milestone 1: connected operation and data consistency

**Status: the service side is built and tested. The milestone is not complete:** the phone screens, the Windows background service and the pairing code are not done, and nothing has run on a real server or a real internet connection.

### What works now (proven on two disposable databases, a shop and its cloud)

| Your acceptance point                                                | Result                                                                                                               | Evidence                                                                                                                           |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. The same open shift and figures from both ways in                 | Pass                                                                                                                 | `cloudConnected.test.js` 1: seven read operations answer identically from the shop and the cloud, before and after a sale          |
| 2. A desktop sale appears in the cloud with identical effects        | Pass                                                                                                                 | Same test: the cloud's copy equals the shop row for row; the waiting screen request returns by itself                              |
| 3. An operation from the cloud runs against the shop's database      | Pass                                                                                                                 | Tests 2 and 3: the records are in the shop's database, made by the operation's own handler                                         |
| 4. A supplier invoice created remotely is a real invoice in the shop | Pass                                                                                                                 | Test 2: invoice, stock, payable and the treasury payment, in the shop                                                              |
| 5. Supplier payments and customer collections use the same accounts  | Pass                                                                                                                 | Test 3: the same day through the desktop and through the internet leaves identical treasury, drawer, supplier and customer records |
| 6. Returns give identical stock, debt and cash effects               | Pass                                                                                                                 | Test 3: a return refunded from the sale's own open shift, identical on both runs                                                   |
| 7. A price changed remotely is the till's price                      | Pass                                                                                                                 | Test 2: the next desktop sale charges the new price                                                                                |
| 8. Permissions identical; internet access is its own permission      | Pass                                                                                                                 | Test 4                                                                                                                             |
| 9. Duplicate delivery and lost answers never duplicate               | Pass                                                                                                                 | Test 5                                                                                                                             |
| 10. The Windows service keeps syncing with the desktop closed        | **Not done** (milestone 4). The link runs inside the desktop program for now                                         |
| 11. Cloud operations with the shop PC off                            | **Not done** (milestone 3). A change is refused with a clear message; reading works and says how old the figures are |
| 12. Recovery after long disconnections                               | Shop to cloud: pass (existing 21 scenarios). Cloud to shop: milestone 3                                              |
| 13. Conflicts detected and listed                                    | Milestone 3                                                                                                          |
| 14. Backups restore                                                  | Existing tests pass; the new operation record is in the backup. Cloud backup: milestone 5                            |
| 15. No regression in the desktop program                             | See "Test results"                                                                                                   |

Updates without refreshing: the service side is done and tested (a change reaches the cloud in well under a second in the tests; a screen's open request returns when something changes). **No screen uses it yet**, on the desktop or the phone; that is milestone 2.

### Test results

| Run                                                          | Result                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| Baseline before Phase 2 (`main` at `342ca52`)                | 487 of 487                                                   |
| Full suite with milestone 1                                  | **495 of 495** (487 existing + 8 new), run on the final code |
| New: `cloudConnected.test.js`                                | 5 of 5                                                       |
| New: `operationKinds.test.js`                                | 3 of 3                                                       |
| Existing sync proof (`sync.test.js`, `syncRecovery.test.js`) | 23 of 23, with one assertion changed (below)                 |
| Lint                                                         | 0 errors                                                     |
| Format check                                                 | clean                                                        |

**One existing assertion was changed, on purpose.** `sync.test.js` used to require that only a short list of user fields leaves the PC. You decided that the same username and password must work on both sides, so the user row now travels with its password hash (never a plain password, never the old PIN columns). The test now asserts exactly that. No test was removed or weakened otherwise.

### What was built

| Part                                                                                                            | File                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Where each of the 161 operations runs for the internet way in                                                   | `src/server/sync/operationKinds.js`                      |
| Carrying out an internet operation in the shop, at most once                                                    | `src/server/sync/remoteOps.js`, `src/server/app.js`      |
| The cloud's end: its copy, the hand-over, reachability and freshness                                            | `src/server/cloud/link.js`, `src/server/cloud/app.js`    |
| The shop's end: push on every change, the open link                                                             | `src/server/sync/agent.js`, `src/server/modules/sync.js` |
| Writing received rows into real tables                                                                          | `src/server/sync/recovery.js`                            |
| Database: operation record, whole user row, permissions and receipt templates synchronised, change notification | migration `0032`, cloud migration `0003`                 |
| Permission «الدخول عبر الإنترنت»                                                                                | `src/server/auth/permissions.js`                         |
| Starting a cloud and registering its store                                                                      | `src/server/cli.js` (`cloud`, `cloud-register`)          |
| The operation record is part of the backup                                                                      | `src/server/modules/backup.js`                           |
| The capability matrix, generated from the routing table                                                         | `scripts/capability-matrix.js`                           |

### Decisions taken while building (in `DECISIONS.md`, D-101)

- **Shop unreachable, for now:** a change from the internet is refused at once and nothing is queued. Milestone 3 replaces the refusal with the cloud doing the work itself.
- **Password hashing stays scrypt for now.** You asked for Argon2id if possible. The program's Node.js version has no built-in Argon2, and adding a native library would have to be built into the Windows installer. scrypt is also a memory-hard function accepted for password storage. I will revisit this in the security milestone and tell you the cost of switching before doing it.
- **Internet access is granted to a role**, in the existing roles screen. To let one person in, give them a role that has it. A per-user switch can be added in the security milestone if you want it.
- **Choosing a first password and using the recovery code** are refused from the internet for now, with a message to do it on the shop PC.

### Pairing (D-102, approved and built)

Today nothing links by itself: a person runs a command on the server that prints a token once, and an administrator types the address, the store id and the token on the shop PC. A cloud serves one store, and link settings are not in backups, so a development PC or a restored copy is never linked by accident.

**Built (owner approved 2026-11-11, D-102), service side:** the server prints a short pairing code valid for 15 minutes and usable once (`cloud-pair`); an administrator enters it on the shop PC (`sync.pair`); the PC creates its own secret, which is never shown and of which the cloud holds only the hash; both sides get the store's name and a short fingerprint. Repeated wrong codes cancel the open code.

A replacement PC needs a new code and must be a fresh installation: the cloud refuses a takeover by a PC that has sales or shifts of its own, before the code is used. Using the code locks the old PC out at once and changes nothing in the cloud's records. The new PC pauses until it has received the store; its own first-run records give way to the store's, and everyone signs in again with their store account. Proven by `pairing.test.js`, and done once in the real desktop program: pair a fresh PC on the «المزامنة السحابية» screen, «استلام بيانات المتجر», sign in as the store's owner, see the store's open shift.

### Risks and open points

1. Everything so far ran in tests on one machine. A real server, real internet and a real phone come in the pilot.
2. The link runs inside the desktop program until milestone 4, so with the program closed the shop counts as unreachable.
3. The per-cycle comparison of every table (inherited from the earlier engine) still runs every 15 seconds; it will be moved to a schedule before the pilot.
4. OVHcloud's checkout price, tax, billing term and regions are still to be confirmed on its order page (milestone 5). Nothing has been ordered.

## Milestone 2: the browser build and the phone interface

**Status: the phone works for every screen in the browser; checked on this PC only, not yet on a real phone or a real server.**

### Done

| Part                         | What it is                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser build                | The same screens built for a browser (`npm run build:web` → `out/web`). One small file stands in for the desktop bridge (`lib/webBridge.js`); no screen was copied or rewritten                                                                                           | Both builds succeed                                                                                                                                                                                                                       |
| Browser sessions             | An HTTP-only, same-site, secure cookie the page cannot read; every request must also carry our own header; the page never receives the token; sign-out clears it                                                                                                          | `cloudWeb.test.js`                                                                                                                                                                                                                        |
| Serving the pages            | The cloud serves the build next to the API and never a file outside it                                                                                                                                                                                                    | `cloudWeb.test.js` (four path-escape attempts)                                                                                                                                                                                            |
| Phone shell                  | Below 760 px: the menu slides in, a bottom bar holds البيع، الورديات، الموردون، الأصناف، المزيد; dialogs fill the screen with their buttons in reach; wide tables scroll inside their own frame; filters stack; fields do not make the phone zoom; the till is one column | `scripts/phone-check.js`: all 30 screens open from the internet pass at 390 × 844 and 360 × 740 (no sideways scrolling, nothing cut off, no touch target under 40 px). Ten main dialogs opened at 390 × 844: full screen, buttons visible |
| Shop PC screens hidden       | The cloud link and the backup files are not offered from the internet                                                                                                                                                                                                     | Same check                                                                                                                                                                                                                                |
| Screens update by themselves | One open request tells the screens when something changed; shifts, shift details, treasury and the shared management lists reload                                                                                                                                         | A sale at the shop appeared on a phone showing the open shift after 0.9 s; expected cash 631 → 781, the new invoice listed                                                                                                                |
| Status strip                 | Connected and up to date; connected with changes arriving; or shop unreachable with the time of the last synchronisation. Operations waiting for the shop's confirmation are listed with a note not to repeat them                                                        | Seen in the browser                                                                                                                                                                                                                       |
| Home-screen install          | A web app manifest and the brand icons in the browser build only                                                                                                                                                                                                          | Served with the right type                                                                                                                                                                                                                |
| Camera scanning              | A camera button on the till where the browser can read barcodes (Chrome and Edge on Android). The code read goes through the till's normal scan path                                                                                                                      | With a stand-in reader on this PC: the product was added to the cart. **Not available on iPhone Safari**                                                                                                                                  |
| Pairing screen               | «ربط برمز الربط» on the desktop's «المزامنة السحابية» screen; the manual form stays as «الربط اليدوي (متقدم)»                                                                                                                                                             | Paired a fresh desktop program with the trial cloud and received the store (above)                                                                                                                                                        |
| A trial stack on one machine | `node scripts/phase2-dev.js --fresh`: a shop and its cloud on 127.0.0.1 with made-up data, paired by code; the shop's own API on the next port                                                                                                                            | Used for all checks above                                                                                                                                                                                                                 |

### Not done yet in this milestone

1. **A real phone.** Everything was seen in a desktop browser made phone-sized. The first real phone test happens when the cloud runs somewhere a phone can reach (milestone 5 or earlier on the local network).
2. **Sharing a receipt** from the phone (as an image or PDF). Printing on the shop's receipt printer stays a desktop feature.
3. **Screens that do not yet reload by themselves** beyond those listed: they show the change when reopened.
4. **The layout check is a script, not part of the test suite**: it needs a browser, which the CI machines do not have. It runs by hand before each release.

## Milestones 3 to 5

Not started.
