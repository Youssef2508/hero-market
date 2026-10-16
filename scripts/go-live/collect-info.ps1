# HeroMarket, visit 1 at the supermarket: collect what we need to prepare the installation.
# It only READS information. It installs nothing, changes nothing and copies no shop data.
# Everything is written to a folder next to this script on the USB stick.
# (ASCII only: Windows PowerShell 5.1 shows Arabic badly in the console.)
$ErrorActionPreference = 'Continue'
$usb = Split-Path -Parent $PSScriptRoot
$out = Join-Path $usb ('shop-info-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm'))
New-Item -ItemType Directory -Force $out | Out-Null
function Save($name, $data) { $data | Out-File (Join-Path $out $name) -Encoding utf8 -Width 400 }
function Step($m) { Write-Host "  - $m" }

Write-Host ''
Write-Host '=== HeroMarket visit 1: collecting information (nothing is changed) ===' -ForegroundColor Cyan

Step 'Windows and the PC'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Save 'windows.txt' @(
  "Windows: $($os.Caption) version $($os.Version) build $($os.BuildNumber)"
  "64-bit Windows: $([Environment]::Is64BitOperatingSystem)   (HeroMarket needs 64-bit)"
  "PC name: $env:COMPUTERNAME   model: $($cs.Manufacturer) $($cs.Model)"
  "Processor: $($cpu.Name)"
  ("Memory: {0:N1} GB" -f ($cs.TotalPhysicalMemory / 1GB))
  ("Disk C: {0:N1} GB free of {1:N1} GB" -f ($disk.FreeSpace / 1GB), ($disk.Size / 1GB))
  "Signed-in Windows user: $env:USERNAME   administrator: $admin"
  ''
  'Windows users on this PC:'
  (Get-CimInstance Win32_UserAccount -Filter 'LocalAccount=True' | Where-Object { -not $_.Disabled } | ForEach-Object { "  $($_.Name)" })
)

Step 'Printers and their drivers'
$printers = @(Get-CimInstance Win32_Printer)
Save 'printers.txt' @(
  'Printers (the receipt printer is usually the one with a POS/thermal model name):'
  ($printers | ForEach-Object { "  Name: '$($_.Name)'   Driver: $($_.DriverName)   Port: $($_.PortName)   Default: $($_.Default)   Status: $($_.PrinterStatus)" })
  ''
  'Paper sizes the default printer reports:'
  (($printers | Where-Object Default | Select-Object -First 1).PrinterPaperNames -join ', ')
)

Step 'USB devices (the barcode scanner usually appears as a keyboard)'
$classes = 'Keyboard', 'HIDClass', 'Ports', 'Printer', 'USB', 'Image', 'Mouse'
$devs = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $classes -contains $_.Class }
Save 'usb-devices.txt' ($devs | Sort-Object Class, FriendlyName | ForEach-Object { "  [$($_.Class)] $($_.FriendlyName)   ($($_.Manufacturer))   $($_.InstanceId)" })

Step 'Installed programs (to identify the current POS program)'
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.Publisher -notmatch '^Microsoft' } | Sort-Object DisplayName -Unique
Save 'programs.txt' ($apps | ForEach-Object { "  $($_.DisplayName)   version $($_.DisplayVersion)   by $($_.Publisher)   folder: $($_.InstallLocation)" })

Step 'Database services (SQL Server, MySQL, Firebird...)'
$svc = Get-CimInstance Win32_Service | Where-Object { $_.Name -match 'sql|mysql|maria|firebird|interbase|postgres|mongo|access' -or $_.DisplayName -match 'SQL|MySQL|Firebird|Postgre' }
Save 'database-services.txt' ($svc | ForEach-Object { "  $($_.Name)   '$($_.DisplayName)'   state: $($_.State)   start: $($_.StartMode)   program: $($_.PathName)" })

Step 'Files that look like a POS database (names, sizes and dates only; nothing is opened or copied)'
$ext = '.mdb', '.accdb', '.db', '.sqlite', '.sqlite3', '.sdf', '.fdb', '.gdb', '.mdf', '.dbf', '.db3'
$roots = @()
$roots += $apps | Where-Object { $_.InstallLocation -and (Test-Path $_.InstallLocation) } | ForEach-Object { $_.InstallLocation }
$roots += 'C:ProgramData', "$env:APPDATA", "$env:LOCALAPPDATA", 'C:Program Files', 'C:Program Files (x86)'
$roots += Get-ChildItem 'C:' -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', '$Recycle.Bin', 'Recovery', 'PerfLogs', 'System Volume Information' } | ForEach-Object { $_.FullName }
$skip = '^(Microsoft|Windows|WindowsApps|Packages|Google|Mozilla|NVIDIA|Intel|AMD|Temp|node_modules|.git|Cache|cache|Code|npm-cache|Package Cache|Common Files|WinAVR.*|Adobe|Steam)$'
# Breadth-first, at most 5 levels deep and 2 minutes in total, so a large disk never blocks the visit.
$clock = [Diagnostics.Stopwatch]::StartNew()
$queue = New-Object System.Collections.Queue
foreach ($r in ($roots | Where-Object { $_ } | Select-Object -Unique)) { $queue.Enqueue(@($r, 0)) }
$found = New-Object System.Collections.ArrayList
$stopped = $false
while ($queue.Count) {
  if ($clock.Elapsed.TotalSeconds -gt 120) { $stopped = $true; break }
  $item = $queue.Dequeue(); $dir = $item[0]; $depth = $item[1]
  try { $entries = [IO.Directory]::GetFileSystemEntries($dir) } catch { continue }
  foreach ($e in $entries) {
    $name = [IO.Path]::GetFileName($e)
    if ([IO.Directory]::Exists($e)) {
      if ($depth -lt 5 -and $name -notmatch $skip) { $queue.Enqueue(@($e, $depth + 1)) }
    } elseif ($ext -contains [IO.Path]::GetExtension($e).ToLower()) {
      $fi = New-Object IO.FileInfo $e
      if ($fi.Length -gt 20KB) { [void]$found.Add($fi) }
    }
  }
}
$found = $found | Sort-Object FullName -Unique | Sort-Object LastWriteTime -Descending | Select-Object -First 200
Save 'database-files.txt' @(
  'Most recently changed first. The POS database is usually large and changed today:'
  $(if ($stopped) { '(The search stopped after 2 minutes; some folders were not searched.)' } else { '(All likely folders searched.)' })
  ($found | ForEach-Object { "  {0:yyyy-MM-dd HH:mm}  {1,10:N0} KB  {2}" -f $_.LastWriteTime, ($_.Length / 1KB), $_.FullName })
)

Save 'README.txt' @(
  'Collected by HeroMarket visit-1 script. It lists information only; no shop data was copied.'
  "Collected on $(Get-Date -Format 'yyyy-MM-dd HH:mm') on $env:COMPUTERNAME by $env:USERNAME."
)

Write-Host ''
Write-Host "DONE. Everything is in: $out" -ForegroundColor Green
Write-Host 'Bring this folder back (and the photos from the guide).'
Write-Host ''
