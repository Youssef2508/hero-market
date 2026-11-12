# HeroMarket POS 1.6.0 – Release notes

Written for the shop owner. 1.6.0 connects the shop to its own website, so you can follow and run the store from your phone. Everything in [RELEASE_NOTES_1.5.2.md](RELEASE_NOTES_1.5.2.md) and the earlier notes still applies.

**Install it over what the shop PC has now (1.4.0, 1.5.0, 1.5.1 or 1.5.2).** Follow Part 2 of [ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md):

- The database is updated once, after a verified copy. Nothing has to be imported again.
- Connecting to the website is a separate step, done once with a code from Youssef. Until then, HeroMarket works exactly as before.

## Your store from your phone

- **The same store at `https://heromarket.duckdns.org`:** the same screens, users, permissions, shifts, accounts and figures as at the shop. Sign in with your usual username and password. You can add it to the phone's home screen.
- **While the shop PC is connected**, what you do on the phone is carried out on the shop PC itself, usually within a second. You see the shop's figures as they are.
- **While the shop PC is off or offline**, the phone keeps working on its own copy, and a strip at the top says so. When the PC is back, both sides' work comes together by itself.
  - Invoices made on the phone in that time are numbered **W-1, W-2, …**.
  - Anything that needs a person (the same thing changed on both sides) is listed under «تحتاج انتباهك».
- **Everything the shop would print, on the phone's screen:** sale receipts and invoices, shift and closing reports, purchase invoices and the shortages list. Each is shown as the paper would look, to print or save as PDF with the phone's print dialog, or to share (for example on WhatsApp).
  - Everything is saved either way, so the shop PC can print it on the receipt printer at any time («إعادة طباعة فاتورة», «الورديات», «الموردون والمشتريات»).
- **The screens refresh by themselves** on the phone when something changes at the shop.
- Your guide: [OWNER_CLOUD_GUIDE.md](OWNER_CLOUD_GUIDE.md).

## On the shop PC

- **«المزامنة السحابية»** has a new pairing card: the website's address and a one-time code. It shows:
  - who keeps the connection;
  - when changes last went through;
  - the version on both sides, and «تحديث مطلوب» if they differ.
- **A background service keeps the connection with the program closed.** It starts with Windows, before anyone signs in, and restarts itself if it stops. You do not open anything for it.
- **«تحتاج انتباهك»**, a new screen for administrators, lists what needs a decision after the two sides worked apart. Nothing is changed automatically.

## Security

- **Signing in from the internet:**
  - Wrong passwords pause that sign-in for the address they came from.
  - Ten wrong passwords for one name, from anywhere, pause that name's internet sign-in for 15 minutes.
  - The shop PC is never affected.
- **Passwords are stored more strongly.** Each user's is upgraded automatically at their next sign-in at the shop.
- **Changing your password at the shop signs you out of the website everywhere** (a lost phone). Removing a user's «الدخول عبر الإنترنت» at the shop stops their phone at once.
- **The website's backups are encrypted to your own key**, which only you hold. A full review: [SECURITY_REVIEW_PHASE2.md](SECURITY_REVIEW_PHASE2.md).

## New permissions

| Permission                 | Who has it after the update |
| -------------------------- | --------------------------- |
| الدخول عبر الإنترنت (new)  | administrators              |
| عناصر تحتاج الانتباه (new) | administrators              |

What a person may do on the phone is exactly what they may do at the shop; the first permission only opens the door. Nothing you set before is changed.

## The installer

The file, its size and its SHA-256 are added here once it is built from `main`.

## How this release was verified

- **The full test suite** passes (530 tests), with lint, the format check and the CI pipeline.
- **Stores made by the released 1.4.0 and 1.5.2 programs** were updated in place and paired. Every record and number was kept. The website then held the same records, and nothing was doubled.
- **On a clean Windows (Windows Sandbox),** the installer updated over a running background service. The pairing and every change waiting to be sent were identical afterwards.
- **On the real website,** a rehearsal with the 1.5.2 store: updated, paired, first send in 6 seconds, the same invoice, product and shift lists, both directions. All 31 screens pass at two phone sizes.
