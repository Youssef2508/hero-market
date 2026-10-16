# Trying HeroMarket 1.4.0 on your own laptop (before the shop)

Written for the shop owner. The trial changes nothing at the shop.

## What you receive

- The file **`HeroMarket-Setup-1.4.0.exe`** (about 175 MB), by USB stick or a private link.
- Its fingerprint (SHA-256): `6bc3de17c85630740f65eb6deadaaa94ec4c7007a230eac5f27d2b9201b86cb0`. This is trial build 1 of 1.4.0, commit 4fbed9f, tested on a laptop on 2026-10-16.

  To check that the file arrived intact: right-click the Start button → **Windows PowerShell**, then type:

  ```
  Get-FileHash "$env:USERPROFILE\Downloads\HeroMarket-Setup-1.4.0.exe"
  ```

  Use the file's real location if it is not in Downloads. The "Hash" shown must be the same as above (capital letters do not matter). If it differs, do not run the file.

## Install

1. Double-click the file.
2. **"Windows protected your PC"** appears, because the program is not code-signed yet. Click **More info**, then **Run anyway**.
3. Windows asks **"Do you want to allow this app to make changes to your device?"**. Click **Yes**. Your laptop account must be an administrator, or someone types an administrator password.
4. Wait two to five minutes. There are no questions. A **HeroMarket POS** icon appears on the Desktop.

## First start

- **Without old data:** the program asks you to create the first administrator (there is no default password). Then it shows a **recovery code once**: write it on paper.
- **With a copy of the shop's data (optional):** before installing, copy the shop PC's folder `%APPDATA%\elnagdi-pos` (a **copy**, never the original) to the same place on your laptop, under your own Windows user. HeroMarket 1.4.0 imports it on the first start. Then sign in with your usual username and your **old PIN**, and choose a password.

## What to try

- A sale with **F1**, a return, opening and closing a shift.
- **F6** at the till: browse the categories (on the right); **Esc** goes back to the invoice.
- A customer with two phone numbers and up to three addresses, a delivery order.
- **الإدارة → التصنيفات**: create categories, move products.
- **النسخ الاحتياطي**: save a backup, then restore it.

## Good to know

- **Printing:** without a receipt printer, each sale shows "تعذرت طباعة الفاتورة رقم …: الطابعة "CITIZEN CT-S300" غير موجودة… الفاتورة محفوظة". This is expected. The sale is saved once and can be reprinted later. If the laptop has a receipt printer, type its Windows name in **إعدادات المتجر → اسم الطابعة الافتراضية**.
- **Later versions** (for example the final 1.4.0 or 1.4.1) are installed the same way over this one. Your trial data is kept; the installer makes a checked copy of it first.
- The database runs in the background as a Windows service (**HeroMarketDB**). It uses little memory and starts with Windows.
- **To remove the trial:** Settings → Apps → HeroMarket POS → Uninstall. Your trial data stays in `C:\ProgramData\HeroMarket`; delete that folder too if you want nothing left.
- Do not install this on the shop computer yet. That comes after your trial and your approval, with the steps in the installation guide.
