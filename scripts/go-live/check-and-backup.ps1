# HeroMarket 1.4.0 at the supermarket: steps 7 and 9 of the guide, done for you.
#  1. Checks that the two installers on this USB stick are the right, undamaged files.
#  2. Copies the HeroMarket 1.3 data of THIS Windows user to the USB stick and checks the copy.
# It only READS the 1.3 data. Nothing on this PC is changed or deleted.
# (ASCII only: Windows PowerShell 5.1 shows Arabic badly in the console.)
param([string]$Source = (Join-Path $env:APPDATA 'elnagdi-pos'))

$ErrorActionPreference = 'Stop'
$usb = Split-Path -Parent $PSScriptRoot
$problems = 0
function Ok($m) { Write-Host "  OK   $m" -ForegroundColor Green }
function Bad($m) { Write-Host "  STOP $m" -ForegroundColor Red; $script:problems++ }
function Info($m) { Write-Host "       $m" }

Write-Host ''
Write-Host '=== HeroMarket 1.4.0: check the installers and back up the 1.3 data ===' -ForegroundColor Cyan
Write-Host ''
Write-Host '1. Installers on the USB stick'
foreach ($line in Get-Content (Join-Path $usb 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') { continue }
  $want = $Matches[1].ToUpper(); $rel = $Matches[2].Trim()
  $file = Join-Path $usb $rel
  if (-not (Test-Path $file)) { Bad "$rel is missing"; continue }
  $got = (Get-FileHash $file -Algorithm SHA256).Hash
  if ($got -eq $want) { Ok "$rel (fingerprint correct)" } else { Bad "$rel is DAMAGED or wrong (fingerprint differs). Copy it again." }
}

Write-Host ''
Write-Host '2. HeroMarket 1.3 must be closed'
$running = @(Get-Process -Name 'elnagdi-pos' -ErrorAction SilentlyContinue)
if ($running.Count) { Bad 'HeroMarket 1.3 is open. Close its shift, close the program, then run this again.' }
else { Ok 'HeroMarket 1.3 is closed' }

Write-Host ''
Write-Host "3. The 1.3 data of this Windows user ($env:USERNAME)"
$db = Join-Path $Source 'market_unified.db'
if (-not (Test-Path $db)) {
  Bad "No 1.3 data here: $Source"
  Info 'Sign in to Windows as the user who uses HeroMarket 1.3 every day, then run this again.'
} else {
  $files = @(Get-ChildItem $Source -Recurse -File)
  $size = ($files | Measure-Object Length -Sum).Sum
  Ok ("found: {0} files, {1:N1} MB, database changed {2}" -f $files.Count, ($size / 1MB), (Get-Item $db).LastWriteTime)
  $free = (Get-PSDrive -Name ($usb.Substring(0, 1))).Free
  if ($free -lt ($size * 1.2 + 50MB)) { Bad ("not enough free space on the USB stick ({0:N0} MB free)" -f ($free / 1MB)) }
}

if ($problems -eq 0) {
  Write-Host ''
  Write-Host '4. Copying the 1.3 data to the USB stick'
  $dest = Join-Path $usb ('backup-1.3-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm'))
  # /E all folders, /COPY:DAT data+attributes+times, /R:1 /W:1 do not hang on a locked file.
  & robocopy $Source $dest /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Bad "the copy failed (robocopy code $LASTEXITCODE)" }
  else {
    # Every file of the copy must be identical to the original.
    $list = @()
    $differ = 0
    foreach ($f in Get-ChildItem $Source -Recurse -File) {
      $rel = $f.FullName.Substring($Source.Length).TrimStart('\')
      $copy = Join-Path $dest $rel
      $h1 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
      $h2 = if (Test-Path $copy) { (Get-FileHash $copy -Algorithm SHA256).Hash } else { 'missing' }
      if ($h1 -ne $h2) { $differ++ }
      $list += "$h1  $rel"
    }
    $list | Set-Content (Join-Path $dest 'FINGERPRINTS.txt') -Encoding ASCII
    if ($differ) { Bad "$differ file(s) differ between the original and the copy. Run this again." }
    else { Ok "backup complete and checked: $dest" }
  }
}

Write-Host ''
if ($problems -eq 0) {
  Write-Host 'ALL OK. Continue with step 10 of the guide (run HeroMarket-Setup-1.4.0.exe).' -ForegroundColor Green
} else {
  Write-Host "Something needs attention ($problems). Do NOT install yet; fix it and run this again." -ForegroundColor Red
}
Write-Host ''
