param([string]$TextFile, [string]$PrinterName, [int]$FontSize = 8, [string]$Paper = '80mm', [string]$LogoFile = '', [string]$OutFile = '')

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
    $lh  = [int]($font.GetHeight($g)) + 2
    $y   = [int]$e.MarginBounds.Y
    $x   = [int]$e.MarginBounds.X
    $w   = [int]$e.MarginBounds.Width
    $bot = [int]($e.MarginBounds.Y + $e.MarginBounds.Height)
    # Column widths were tuned for 80mm (about 265 units printable); scale them for other widths.
    $k = [Math]::Max(0.6, [Math]::Min(1.2, $w / 265.0))
    $cQty = [int](30 * $k); $cPrice = [int](40 * $k); $cTotal = [int](50 * $k); $cVal = [int](70 * $k)

    # 1. Draw logo at the very top (only on first page)
    if (-not $script:logoPrinted) {
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
        if (($y + $lh) -gt $bot) { $e.HasMorePages = $true; return }
        $line = $script:lines[$script:lineIdx]
        
        # [B] marks a bold label | value row (template totals)
        $boldRow = $false
        if ($line.StartsWith("[B]")) { $boldRow = $true; $line = $line.Substring(3) }

        # Check if it's a split table row
        if ($line -like '*|*') {
            $parts = $line.Split('|')
            if ($parts.Count -eq 4) {
                # Table Row: ItemName | Qty | Price | Total
                # Define column bounds
                # Col 0 (Name): X=0 to X = w-120
                $nameW = $w - ($cQty + $cPrice + $cTotal)
                $rName = New-Object System.Drawing.RectangleF($x, $y, $nameW, $lh)
                $rQty  = New-Object System.Drawing.RectangleF(($x + $nameW), $y, $cQty, $lh)
                $rPrice = New-Object System.Drawing.RectangleF(($x + $nameW + $cQty), $y, $cPrice, $lh)
                $rTotal = New-Object System.Drawing.RectangleF(($x + $w - $cTotal), $y, $cTotal, $lh)

                # Draw columns
                $g.DrawString($parts[0].Trim(), $font, [System.Drawing.Brushes]::Black, $rName, $sfRight)
                $g.DrawString($parts[1].Trim(), $font, [System.Drawing.Brushes]::Black, $rQty, $sfCenter)
                $g.DrawString($parts[2].Trim(), $font, [System.Drawing.Brushes]::Black, $rPrice, $sfCenter)
                $g.DrawString($parts[3].Trim(), $font, [System.Drawing.Brushes]::Black, $rTotal, $sfLeft)
            }
            elseif ($parts.Count -eq 2) {
                # Label Value: Label | Value
                $rLabel = New-Object System.Drawing.RectangleF($x, $y, ($w - $cVal), $lh)
                $rValue = New-Object System.Drawing.RectangleF(($x + $w - $cVal), $y, $cVal, $lh)
                
                # Check for Bold values (e.g. Total sum)
                $f = $font
                if ($boldRow -or $parts[0] -like '*الإجمالي*') { $f = $fontBold }

                $g.DrawString($parts[0].Trim(), $f, [System.Drawing.Brushes]::Black, $rLabel, $sfRight)
                $g.DrawString($parts[1].Trim(), $f, [System.Drawing.Brushes]::Black, $rValue, $sfLeft)
            }
        } else {
            # Single line alignment parsing
            if ($line.StartsWith("[BOX]")) {
                $cleanLine = $line.Substring(5)
                
                $boxLines = @()
                if ($cleanLine -like '*~*') {
                    $boxLines = $cleanLine.Split('~')
                } else {
                    $boxLines = @($cleanLine)
                }
                
                $lineCount = $boxLines.Count
                $boxH = ($lh * $lineCount) + 6
                $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $boxH)
                
                $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)
                $g.DrawRectangle($pen, $x, $y, $w, $boxH)
                $pen.Dispose()
                
                $sfBox = New-Object System.Drawing.StringFormat
                $sfBox.Alignment = [System.Drawing.StringAlignment]::Center
                
                for ($i = 0; $i -lt $lineCount; $i++) {
                    $lineY = $y + 3 + ($i * $lh)
                    $lineRect = New-Object System.Drawing.RectangleF($x, $lineY, $w, $lh)
                    $g.DrawString($boxLines[$i].Trim(), $fontBold, [System.Drawing.Brushes]::Black, $lineRect, $sfBox)
                }
                $sfBox.Dispose()
                
                $y += $boxH
                $script:lineIdx++
                continue
            }

            $sf = $sfRight # Default to right-aligned
            $cleanLine = $line
            $f = $font

            if ($line.StartsWith("[C]")) {
                $sf = $sfCenter
                $cleanLine = $line.Substring(3)
                $f = $fontBold
            } elseif ($line.StartsWith("[R]")) {
                $sf = $sfRight
                $cleanLine = $line.Substring(3)
            } elseif ($line.StartsWith("[L]")) {
                $sf = $sfLeft
                $cleanLine = $line.Substring(3)
            }

            # Draw single line
            $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $lh)
            $g.DrawString($cleanLine, $f, [System.Drawing.Brushes]::Black, $rect, $sf)
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
$sfRight.Dispose()
$sfCenter.Dispose()
$sfLeft.Dispose()
Write-Host "PRINT_DONE"
