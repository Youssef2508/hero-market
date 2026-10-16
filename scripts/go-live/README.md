# Go-live USB folder

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
