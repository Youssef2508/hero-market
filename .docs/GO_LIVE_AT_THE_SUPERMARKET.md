# HeroMarket 1.4.0 at the supermarket: step by step

> **Not for the supermarket as written (2026-10-16).** This guide assumes the shop PC runs HeroMarket 1.3. The owner has since said the shop uses another company's POS program. Go-live there is a fresh install plus an import of that program's data. The first step is **[SUPERMARKET_VISIT_1.md](SUPERMARKET_VISIT_1.md)**, which only collects information. The installation guide for the shop will be rewritten once its data and hardware are known. This version still applies to any PC that runs HeroMarket 1.3.

Written for you, the person who installs it at the shop. Print it, or open START-HERE.html from the USB folder, and tick each box. The whole visit takes about two hours plus a normal day of selling.

The supermarket PC today runs **HeroMarket 1.3**. Installing 1.4.0 is the real change-over: it brings the 1.3 data into the new database. The installer **removes the 1.3 program**, but not its data. The 1.3 data is only read, never changed, so you can always go back to 1.3 with its installer (step 1).

---

## A. At home, before you go

- [ ] **1. Copy one folder to a USB stick:** `D:\Youssef\Brands\HeroMarket-USB\HeroMarket-1.4.0-for-the-supermarket` (about 280 MB). Copy the whole folder, not single files. It contains:
  - **`START-HERE.html`**: this guide. Double-click it to open it in the browser.
  - **`HeroMarket-Setup-1.4.0.exe`**: the new program.
  - **`1-Check-installers-and-backup-1.3.cmd`**: checks the installers and backs up the 1.3 data (step 8).
  - **`go-back-to-1.3\elnagdi-pos-1.3.0-setup.exe`**: the old program, only to go back if needed.
  - `SHA256SUMS.txt`, `tools\` and `GO_LIVE_AT_THE_SUPERMARKET.md`: used by the check, or the same guide as text.
- [ ] **2. Use a USB stick with at least 2 GB free.** The backup of the 1.3 data goes on it, next to the folder.
- [ ] **3. Bring:**
  - the receipt printer's cable, if it is not connected;
  - a few paper rolls;
  - 10 products of different kinds, including one with a long barcode and, if the shop sells weighed items, one with a scale label.
- [ ] **4. Ask the owner** to be there at a quiet time (no customers). He should know each staff member's **username and old PIN**, or have each person come and type their own.

## B. At the shop: before installing (15 minutes)

- [ ] **5. Write down from 1.3, while it is still open** (a photo with the phone is fine). You will compare these after the installation:
  - the number of products;
  - the last invoice number;
  - three customers' balances;
  - the stock of three products you know.
- [ ] **6. Close the shift** in 1.3 if one is open, then **close HeroMarket 1.3**.
- [ ] **7. Stay signed in to Windows as the user who uses HeroMarket 1.3 every day.** The 1.3 data belongs to that Windows user; with another user it is not found.
- [ ] **8. Plug in the USB stick, open the folder and double-click `1-Check-installers-and-backup-1.3.cmd`.** A black window opens, and it changes nothing on the PC. It:
  - checks that both installers are the right, undamaged files;
  - checks that 1.3 is closed;
  - copies the 1.3 data to the USB stick (`backup-1.3-<date and time>`) and checks that every copied file is identical to the original.

  Wait for the green **ALL OK** (a minute or two), then press any key. If it shows a red **STOP**, do what it says and run it again. **Do not install before you see ALL OK.**

- [ ] **9. Only if the check cannot run:** do the same by hand.
  1. Press **Windows + R**, type `%APPDATA%`, press Enter, and copy the whole **`elnagdi-pos`** folder to the USB stick.
  2. In PowerShell, run `Get-FileHash E:\HeroMarket-1.4.0-for-the-supermarket\HeroMarket-Setup-1.4.0.exe`, with your USB stick's letter instead of `E:`. It must show `097E0C285B9A1FB69A90A1D0FD3F56A73C5031284A9D2F8332EED2F4D4BE63BB`.

## C. Install (5–10 minutes)

- [ ] **10.** Copy **`HeroMarket-Setup-1.4.0.exe`** from the USB folder to the Desktop and double-click it.
- [ ] **11.** If Windows says **"Windows protected your PC"**, click **More info** and then **Run anyway**. The installer is not signed, so this warning is expected.
- [ ] **12.** Click **Yes** at the administrator question. If Windows asks for an administrator's password instead, the shop's Windows user is not an administrator: type the password of an administrator account of that PC. Then wait; there is no window for a few minutes. Do not turn the PC off.
- [ ] **13.** When it finishes, HeroMarket opens. With the shop's full data, the first start may take a minute or two while the 1.3 data is brought in.
  - **"HeroMarket مفتوح الآن…":** HeroMarket 1.3 is still open somewhere. Close it on every Windows account and run the installer again. Nothing was changed.
  - **"لم يكتمل تثبيت HeroMarket…":** stop and send me the photo and the file `C:\ProgramData\HeroMarket\logs\setup.log`. To keep selling meanwhile, go back to 1.3 (last row of the table below): its data is untouched.

## D. First start and sign-in (10 minutes)

- [ ] **14.** Sign in with the **owner's username and his old PIN**. The program asks him to choose a new **password**. It must have at least 8 characters with letters and digits; he chooses it, you do not write it here.
- [ ] **15.** The **recovery code** appears once. Write it on paper and give it to the owner, to keep at home, not at the till. With it he can get in if he forgets his password.
- [ ] **16. Compare with step 5:**
  - **الأصناف والمخزن:** number of products, stock of the three products;
  - **الفواتير والمرتجعات:** last invoice number;
  - **العملاء والحسابات:** the three balances.
    All must be the same. If not, stop and send me a photo.
- [ ] **17.** Each staff member signs in once with their **username and old PIN**, and chooses their own password.

## E. Settings (10 minutes)

- [ ] **18. Shifts:** إعدادات المتجر → **الوردية والجرد الدوري** → "من يجب عليه فتح وردية قبل استخدام النظام؟".
  - All roles are ticked: everyone except the owner must open a shift first, as in 1.3.
  - The owner unticks a role only if those people should work without a shift. They are then asked to open one when they sell or take cash from the drawer.
  - The owner never needs a shift; he is asked only when he sells or takes cash from the drawer. Press **حفظ التغييرات**.
- [ ] **19. Printer name:**
  1. In Windows, open **Settings → Bluetooth & devices → Printers & scanners** (Windows 10: **Devices → Printers & scanners**) and note the receipt printer's exact name, e.g. `CITIZEN CT-S300`.
  2. In HeroMarket, إعدادات المتجر → **الطباعة** → type that name exactly, choose the paper (80 mm or 58 mm), and press **حفظ التغييرات**.
- [ ] **20. Store data:** in the same screen, check the store name, address and phone that print on the receipt.

## F. Printer and scanner (30 minutes)

- [ ] **21. Open a shift** (the button "فتح وردية" at the top) with the usual opening cash.
- [ ] **22. Scanner:** on the till screen, click the barcode field and scan the 10 products one by one. Each must appear in the invoice with the right name and price.
  - Scan the long barcode too.
  - If the shop has a scale with labels, scan a weighed item's label: the weight or price must be right.
  - Note any product that does not appear or has a wrong price.
- [ ] **23. Receipt printer:**
  - Make a cash sale with F1: the receipt prints, with the store name, items and total correct.
  - **Reprint:** الفواتير والمرتجعات → choose that invoice → إعادة طباعة.
  - If it says the printer is not found, the name in step 19 is not exact. The sale is saved anyway, and F1 again does not record it twice. Fix the name and reprint.
- [ ] **24. Each kind of payment once:** cash, Vodafone Cash / InstaPay if used, credit (آجل) for a known customer, and partial payment.
- [ ] **25. A return** of one item from a sale (it may ask a supervisor's username and password).
- [ ] **26. An expense** (المصروفات → تسجيل مصروف), small amount.
- [ ] **27. A purchase invoice** (الموردون والمشتريات → choose the supplier → فاتورة شراء): search a product in the item list, add it with a quantity and cost, and save. Its stock goes up.
- [ ] **28. Close the shift:** count the drawer and enter it. The expected amount must match. The shift report prints.

## G. Restart and backup (15 minutes)

- [ ] **29. Restart Windows** (Start → Power → Restart). Sign in, open HeroMarket: it opens and today's sales are there.
- [ ] **30. Backup:** الإدارة → **النسخ الاحتياطي** → **حفظ نسخة**, save it on the USB stick. From now on, do this **every day** on a USB stick.
- [ ] **31. Update record:** open `C:\ProgramData\HeroMarket\logs\update-history.jsonl` with Notepad. The last line contains `"toVersion":"1.4.0"` and `"result":"ok"`.

## H. A normal day

- [ ] **32.** Let the staff work a full day. At closing, the shift must match. Note any message or problem with a photo and the time.

---

## If something goes wrong

| What you see                             | What to do                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The installer stops with a message       | Photo of the message + `C:\ProgramData\HeroMarket\logs\setup.log` to me. To keep selling, go back to 1.3 (last row): its data is untouched.                                                                                                                                           |
| Numbers differ from step 5               | Do not sell with 1.4.0. Photo of both + `C:\ProgramData\HeroMarket\logs\app.log` to me. To keep selling, go back to 1.3 (last row).                                                                                                                                                   |
| A product does not scan, or prints wrong | Write down which product and what happened. It is usually a setting; send it to me, the shop can keep selling.                                                                                                                                                                        |
| The printer does not print               | Check the name (step 19), the cable and paper. The sale is saved. Send me a photo of the message.                                                                                                                                                                                     |
| You must go back to 1.3 today            | Close HeroMarket 1.4.0. As the same Windows user, run `go-back-to-1.3\elnagdi-pos-1.3.0-setup.exe` from the USB folder: 1.3 opens with its data exactly as you left it at step 6. Sales made in 1.4.0 that day are not in 1.3, so write them down. Tell me before trying 1.4.0 again. |

**Files to send me when something fails:** everything in `C:\ProgramData\HeroMarket\logs`, plus photos. Never delete any folder in `C:\ProgramData\HeroMarket` or `%APPDATA%\elnagdi-pos`.

When everything above is ticked, tell me. I will then tag version 1.4.0 and prepare the release for your approval.
