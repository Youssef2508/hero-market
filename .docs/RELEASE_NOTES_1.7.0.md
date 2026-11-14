# HeroMarket POS 1.7.0 – Release notes

Written for the shop owner. 1.7.0 makes large Excel imports reliable, keeps you signed in on the website when the page reloads, and sends sales made offline as soon as the internet is back. Everything in [RELEASE_NOTES_1.6.2.md](RELEASE_NOTES_1.6.2.md) still applies. The full technical report: [IMPORT_SESSION_SYNC_REPORT.md](IMPORT_SESSION_SYNC_REPORT.md).

**Updating:** the website is updated first, by Youssef; then you install 1.7.0 on the shop PC, over 1.4.0 or any later version, as for every update ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md)). The database is updated once, after a verified copy. Nothing has to be imported again.

**Linking to the website again:** the website was emptied before this update, so the shop PC links to it once more. After installing: «المزامنة السحابية» → «إلغاء الربط», then enter the website's address and the new one-time code from Youssef. The first link sends your whole store to the website; with a few thousand products this takes a few minutes. Keep the program open until the sync screen shows nothing waiting.

## What changes

- **Large Excel files import.** Before, a file with more than about a thousand products could stay on «جاري القراءة» forever. Now 5,000 products take under 10 seconds, and 20,000 under a minute.
- **An import shows its progress** (rows done, time left) and you can keep working or close the window: it goes on in the background. Closing the program, a power cut or a restart in the middle saves nothing half way; the import finishes once when HeroMarket starts again.
- **Nothing changes in the rules:** a file with any mistake writes nothing and lists every mistake by sheet, row and column. You can download that list as Excel. The same file imported twice asks you first.
- **The import needs no internet and no website.** It works the same on a shop PC that was never linked.
- **On the website, reloading the page keeps you signed in.** Before, every reload went back to the sign-in screen. Signing out, an expired session or a password change still signs you out. The shop PC still always starts locked.
- **Sales made while the internet was down reach the website within seconds** of the internet coming back. Before, it could take up to five minutes.
- **A large store links completely the first time.** Before, with more than a few thousand records, the products' packages and their barcodes could be missing from the website after linking.

## Checked before this release

- **Imports of 50 to 20,000 products in the real program, never linked:** every row saved exactly once; stock equal to its history. Reloading the window, closing the program, or ending it by force in the middle never left anything half saved.
- **Linking after those imports:** 21,750 products reached the website in about two minutes, each once, with the same stock, packages and barcodes as the shop.
- **Offline sales:** 2, 10, 50, 100 and 500 invoices made with the internet off all reached the website within 14 seconds of it coming back, each once, with the right totals and stock.
- **Signing in on the website:** reloads, several tabs, closing and reopening the browser, an expired or cancelled session, a forged one.
- **All 565 automatic tests,** plus the full program on Windows and in a browser on every change.

## The installer

|            |                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| File       | `HeroMarket-Setup-1.7.0.exe`                                                                                                 |
| Size       | 181,027,981 bytes                                                                                                            |
| SHA-256    | `8f112787f2ac1475acf29e7e45838a9b4b5578020a593728fd43dcc53103f475`                                                           |
| Built from | the tag `v1.7.0` (`main`'s merge commit `82793d0`) by the release workflow on GitHub, after lint and every test passed there |
| Signed     | no ("Windows protected your PC" → More info → Run anyway)                                                                    |

Check the file before installing: `Get-FileHash HeroMarket-Setup-1.7.0.exe` must show the SHA-256 above ([ROLLOUT_GUIDE.md](ROLLOUT_GUIDE.md) step 10).

**Checked in Windows Sandbox** (a clean Windows, made-up data): this installer over the released 1.6.2, on a paired store with 177 changes waiting to be sent and its background service running. The installer took its verified copy and added the two database changes of this release (result "ok"). The pairing, the waiting changes, the customers and their codes, the supplier's balance and the preliminary invoice were identical afterwards. The background service started as 1.7.0.

**The website** was updated to 1.7.0 on 2026-11-14 and is empty, ready for the shop PC to link again.
