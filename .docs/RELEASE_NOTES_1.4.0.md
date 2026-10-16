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
  - When it cannot be saved (the number belongs to another customer, or two numbers or three addresses are already saved), it is used for this order only, and the cashier is told so before and after paying.
- **Delivery invoices keep the address used**, even if the customer's addresses change later.
- **Shifts: the owner works without one.**
  - The owner (مدير النظام) signs in and uses everything without opening a shift.
  - When he sells, or moves cash from the drawer (a cash expense, paying a supplier or a customer refund in cash, a customer paying a debt in cash), the open-shift window appears. It explains why and has a "لاحقاً" button.
  - When a sale was the reason, it completes by itself once the shift is open.
  - In إعدادات المتجر → الوردية والجرد الدوري, the owner ticks **which roles must open a shift**. Those users cannot use the system until they open one; that window cannot be closed. By default every role that works shifts is ticked, as before 1.4.0.
- **Every small window:**
  - has an **X** in its corner;
  - closes with a click outside it, on the dimmed background;
  - asks **"إغلاق بدون حفظ؟"** first if something was typed in it. The window's own cancel button closes it directly, as before.
  - Windows that must be completed, such as a required shift or the recovery notice, are left as they were.
- **Windows scroll** when they are taller than the screen; the purchase invoice was cut off at the bottom on a laptop screen.

## New in the back office

- **التصنيفات** screen (stock section): create, rename, reorder, stop and delete (empty only) categories, and move products between them.
- **Product form:** choose the category, and stop a product from being sold (it disappears from the till without deleting its history).
- **Customer form:** up to three addresses (home, work, other), one of them the default.
- **Purchase invoice:** the item field is a **search list of every product**. Type part of a name or barcode to filter; scroll for more; click a product (or ↑/↓ and Enter) to add its line. A scanner still works: barcode, then Enter.
  - Products already on the invoice are marked "مضاف".
  - Creating a new product from the invoice is planned for 1.4.1 (SPEC_1.4.1_PURCHASE_NEW_ITEMS.md).

## Installation changes

- **Installed for all Windows users of the PC** (`C:\Program Files\HeroMarket-POS`). Windows asks for administrator approval once during installation.
- **Store data in `C:\ProgramData\HeroMarket`**, shared by every Windows account on the PC.
  - Data from version 1.3 is imported automatically on the first start; the old file is only read.
- **The database runs as a Windows service with its own account** (HeroMarketDB).
  - Windows users of the PC cannot open its files, read its administrator password or use it to run programs.
  - It keeps running when someone signs out of Windows.
  - Before every installation or update, the installer makes a verified copy of the database.
- **The program can no longer be misused as a general script runner**, and it refuses to start if the index of its program package was modified.
  - Changes deeper inside the program files are **not** detected when it starts. They are kept out because only an administrator can change `C:\Program Files`.
  - Code signing would add detection; it is not bought yet.
- **The Microsoft Visual C++ runtime is installed when missing.** The database needs it; without it, a clean Windows could not create the shop's database.

## Safe updates from now on

- **Updates stay manual:** you run the next version's installer.
- **It refuses** while HeroMarket is open on any Windows account.
- **It makes a verified copy of the database first.**
- **Database changes** are applied by the installer and checked. If anything fails, it puts the copy back by itself.
- **A program can never open data already updated by a newer version.**
- Every update is recorded in `logs\update-history.jsonl`. See UPDATE_GUIDE.md.

## Update case of this release

**Case B (database change).** It applies migrations 0011–0013 over a 1.3.x installation; the 1.3 data is imported from its own file, which is never changed. The 1.3 program cannot use the new database, and does not need to: its own SQLite file is left as it was. To go back to 1.3, reinstall 1.3; it still finds its own data, **without** anything recorded in 1.4.0 since the upgrade.

## Printing

- **When a receipt cannot be printed** (no printer, a wrong printer name, or a PDF printer that asks for a file name), the cashier is told why. The invoice is saved once and can be reprinted.
- Before, a missing printer was silently reported as printed.

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
