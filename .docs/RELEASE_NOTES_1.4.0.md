# HeroMarket POS 1.4.0 – Release notes

Status: **ready for your testing, not released.** Nothing has been published or installed on the shop PC.

## New for the cashier

- **Browse products by category (F6 or "تصفح").**
  - A list of categories appears on the right and that category's products beside it.
  - Click a product to add it to the invoice. The invoice, the total and the pay button stay as they are, and the scanner keeps working.
  - **Esc** goes back to the invoice and never clears it.
  - **↑ / ↓** move between categories.
- **"بدون تصنيف"** is always the last entry: every product without a category is there automatically.
- **Saved phones and addresses.** Choose a customer and their saved numbers (up to two) and addresses (up to three) appear in lists. Pick one instead of typing it again, or choose "رقم آخر…" / "عنوان آخر…" to type a new one.
  - A new number or address typed for a known customer is saved for next time, when there is room.
- **Delivery invoices keep the address used**, even if the customer's addresses change later.

## New in the back office

- **التصنيفات** screen (stock section): create, rename, reorder, stop and delete (empty only) categories, and move products between them.
- **Product form:** choose the category, and stop a product from being sold (it disappears from the till without deleting its history).
- **Customer form:** up to three addresses (home, work, other), one of them the default.

## Installation changes

- **Installed for all Windows users of the PC** (`C:\Program Files\HeroMarket-POS`). Windows asks for administrator approval once during installation.
- **Store data in `C:\ProgramData\HeroMarket`**, shared by every Windows account on the PC.
  - Data from an earlier version is moved in automatically on the first start, and every file is checked.
  - The old folder is kept.
- **The program can no longer be misused as a general script runner**, and it refuses to start if the index of its program package was modified.
  - Changes deeper inside the program files are **not** detected when it starts. They are kept out because only an administrator can change `C:\Program Files`.
  - Code signing would add detection; it is not bought yet.
- **The Microsoft Visual C++ runtime is installed when missing.** The database needs it; without it, a clean Windows could not create the shop's database.

## Fixes from the 1.4.0 audit

- A closed shift can no longer be changed by a sale or an expense arriving at the same moment.
- Returns go back to the customer's account first (amount still owed, or balance used) and only the rest is paid in cash.
- The till no longer puts a sale on another customer who only shares the same name.
- Printing no longer passes through a command shell, and printer names are checked.
- Suppliers with a balance cannot be deleted.

## Before installing at the shop

1. Take a backup (Installation guide §5).
2. Run the tests in the installation guide §9 marked **Not yet** on a separate PC with a copy of the shop's data.
3. Expect the "Windows protected your PC" message: the installer is not code-signed yet.

Details: [DECISIONS.md](DECISIONS.md) D-049 to D-052, [INSTALLATION_GUIDE.md](INSTALLATION_GUIDE.md), [TESTING_AND_KNOWN_ISSUES.md](TESTING_AND_KNOWN_ISSUES.md).
