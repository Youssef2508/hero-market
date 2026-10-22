# Prints a receipt written in the line language of src/shared/receipt.mjs.
# -TemplateLayout: the lines come from a receipt template ([LOGO] places the logo; no automatic logo
# at the top and no automatic bold total).
# -PreviewFile: draw the page(s) with exactly the same code into PNG image(s) instead of printing
# (verification without a printer; owner feedback PRINT-01).
#
# Right-to-left layout (owner feedback PRINT-01, receipt photo .docs/reference-images): the receipt
# is Arabic, so its structure reads from the right.
#   - A line that contains Arabic is drawn as a right-to-left paragraph (colons, numbers and Latin
#     names inside it keep their logical order); a Latin-only line stays left-to-right.
#   - Item table "name|qty|price|total": name at the RIGHT edge, then qty, price, and the total at
#     the LEFT edge; the header uses the same columns, so headers and values line up.
#   - "label|value": the label at the right, the value at the left.
#   - A two-sided line (text, 3+ spaces, text; e.g. time and date) keeps its left part at the left
#     and its right part at the right instead of being shaped as one sentence.
param([string]$TextFile, [string]$PrinterName, [int]$FontSize = 8, [string]$Paper = '80mm', [string]$LogoFile = '', [string]$OutFile = '', [string]$PreviewFile = '', [switch]$TemplateLayout)

Add-Type -AssemblyName System.Drawing

$script:lines = [System.IO.File]::ReadAllLines($TextFile, [System.Text.Encoding]::UTF8)
$script:lineIdx = 0
$script:logoPrinted = $false

$doc = New-Object System.Drawing.Printing.PrintDocument
# No name: Windows' default printer.
if ($PrinterName) { $doc.PrinterSettings.PrinterName = $PrinterName }
$target = $doc.PrinterSettings.PrinterName
$preview = [bool]$PreviewFile
# A preview needs some valid printer for its page metrics only (nothing is sent to it): without
# the named one, use Windows' default printer.
if ($preview -and -not $doc.PrinterSettings.IsValid) {
    $doc.PrinterSettings = New-Object System.Drawing.Printing.PrinterSettings
}
# Every failure ends with PRINT_FAILED and a non-zero exit code; PRINT_DONE only after a real print
# (1.4.0: a missing printer used to end with PRINT_DONE, so the cashier was never told).
if (-not $preview -and -not $doc.PrinterSettings.IsValid) {
    Write-Host "PRINT_FAILED: INVALID_PRINTER $target"
    exit 2
}
# A printer that asks for a file name (Microsoft Print to PDF, XPS…) would wait for a dialog nobody
# sees during silent printing: refuse it, unless printing to a file on purpose (-OutFile).
if (-not $OutFile -and -not $preview) {
    $wql = "Name='" + $target.Replace('\', '\\').Replace("'", "\'") + "'"
    $printer = Get-CimInstance Win32_Printer -Filter $wql -ErrorAction SilentlyContinue
    if ($printer -and $printer.PortName -eq 'PORTPROMPT:') {
        Write-Host "PRINT_FAILED: NEEDS_FILE_NAME $target"
        exit 3
    }
}
# Verification aid: print silently to a file (e.g. with "Microsoft Print to PDF").
if ($OutFile) {
    $doc.PrinterSettings.PrintToFile = $true
    $doc.PrinterSettings.PrintFileName = $OutFile
}

# Select the receipt roll paper (80mm by default, 58mm when requested)
$receiptPaper = $null
if ($doc.PrinterSettings.IsValid) {
    if ($Paper -eq '58mm') {
        $receiptPaper = $doc.PrinterSettings.PaperSizes | Where-Object {
            $_.PaperName -like '*Receipt*58*' -or $_.PaperName -like '*58*mm*'
        } | Select-Object -First 1
        if (-not $receiptPaper) {
            $receiptPaper = $doc.PrinterSettings.PaperSizes | Where-Object { $_.Width -ge 220 -and $_.Width -le 232 } | Sort-Object Height -Descending | Select-Object -First 1
        }
    } else {
        $receiptPaper = $doc.PrinterSettings.PaperSizes | Where-Object {
            $_.PaperName -like '*Receipt*80*' -or $_.PaperName -like '*Receipt*3276*48*'
        } | Select-Object -First 1
        if (-not $receiptPaper) {
            $receiptPaper = $doc.PrinterSettings.PaperSizes | Where-Object { $_.Width -eq 315 } | Sort-Object Height -Descending | Select-Object -First 1
        }
    }
}
# A preview (or a printer without roll sizes) uses the roll width itself: 80 mm = 315, 58 mm = 228
# hundredths of an inch, long enough for one page.
if ($preview -and -not $receiptPaper) {
    $rollW = 315
    if ($Paper -eq '58mm') { $rollW = 228 }
    $receiptPaper = New-Object System.Drawing.Printing.PaperSize('Receipt', $rollW, 1100)
}

if ($receiptPaper) {
    $doc.DefaultPageSettings.PaperSize = $receiptPaper
    Write-Host "Using paper: $($receiptPaper.PaperName)"
}

# Margins
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(15, 35, 5, 5)

if ($FontSize -lt 7 -or $FontSize -gt 11) { $FontSize = 8 }
$font = New-Object System.Drawing.Font("Arial", $FontSize, [System.Drawing.FontStyle]::Regular)
$fontBold = New-Object System.Drawing.Font("Arial", $FontSize, [System.Drawing.FontStyle]::Bold)
$fontBig = New-Object System.Drawing.Font("Arial", ($FontSize + 4), [System.Drawing.FontStyle]::Regular)
$fontBigBold = New-Object System.Drawing.Font("Arial", ($FontSize + 4), [System.Drawing.FontStyle]::Bold)

# String formats: right-to-left paragraphs (Arabic) and left-to-right ones (Latin-only text). With
# DirectionRightToLeft, "Near" is the right edge and "Far" the left edge.
function New-Format([bool]$rtl, [System.Drawing.StringAlignment]$align) {
    $sf = New-Object System.Drawing.StringFormat
    if ($rtl) { $sf.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft }
    $sf.Alignment = $align
    return $sf
}
$N = [System.Drawing.StringAlignment]::Near
$F = [System.Drawing.StringAlignment]::Far
$M = [System.Drawing.StringAlignment]::Center
$formats = @{
    'rtl-right' = (New-Format $true $N); 'rtl-left' = (New-Format $true $F); 'rtl-center' = (New-Format $true $M)
    'ltr-right' = (New-Format $false $F); 'ltr-left' = (New-Format $false $N); 'ltr-center' = (New-Format $false $M)
}
# Arabic letters (Arabic, Arabic Supplement, Arabic Presentation Forms A and B).
$arabic = [regex]'[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]'
function Format-For([string]$text, [string]$side) {
    $dir = 'ltr'
    if ($arabic.IsMatch($text)) { $dir = 'rtl' }
    return $formats["$dir-$side"]
}
# Inside an Arabic line, a run of Latin letters with digits and punctuation ("09:34 PM",
# "AhmedSalah", "Gold 200g") keeps its own left-to-right order: it is wrapped in left-to-right
# marks (U+200E), so "09:34 PM" never becomes "PM 09:34". GDI+ draws the embedding and isolate
# controls (U+202A/202C, U+2066/2069) as visible boxes; the marks it does not draw (tested).
# Runs of plain digits with separators ("2026-10-21 08:00:00", "#6", "-15.00") are wrapped too:
# GDI+ otherwise shows them as "08:00:00 21-10-2026", "6#" and "15.00-".
$latinRun = [regex]'[-+#]?[A-Za-z0-9][A-Za-z0-9 .,:/\-_+()%#@]*[A-Za-z0-9)%]|[-+#]?[A-Za-z0-9]'
function Isolate-Latin([string]$text) {
    if (-not $arabic.IsMatch($text)) { return $text }
    $lrm = [string][char]0x200E
    return $latinRun.Replace($text, { param($m) $lrm + $m.Value + $lrm })
}
function Draw-Text($g, [string]$text, $f, [System.Drawing.RectangleF]$rect, [string]$side) {
    $g.DrawString((Isolate-Latin $text), $f, [System.Drawing.Brushes]::Black, $rect, (Format-For $text $side))
}
# Table column widths: at least the tuned defaults, wider when a value needs it (e.g. "0.125 كجم"),
# the same for every row so headers and values stay aligned; the name keeps at least 40%.
$script:cols = $null
function Get-Columns($g, [int]$w) {
    $k = [Math]::Max(0.6, [Math]::Min(1.2, $w / 265.0))
    $need = @([int](30 * $k), [int](40 * $k), [int](50 * $k))
    foreach ($raw in $script:lines) {
        $l = $raw -replace '^(\[(C|R|L|B|N|BIG|SMALL)\])+', ''
        $p = $l.Split('|')
        if ($p.Count -ne 4) { continue }
        for ($j = 1; $j -le 3; $j++) {
            $m = [int]($g.MeasureString((Isolate-Latin $p[$j].Trim()), $fontBold).Width) + 6
            if ($m -gt $need[$j - 1]) { $need[$j - 1] = $m }
        }
    }
    $sum = $need[0] + $need[1] + $need[2]
    $max = [int]($w * 0.6)
    if ($sum -gt $max) {
        $r = $max / $sum
        $need = @([int]($need[0] * $r), [int]($need[1] * $r), [int]($need[2] * $r))
    }
    return @{ Qty = $need[0]; Price = $need[1]; Total = $need[2] }
}

$doc.add_PrintPage({
    param($s, $e)
    $g   = $e.Graphics
    $y   = [int]$e.MarginBounds.Y
    $top = $y
    $x   = [int]$e.MarginBounds.X
    $w   = [int]$e.MarginBounds.Width
    $bot = [int]($e.MarginBounds.Y + $e.MarginBounds.Height)
    # Column widths were tuned for 80mm (about 265 units printable); scale them for other widths.
    $k = [Math]::Max(0.6, [Math]::Min(1.2, $w / 265.0))
    $cVal = [int](70 * $k)
    if (-not $script:cols) { $script:cols = Get-Columns $g $w }
    $cQty = $script:cols.Qty; $cPrice = $script:cols.Price; $cTotal = $script:cols.Total

    # Legacy callers: logo at the very top of the first page. Template receipts place it with [LOGO].
    if (-not $TemplateLayout -and -not $script:logoPrinted) {
        $logoPath = if ($LogoFile) { $LogoFile } else { Join-Path $PSScriptRoot "logo.png" }
        if (Test-Path $logoPath) {
            try {
                $img = [System.Drawing.Image]::FromFile($logoPath)
                $targetW = 120
                $targetH = [int]($img.Height * ($targetW / $img.Width))
                $logoX = [int]($x + ($w - $targetW) / 2)
                $g.DrawImage($img, $logoX, $y, $targetW, $targetH)
                $y += $targetH + 10
                $img.Dispose()
            } catch {
                # Ignore image loading/rendering errors silently
            }
        }
        $script:logoPrinted = $true
    }

    while ($script:lineIdx -lt $script:lines.Count) {
        $line = $script:lines[$script:lineIdx]

        # Leading tags (see src/shared/receipt.mjs): [C] [R] [L] [B] [N] [BIG] [SMALL] [BOX] [LOGO]
        $tags = @{}
        while ($line -match '^\[(C|R|L|B|N|BIG|SMALL|BOX|LOGO)\]') {
            $tags[$Matches[1]] = $true
            $line = $line.Substring($Matches[0].Length)
        }
        $big = [bool]$tags['BIG']

        if ($tags['LOGO']) {
            $logoW = 120
            if ($tags['SMALL']) { $logoW = 80 } elseif ($big) { $logoW = 170 }
            $logoW = [Math]::Min($logoW, $w)
            if ($LogoFile -and (Test-Path $LogoFile)) {
                try {
                    $img = [System.Drawing.Image]::FromFile($LogoFile)
                    $logoH = [int]($img.Height * ($logoW / $img.Width))
                    if ((($y + $logoH) -gt $bot) -and ($y -gt $top)) { $img.Dispose(); $e.HasMorePages = $true; return }
                    $lx = [int]($x + ($w - $logoW) / 2)
                    if ($tags['L']) { $lx = $x } elseif ($tags['R']) { $lx = $x + $w - $logoW }
                    $g.DrawImage($img, $lx, $y, $logoW, $logoH)
                    $y += $logoH + 10
                    $img.Dispose()
                } catch {
                    # A missing or unreadable logo never blocks the receipt
                }
            }
            $script:lineIdx++
            continue
        }

        # Weight: [C] is bold unless [N] (legacy); [B] is bold anywhere. Boxes are bold unless [N].
        $bold = ($tags['C'] -and -not $tags['N']) -or $tags['B']
        if ($tags['BOX']) { $bold = -not $tags['N'] }
        $f = $font
        if ($big -and $bold) { $f = $fontBigBold } elseif ($big) { $f = $fontBig } elseif ($bold) { $f = $fontBold }
        $lh = [int]($f.GetHeight($g)) + 2
        if (($y + $lh) -gt $bot) { $e.HasMorePages = $true; return }

        if ($tags['BOX']) {
            $boxLines = @($line.Split('~'))
            $lineCount = $boxLines.Count
            $boxH = ($lh * $lineCount) + 6
            if ((($y + $boxH) -gt $bot) -and ($y -gt $top)) { $e.HasMorePages = $true; return }
            $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)
            $g.DrawRectangle($pen, $x, $y, $w, $boxH)
            $pen.Dispose()
            $side = 'center'
            if ($tags['R']) { $side = 'right' } elseif ($tags['L']) { $side = 'left' }
            for ($i = 0; $i -lt $lineCount; $i++) {
                $lineRect = New-Object System.Drawing.RectangleF(($x + 4), ($y + 3 + ($i * $lh)), ($w - 8), $lh)
                Draw-Text $g $boxLines[$i].Trim() $f $lineRect $side
            }
            $y += $boxH
            $script:lineIdx++
            continue
        }

        if ($line -like '*|*') {
            $parts = $line.Split('|')
            if ($parts.Count -eq 4) {
                # Table row (and its header): name | qty | price | total, laid out from the RIGHT:
                # [ total | price | qty | name ] on paper (PRINT-01).
                $nameW = $w - ($cQty + $cPrice + $cTotal)
                $rTotal = New-Object System.Drawing.RectangleF($x, $y, $cTotal, $lh)
                $rPrice = New-Object System.Drawing.RectangleF(($x + $cTotal), $y, $cPrice, $lh)
                $rQty   = New-Object System.Drawing.RectangleF(($x + $cTotal + $cPrice), $y, $cQty, $lh)
                $rName  = New-Object System.Drawing.RectangleF(($x + $cTotal + $cPrice + $cQty), $y, $nameW, $lh)
                Draw-Text $g $parts[0].Trim() $f $rName 'right'
                Draw-Text $g $parts[1].Trim() $f $rQty 'center'
                Draw-Text $g $parts[2].Trim() $f $rPrice 'center'
                Draw-Text $g $parts[3].Trim() $f $rTotal 'left'
            }
            elseif ($parts.Count -eq 2) {
                # Label at the right, value at the left. Legacy callers: the total label is bold.
                if (-not $TemplateLayout -and $parts[0] -like '*الإجمالي*') {
                    if ($big) { $f = $fontBigBold } else { $f = $fontBold }
                }
                $valueW = [int]($cVal * ($f.Size / $font.Size))
                $rLabel = New-Object System.Drawing.RectangleF(($x + $valueW), $y, ($w - $valueW), $lh)
                $rValue = New-Object System.Drawing.RectangleF($x, $y, $valueW, $lh)
                Draw-Text $g $parts[0].Trim() $f $rLabel 'right'
                Draw-Text $g $parts[1].Trim() $f $rValue 'left'
            }
        } elseif (-not ($tags['C'] -or $tags['L'] -or $tags['R']) -and $line -match '^(.*\S)\s{3,}(\S.*)$') {
            # Two-sided line (receipt.mjs lrPad): left part at the left, right part at the right.
            $leftText = $Matches[1]; $rightText = $Matches[2]
            $half = [int]($w / 2)
            Draw-Text $g $leftText $f (New-Object System.Drawing.RectangleF($x, $y, $half, $lh)) 'left'
            Draw-Text $g $rightText $f (New-Object System.Drawing.RectangleF(($x + $half), $y, ($w - $half), $lh)) 'right'
        } else {
            $side = 'right' # Default to right-aligned
            if ($tags['C']) { $side = 'center' } elseif ($tags['L']) { $side = 'left' }
            $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $lh)
            Draw-Text $g $line $f $rect $side
        }

        $y += $lh
        $script:lineIdx++
    }
    $e.HasMorePages = $false
})

if ($preview) {
    $doc.PrintController = New-Object System.Drawing.Printing.PreviewPrintController
}
try {
    $doc.Print()
} catch {
    Write-Host "PRINT_FAILED: $($_.Exception.Message)"
    exit 1
}
if ($preview) {
    # One PNG per page: <PreviewFile>, then <name>-2.png, -3.png …
    $pages = $doc.PrintController.GetPreviewPageInfo()
    for ($i = 0; $i -lt $pages.Count; $i++) {
        $img = $pages[$i].Image
        $bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
        $bg = [System.Drawing.Graphics]::FromImage($bmp)
        $bg.Clear([System.Drawing.Color]::White)
        $bg.DrawImage($img, 0, 0, $img.Width, $img.Height)
        $bg.Dispose()
        $path = $PreviewFile
        if ($i -gt 0) { $path = [System.IO.Path]::ChangeExtension($PreviewFile, $null).TrimEnd('.') + "-$($i + 1).png" }
        $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    }
    Write-Host "PREVIEW_DONE $($pages.Count)"
}
$doc.Dispose()
$font.Dispose()
$fontBold.Dispose()
$fontBig.Dispose()
$fontBigBold.Dispose()
foreach ($sf in $formats.Values) { $sf.Dispose() }
if (-not $preview) { Write-Host "PRINT_DONE" }
