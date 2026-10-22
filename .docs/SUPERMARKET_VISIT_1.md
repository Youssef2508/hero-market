# HeroMarket at the supermarket, visit 1: collect what we need (install nothing)

> **History (2026-10-22).** The shop visit is done: the shop runs HeroMarket 1.4.0 with its data, and the scanner, printer and workflows were tested there. There is no further visit. The owner upgrades to 1.5.0 himself: [UPGRADE_TO_1.5.0.md](UPGRADE_TO_1.5.0.md). This checklist is kept as the record of that visit.

Written for you, the person visiting the shop. Print it, or open `START-HERE.html` from the USB folder, and tick each box. It takes about 30 minutes.

**Why a first visit:** the supermarket runs another company's POS program, not an older HeroMarket. Before installing anything we need to know:

- which program it is (for reference only: its data is not imported by a special tool);
- what printer and scanner it uses;
- what Windows the PC has.

The shop's products, customers and balances come in through HeroMarket's own Excel template (owner, 2026-10-22: no importer for the other program). Printing and scanning can be set up and tried in advance, and the installation day becomes a short, checked visit.

**On this visit you install nothing and change nothing on the shop PC.** The shop keeps selling with its current program.

---

## A. At home, before you go

- [ ] **1. Copy this folder to a USB stick:** `D:\Youssef\Brands\HeroMarket-USB\HeroMarket-visit-1-collect-info`. Use a stick with 2 GB free.
- [ ] **2. Ask the owner for permission** to look at the PC. Do not copy the other program's data or database: it is not needed.
- [ ] **3. Charge your phone:** you will take photos.

## B. At the shop (about 30 minutes)

- [ ] **4. Run the information script.** Plug in the USB stick, open the folder and double-click **`1-Collect-PC-info.cmd`**. A black window opens and works for 1–3 minutes. Wait for the green **DONE**, then press any key.
  - It writes a folder `shop-info-<date>` on the USB stick with: Windows version and 64-bit, memory and disk, the Windows users, the printers and their drivers, the USB devices (the scanner shows as a keyboard), the installed programs, any database services, and the files that look like the POS database (names and sizes only).
  - It installs nothing, changes nothing and copies none of the shop's data.
- [ ] **5. The current POS program.** Open it and take photos of:
  - its **About / حول البرنامج** window (name, company, version); usually in the Help or Settings menu;
  - the main sales screen;
  - the product list screen, with a few products visible;
  - the customers screen, if it has one.
- [ ] **6. The shop's data.** The data goes in the **HeroMarket data template** (`HeroMarket-data-template.xlsx` in this folder; the same file comes from HeroMarket → الإدارة → استيراد وتصدير البيانات → تنزيل القالب). The owner fills its sheets الأصناف, العملاء, الموردون, and sends it back. HeroMarket imports it after checking every row.
      The template is the only route for the data (owner, 2026-10-22). Fill it from the other program's screens or an export the owner already has; no special importer is built, and no export file is needed from that program.
- [ ] **7. Receipt printer:** take photos of:
  - the label under or behind the printer (model);
  - a receipt printed by the current program, front and full length;
  - the paper roll width, with a ruler if possible (80 mm or 58 mm).
- [ ] **8. Barcode scanner:**
  1. Photo of its label (model).
  2. Open **Notepad** (Windows key, type `notepad`, Enter) and scan 5 different products. Each code should appear on its own line; if they all run into one line, the scanner sends no Enter. Save the file to the USB stick as `scans.txt`.
  3. If the shop weighs products with a **scale that prints labels**, scan 2–3 of those labels too and take a photo of each label next to its product.
- [ ] **9. Ask the owner:**
  - how many PCs sell (one till, or more);
  - which Windows user is used for selling, and whether it has a password;
  - the staff who will use HeroMarket and their roles (cashier, manager…);
  - whether he weighs products, sells by carton or box, and gives credit (آجل) to customers.
    Write the answers down or record a voice note.

## C. Back home

- [ ] **10. Send me:** the `shop-info-<date>` folder, `scans.txt`, the exports or backup, the photos and the answers.

Then I will:

1. **Import the shop's data** into HeroMarket in a test copy, and check the counts and totals.
2. **Set up the printer** (paper, layout, Arabic text). You get PDF previews of real receipts at the shop's paper width.
3. **Check the scanner's codes** and scale labels against the real products.
4. **Prepare the installation day:** one USB folder with the installer, the shop's data ready to import, and a short checked guide.

---

## If something comes up

| What happens                                    | What to do                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Windows says it protects the PC from the script | Click **More info** → **Run anyway**. It only reads information.                      |
| The script shows red text                       | Take a photo and continue; whatever it collected is in the folder.                    |
| The owner does not want to give data now        | Do steps 4, 5, 7, 8 and 9 only. HeroMarket can be set up, and products entered later. |
| The POS program asks for a password to export   | Ask the owner to do it himself. Never write his passwords down.                       |
