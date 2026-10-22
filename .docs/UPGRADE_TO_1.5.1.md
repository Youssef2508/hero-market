# Upgrading the shop from HeroMarket 1.4.0 to 1.5.1

Written for the shop owner, who installs the update himself on the shop PC. Print it and tick each box. It takes about 30 minutes, best after closing time.

1.5.1 is 1.5.0 with one correction: cashiers and supervisors see and act only on their own invoices of their open shift ([RELEASE_NOTES_1.5.1.md](RELEASE_NOTES_1.5.1.md)). Install 1.5.1, not 1.5.0. **If 1.5.0 is already installed, see the last section.**

**What happens:** the 1.5.1 installer updates the program **and the data already in HeroMarket 1.4.0** on this PC: products, stock, customers, suppliers, balances, users, sales and shifts. The data you prepared from the old program and imported into 1.4.0 is already in that database, so **nothing has to be imported again**.

## What you need

- [ ] **`HeroMarket-Setup-1.5.1.exe`** and the file **`SHA256SUMS.txt`** next to it, on a USB stick.
- [ ] **The 1.4.0 installer** you installed the shop with (`HeroMarket-Setup-1.4.0.exe`). Keep it: it is the way back.
- [ ] A second USB stick (or a folder on another PC) for the backup.
- [ ] The owner's username and password in HeroMarket.

## A. Before the update (HeroMarket 1.4.0 still installed)

- [ ] **1. Finish the day:** no customer at the till; close the open shift as usual.
- [ ] **2. Write down a few figures** to compare after the update:
  - on «لوحة الإدارة»: «الأصناف المسجلة» and «ديون العملاء المستحقة»;
  - the number of the last invoice in «الفواتير والمرتجعات»;
  - the balance of two or three suppliers in «الموردون والمشتريات».
- [ ] **3. Back up the 1.4.0 data:** «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن». Save the file on the USB stick. The message shows where it was saved (`heromarket-backup-….json`).
- [ ] **4. Check the backup:** open the USB stick in Windows Explorer. The file is there and its size is more than 0 KB. Copy it to a second place (another USB stick or another PC).
  - This file can be restored **only by HeroMarket 1.4.0**. HeroMarket 1.5.1 refuses a backup made by another version. It is your way back to 1.4.0, not something to load into 1.5.0.
- [ ] **5. Keep, and do not delete until 1.5.1 has worked well for at least a week, with nightly backups:** this backup, the 1.4.0 installer, the export from the old program and the HeroMarket Excel template you filled.
- [ ] **6. Close HeroMarket** on every Windows account of the PC (the installer refuses to run while it is open anywhere).

## B. Check the installer

- [ ] **7.** Copy `HeroMarket-Setup-1.5.1.exe` to the Desktop.
- [ ] **8.** Open PowerShell (Start → type `PowerShell` → Enter) and run:

  ```
  Get-FileHash "$env:USERPROFILE\Desktop\HeroMarket-Setup-1.5.1.exe"
  ```

  The `Hash` must be exactly:

  ```
  <<SHA151>>
  ```

  (the same as in `SHA256SUMS.txt` and the release notes). If it differs, **stop**: do not install that file.

## C. Install

- [ ] **9.** Double-click `HeroMarket-Setup-1.5.1.exe`.
  - "Windows protected your PC": click **More info** → **Run anyway** (the installer is not code-signed).
  - "Do you want to allow this app to make changes": **Yes**.
- [ ] **10.** Wait until it finishes (a few minutes). **Do not switch the PC off.** It:
  1. makes a verified copy of the whole 1.4.0 database (`C:\ProgramData\HeroMarket\backups\pre-install`);
  2. updates the database to 1.5.1 and checks that no record and no total changed;
  3. registers the automatic backups (every night at 00:00, and after each shift close).
- [ ] **11. If the installer says the update failed:** your data has already been put back as it was. Run the **1.4.0 installer** again; HeroMarket 1.4.0 opens with all its data. Send the developer `C:\ProgramData\HeroMarket\logs\setup.log` and `update-history.jsonl`. Do not delete anything in `C:\ProgramData\HeroMarket`.

## D. After the update

- [ ] **12.** Open HeroMarket and sign in as the owner, with the same username and password as before.
- [ ] **13. Compare** with the figures from step 2: «الأصناف المسجلة», «ديون العملاء المستحقة», the last invoice number, the suppliers' balances. They must be the same.
  - If anything differs: **do not sell.** Send the developer a photo and `C:\ProgramData\HeroMarket\logs\app.log`. Going back is in section F.
- [ ] **14. Do not import the template again.** The data is already there. If you try, the import is refused as a whole ("مسجل بالفعل") and nothing is written.
- [ ] **15. The treasury starts at 0:** open «الخزنة» and record the money held outside the drawers once («إيداع»), per payment method.
- [ ] **16. First sale with the new receipt:** open a shift, scan a product, scan a scale label, sell with **F1** (confirm and print). Check the printed receipt: Arabic from right to left, the item name on the right and the amounts on the left, numbers and dates readable. Reprint it from «الفواتير والمرتجعات»: the copy says «*** نسخة معاد طباعتها ***».
- [ ] **17.** Close the shift: you enter the counted amounts first, and only then see expected, counted and the difference.

## E. Check the automatic backups (the first day)

- [ ] **18. After the first shift close:** open `C:\ProgramData\HeroMarket\backups\scheduled` in Windows Explorer. Within a minute there is a new file `HeroMarket-close-<date>_<time>.json.gz` and its `.sha256` file next to it.
- [ ] **19. The next morning:** in the same folder there is `HeroMarket-daily-<date>_0000.json.gz` (and in a new week also `HeroMarket-weekly-…`), each with its `.sha256` file.
  - If the PC was off at midnight, the copy is made as soon as it starts, and its name has that time instead of `0000`. Never more than one daily copy per day.
- [ ] **20.** In HeroMarket, «النسخ الاحتياطي» → «النسخ الاحتياطي التلقائي كل ليلة» shows «آخر نسخة ناجحة» with last night's time.
- [ ] **21. If a copy is missing or the screen shows a failed attempt:** send the developer `C:\ProgramData\HeroMarket\logs\backup.log`. Meanwhile, make a copy by hand from «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن» every evening.
- [ ] **22. Once a week:** copy the newest file from `backups\scheduled` to a USB stick kept away from the PC. The copies on the PC do not help if the PC itself is lost or its disk fails.

## F. If you must go back to 1.4.0

This loses every sale and change made in 1.5.1 since the update. First make a backup in 1.5.1 and write down the sales made since then. Then:

1. Close HeroMarket on every Windows account.
2. Start → type `cmd` → right-click **Command Prompt** → **Run as administrator**, and run:

   ```
   "C:\Program Files\HeroMarket-POS\HeroMarket-POS.exe" --restore-pre-install=1.4.0
   ```

   It puts back the verified copy taken just before the update. HeroMarket 1.5.1 then refuses to open: that is expected.

3. Run the **1.4.0 installer**. HeroMarket 1.4.0 opens with the data as it was before the update.

**Do it in this order.** Running the 1.4.0 installer first can delete that copy. Details: [UPDATE_GUIDE.md §6](UPDATE_GUIDE.md).

## Only if 1.5.1 goes on a PC that never had HeroMarket

This is **not** the shop's case. On a new, empty PC, install 1.5.1, create the owner account on the first screen, then «استيراد وتصدير البيانات» → import the HeroMarket Excel template you filled for 1.4.0. 1.5.1 reads that file. It brings products with their stock, customers and suppliers with the balances **in the file**: the opening state, without the sales made in 1.4.0 since. To move a running shop to a new PC, update the old PC to 1.5.1 first, make a backup in 1.5.1, and restore it on the new PC's 1.5.1.

## If 1.5.0 is already installed

Then 1.5.1 changes only the program; the database stays as it is ("Case A").

1. Close the shift and HeroMarket on every Windows account.
2. In 1.5.0, «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن» → save on a USB stick.
3. Check the installer (section B) and run it (section C).
4. Sign in. The invoices and figures are as before.
5. In «الأدوار والصلاحيات», check the new permission «كل الفواتير»: the administrators have it, «مشرف» and «كاشير» do not.
