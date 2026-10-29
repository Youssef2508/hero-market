# Upgrading the shop to HeroMarket 1.5.2

Written for the shop owner, who installs the update himself on the shop PC. Print it and tick each box. It takes about 30 minutes, best after closing time.

1.5.2 brings the owner's requested changes ([RELEASE_NOTES_1.5.2.md](RELEASE_NOTES_1.5.2.md)). The same steps apply whether the shop PC has **1.4.0, 1.5.0 or 1.5.1**: each is updated to 1.5.2 with its data, after a verified copy. Below, "the installed version" means the one the PC has now.

**What happens:** the 1.5.2 installer updates the program **and the data already in HeroMarket** on this PC: products, stock, customers, suppliers, balances, users, sales and shifts. The data you imported into 1.4.0, and everything recorded since, is already in that database, so **nothing has to be imported again**.

## What you need

- [ ] **`HeroMarket-Setup-1.5.2.exe`** and the file **`SHA256SUMS.txt`** next to it, on a USB stick.
- [ ] **The installer of the installed version** (`HeroMarket-Setup-1.4.0.exe`, `-1.5.0.exe` or `-1.5.1.exe`). Keep it: it is the way back.
- [ ] A second USB stick (or a folder on another PC) for the backup.
- [ ] The owner's username and password in HeroMarket.

## A. Before the update (the installed version still running)

- [ ] **1. Finish the day:** no customer at the till; close the open shift as usual.
- [ ] **2. Write down a few figures** to compare after the update:
  - on «لوحة الإدارة»: «الأصناف المسجلة» and «ديون العملاء المستحقة»;
  - the number of the last invoice in «الفواتير والمرتجعات»;
  - the purchase price of two products bought recently, and the date and price of their last purchase invoice;
  - the balance of two or three suppliers in «الموردون والمشتريات».
- [ ] **3. Back up the data:** «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن». Save the file on the USB stick. The message shows where it was saved (`heromarket-backup-….json`).
- [ ] **4. Check the backup:** open the USB stick in Windows Explorer. The file is there and its size is more than 0 KB. Copy it to a second place (another USB stick or another PC).
  - This file can be restored **only by the installed version**. HeroMarket 1.5.2 refuses a backup made by another version. It is your way back, not something to load into 1.5.2.
- [ ] **5. Keep, and do not delete until 1.5.2 has worked well for at least a week, with nightly backups:** this backup, the installer of the installed version, the export from the old program and the HeroMarket Excel template you filled.
- [ ] **6. Close HeroMarket** on every Windows account of the PC (the installer refuses to run while it is open anywhere).

## B. Check the installer

- [ ] **7.** Copy `HeroMarket-Setup-1.5.2.exe` to the Desktop.
- [ ] **8.** Open PowerShell (Start → type `PowerShell` → Enter) and run:

  ```
  Get-FileHash "$env:USERPROFILE\Desktop\HeroMarket-Setup-1.5.2.exe"
  ```

  The `Hash` must be exactly:

  ```
  275B9CC8B8D8F1B57FADB8B380840ADBBFE823F716FA3CC503CE8D0217B701FF
  ```

  (the same as in `SHA256SUMS.txt` and the release notes). If it differs, **stop**: do not install that file.

## C. Install

- [ ] **9.** Double-click `HeroMarket-Setup-1.5.2.exe`.
  - "Windows protected your PC": click **More info** → **Run anyway** (the installer is not code-signed).
  - "Do you want to allow this app to make changes": **Yes**.
- [ ] **10.** Wait until it finishes (a few minutes). **Do not switch the PC off.** It:
  1. makes a verified copy of the whole database (`C:\ProgramData\HeroMarket\backups\pre-install`);
  2. updates the database to 1.5.2 and checks that no record and no total changed;
  3. registers the automatic backups (every night at 00:00, and after each shift close).
- [ ] **11. If the installer says the update failed:** your data has already been put back as it was. Run the **installer of the installed version** again; it opens with all its data. Send the developer `C:\ProgramData\HeroMarket\logs\setup.log` and `update-history.jsonl`. Do not delete anything in `C:\ProgramData\HeroMarket`.

## D. After the update

- [ ] **12.** Open HeroMarket and sign in as the owner, with the same username and password as before.
- [ ] **13. Compare** with the figures from step 2: «الأصناف المسجلة», «ديون العملاء المستحقة», the last invoice number, the suppliers' balances. They must be the same.
  - If anything differs: **do not sell.** Send the developer a photo and `C:\ProgramData\HeroMarket\logs\app.log`. Going back is in section F.
  - **The purchase prices may differ on purpose:** each product now has the price of its **latest** purchase invoice, not the average (step 2's products). That is the new rule, not an error. The sales, the profit of past days and the balances do not change.
- [ ] **14. Do not import the template again.** The data is already there. If you try, the import is refused as a whole ("مسجل بالفعل") and nothing is written.
- [ ] **15. Only if the shop came from 1.4.0: the treasury starts at 0.** Open «الخزنة» and record the money held outside the drawers once («إيداع»), per payment method. (From 1.5.0 or 1.5.1 the treasury is kept as it is.)
- [ ] **16. First sale:** open a shift. **Scan** a product and a **scale label** with the shop's scanner: each goes into the invoice and no list opens. Type a few letters of a product's name in the same field: the list opens and narrows with each letter. Sell with **F1** (confirm and print). Check the printed receipt: Arabic from right to left, the item name on the right and the amounts on the left, numbers and dates readable. Reprint it from «إعادة طباعة فاتورة»: the copy says «*** نسخة معاد طباعتها ***».
- [ ] **17.** Close the shift: you enter the counted amounts first, and only then see expected, counted and the difference. The closing report lists each customer collection and supplier payment on its own line.
- [ ] **17a. Permissions and menu:** in «الأدوار والصلاحيات», check the permissions in the release notes' table. Give «طلب سداد دين مورد من الدرج» only to the cashiers who may pay suppliers. Sign in as a cashier: the menu shows «فواتير الموردين المبدئية» (and «سداد ديون الموردين» if you gave it), and no «الأدراج والتحويلات».
- [ ] **17c. Prices:** open a product with a carton in «الوحدات والعبوات». The carton's selling price is either typed (its price stays) or «تلقائي» (piece price × count). There is no wholesale price anywhere. Record a small purchase invoice in cartons and check: the carton's purchase price is what you typed, the piece's is carton ÷ count, and the selling prices did not change.
- [ ] **17d. The closing receipt** lists each expense, return, credit sale and supplier invoice of the shift. Check one against the invoice it names.
- [ ] **17b. Scale settings:** in «إعدادات المتجر», the scale label positions show 13 / 1 / 6 / 7 / 5 and divisors 1000 / 100, unless you had changed them (then yours are kept).

## E. Check the automatic backups (the first day)

- [ ] **18. After the first shift close:** open `C:\ProgramData\HeroMarket\backups\scheduled` in Windows Explorer. Within a minute there is a new file `HeroMarket-close-<date>_<time>.json.gz` and its `.sha256` file next to it.
- [ ] **19. The next morning:** in the same folder there is `HeroMarket-daily-<date>_0000.json.gz` (and in a new week also `HeroMarket-weekly-…`), each with its `.sha256` file.
  - If the PC was off at midnight, the copy is made as soon as it starts, and its name has that time instead of `0000`. Never more than one daily copy per day.
- [ ] **20.** In HeroMarket, «النسخ الاحتياطي» → «النسخ الاحتياطي التلقائي كل ليلة» shows «آخر نسخة ناجحة» with last night's time.
- [ ] **21. If a copy is missing or the screen shows a failed attempt:** send the developer `C:\ProgramData\HeroMarket\logs\backup.log`. Meanwhile, make a copy by hand from «النسخ الاحتياطي» → «إنشاء نسخة احتياطية الآن» every evening.
- [ ] **22. Once a week:** copy the newest file from `backups\scheduled` to a USB stick kept away from the PC. The copies on the PC do not help if the PC itself is lost or its disk fails.

## F. If you must go back to the installed version

This loses every sale and change made in 1.5.2 since the update. First make a backup in 1.5.2 and write down the sales made since then. Then:

1. Close HeroMarket on every Windows account.
2. Start → type `cmd` → right-click **Command Prompt** → **Run as administrator**, and run:

   ```
   "C:\Program Files\HeroMarket-POS\HeroMarket-POS.exe" --restore-pre-install=<installed version, e.g. 1.4.0 or 1.5.1>
   ```

   It puts back the verified copy taken just before the update. HeroMarket 1.5.2 then refuses to open: that is expected.

3. Run the **installer of the installed version**. It opens with the data as it was before the update.

**Do it in this order.** Running the older installer first can delete that copy. Details: [UPDATE_GUIDE.md §6](UPDATE_GUIDE.md).

## Only if 1.5.2 goes on a PC that never had HeroMarket

This is **not** the shop's case. On a new, empty PC, install 1.5.2, create the owner account on the first screen, then «استيراد وتصدير» → import the HeroMarket Excel template. To move a running shop to a new PC, update the old PC to 1.5.2 first, make a backup in 1.5.2, and restore it on the new PC's 1.5.2.
