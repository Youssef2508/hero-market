# Trying HeroMarket 1.4.0 on your own laptop (before the shop)

Written for the shop owner. The trial changes nothing at the shop.

## What you receive

- The file **`HeroMarket-Setup-1.4.0.exe`** (about 175 MB), by USB stick or a private link.
- Its fingerprint (SHA-256): `d31e37f1a40e5700924533d7f0070b89f671e6721ec8d586992030f14a8168f2`.

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

- Printing fails if the laptop has no receipt printer; the sale is still saved.
- The database runs in the background as a Windows service (**HeroMarketDB**). It uses little memory and starts with Windows.
- **To remove the trial:** Settings → Apps → HeroMarket POS → Uninstall. Your trial data stays in `C:\ProgramData\HeroMarket`; delete that folder too if you want nothing left.
- Do not install this on the shop computer yet. That comes after your trial and your approval, with the steps in the installation guide.
