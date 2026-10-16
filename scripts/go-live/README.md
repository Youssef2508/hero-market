# Go-live USB folders

## Visit 1 (collect information; `.docs/SUPERMARKET_VISIT_1.md`)

```
HeroMarket-visit-1-collect-info/
  START-HERE.html, SUPERMARKET_VISIT_1.md   the guide
  1-Collect-PC-info.cmd                     runs tools/collect-info.ps1
  tools/collect-info.ps1                    Windows, printers, USB devices, programs, database services and
                                            likely POS database files (names only); writes shop-info-<date>/
```

`collect-info.ps1` only reads; it copies no shop data. Its file search stops after 2 minutes and 5 levels.

## Installation at a PC that runs HeroMarket 1.3 (`.docs/GO_LIVE_AT_THE_SUPERMARKET.md`)

What goes on the USB stick for the installation at the supermarket (`.docs/GO_LIVE_AT_THE_SUPERMARKET.md`):

```
HeroMarket-1.4.0-for-the-supermarket/
  START-HERE.html                         the guide, rendered for any browser
  GO_LIVE_AT_THE_SUPERMARKET.md           the same guide as text
  HeroMarket-Setup-1.4.0.exe              the final candidate
  SHA256SUMS.txt                          fingerprints of both installers (paths relative to the folder)
  1-Check-installers-and-backup-1.3.cmd   runs tools/check-and-backup.ps1
  tools/check-and-backup.ps1              checks the installers, backs up %APPDATA%\elnagdi-pos and verifies the copy
  go-back-to-1.3/elnagdi-pos-1.3.0-setup.exe
```

`check-and-backup.ps1` only reads the 1.3 data; it writes nothing on the PC except the backup on the USB stick. It was tested against a copy of the store data, and with missing data and a damaged installer.
