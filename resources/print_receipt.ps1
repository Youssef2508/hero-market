# Prints a receipt written in the line language of src/shared/receipt.mjs.
# -TemplateLayout: the lines come from a receipt template ([LOGO] places the logo; no automatic logo
# at the top and no automatic bold total).
param([string]$TextFile, [string]$PrinterName, [int]$FontSize = 8, [string]$Paper = '80mm', [string]$LogoFile = '', [string]$OutFile = '', [switch]$TemplateLayout)

Add-Type -AssemblyName System.Drawing

$script:lines = [System.IO.File]::ReadAllLines($TextFile, [System.Text.Encoding]::UTF8)
$script:lineIdx = 0
$script:logoPrinted = $false

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName
# Verification aid: print silently to a file (e.g. with "Microsoft Print to PDF").
if ($OutFile) {
    $doc.PrinterSettings.PrintToFile = $true
    $doc.PrinterSettings.PrintFileName = $OutFile
}

# Select the receipt roll paper (80mm by default, 58mm when requested)
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

# Reusable string formats
$sfRight  = New-Object System.Drawing.StringFormat
$sfRight.Alignment = [System.Drawing.StringAlignment]::Far

$sfCenter = New-Object System.Drawing.StringFormat
$sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

$sfLeft   = New-Object System.Drawing.StringFormat
$sfLeft.Alignment = [System.Drawing.StringAlignment]::Near

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
    $cQty = [int](30 * $k); $cPrice = [int](40 * $k); $cTotal = [int](50 * $k); $cVal = [int](70 * $k)

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
            $sfBox = $sfCenter
            if ($tags['R']) { $sfBox = $sfRight } elseif ($tags['L']) { $sfBox = $sfLeft }
            for ($i = 0; $i -lt $lineCount; $i++) {
                $lineRect = New-Object System.Drawing.RectangleF(($x + 4), ($y + 3 + ($i * $lh)), ($w - 8), $lh)
                $g.DrawString($boxLines[$i].Trim(), $f, [System.Drawing.Brushes]::Black, $lineRect, $sfBox)
            }
            $y += $boxH
            $script:lineIdx++
            continue
        }

        if ($line -like '*|*') {
            $parts = $line.Split('|')
            if ($parts.Count -eq 4) {
                # Table row: ItemName | Qty | Price | Total
                $nameW = $w - ($cQty + $cPrice + $cTotal)
                $rName = New-Object System.Drawing.RectangleF($x, $y, $nameW, $lh)
                $rQty  = New-Object System.Drawing.RectangleF(($x + $nameW), $y, $cQty, $lh)
                $rPrice = New-Object System.Drawing.RectangleF(($x + $nameW + $cQty), $y, $cPrice, $lh)
                $rTotal = New-Object System.Drawing.RectangleF(($x + $w - $cTotal), $y, $cTotal, $lh)
                $g.DrawString($parts[0].Trim(), $f, [System.Drawing.Brushes]::Black, $rName, $sfRight)
                $g.DrawString($parts[1].Trim(), $f, [System.Drawing.Brushes]::Black, $rQty, $sfCenter)
                $g.DrawString($parts[2].Trim(), $f, [System.Drawing.Brushes]::Black, $rPrice, $sfCenter)
                $g.DrawString($parts[3].Trim(), $f, [System.Drawing.Brushes]::Black, $rTotal, $sfLeft)
            }
            elseif ($parts.Count -eq 2) {
                # Label | Value across the width. Legacy callers: the total label is always bold.
                if (-not $TemplateLayout -and $parts[0] -like '*الإجمالي*') {
                    if ($big) { $f = $fontBigBold } else { $f = $fontBold }
                }
                $valueW = [int]($cVal * ($f.Size / $font.Size))
                $rLabel = New-Object System.Drawing.RectangleF($x, $y, ($w - $valueW), $lh)
                $rValue = New-Object System.Drawing.RectangleF(($x + $w - $valueW), $y, $valueW, $lh)
                $g.DrawString($parts[0].Trim(), $f, [System.Drawing.Brushes]::Black, $rLabel, $sfRight)
                $g.DrawString($parts[1].Trim(), $f, [System.Drawing.Brushes]::Black, $rValue, $sfLeft)
            }
        } else {
            $sf = $sfRight # Default to right-aligned
            if ($tags['C']) { $sf = $sfCenter } elseif ($tags['L']) { $sf = $sfLeft }
            $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $lh)
            $g.DrawString($line, $f, [System.Drawing.Brushes]::Black, $rect, $sf)
        }

        $y += $lh
        $script:lineIdx++
    }
    $e.HasMorePages = $false
})

$doc.Print()
$doc.Dispose()
$font.Dispose()
$fontBold.Dispose()
$fontBig.Dispose()
$fontBigBold.Dispose()
$sfRight.Dispose()
$sfCenter.Dispose()
$sfLeft.Dispose()
Write-Host "PRINT_DONE"
