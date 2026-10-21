// Right-to-left printing (owner feedback PRINT-01): the print script renders a fixture receipt
// and a shift report to PNG with the same drawing code it prints with (-PreviewFile), and a real
// print to a missing printer still fails clearly. Windows only (GDI+ printing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildReceiptLines, defaultTemplate } from '../../src/shared/receipt.mjs'
import { buildShiftReportLines } from '../../src/shared/reportLines.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', '..', 'resources', 'print_receipt.ps1')
const ps = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
)
const windows = process.platform === 'win32'

const store = { name: 'سوبر ماركت تجربة', branch: 'الفرع الرئيسي', phone: '0220000000-0221111111' }
const sale = {
  saleId: 28,
  date: '٢٠٢٦/١٠/٢١',
  time: '09:34 PM',
  cashier: 'AhmedSalah',
  paymentType: 'نقدي',
  client: { name: 'عميل تجربة', phone: '01000000000' },
  items: [
    { name: 'بيبسي كانز ستار 355 مل', qty: 1, price: 15, total: 15 },
    { name: 'Nescafe Gold 200g', qty: 2, price: 120, total: 240 },
    { name: 'طماطم', qty: '0.125 كجم', price: 20, total: 2.5 }
  ],
  subTotal: 257.5,
  discount: 2,
  total: 255.5,
  paid: 260,
  change: 4.5
}

function render(lines, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-print-'))
  const txt = path.join(dir, 'lines.txt')
  const png = path.join(dir, 'page.png')
  fs.writeFileSync(txt, lines.join('\r\n'), 'utf8')
  const out = execFileSync(
    ps,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-TextFile',
      txt,
      '-PrinterName',
      'HeroMarket-no-such-printer',
      '-PreviewFile',
      png,
      ...extra
    ],
    { encoding: 'utf8' }
  )
  return { out, png, dir }
}

test('the print script keeps its UTF-8 byte-order mark (Windows PowerShell 5.1 reads Arabic)', () => {
  const head = fs.readFileSync(script).subarray(0, 3)
  assert.deepEqual([...head], [0xef, 0xbb, 0xbf])
})

test(
  'a receipt and a shift report render to PNG with the printing code',
  { skip: !windows },
  (t) => {
    const receipt = render(buildReceiptLines(defaultTemplate('80mm'), sale, store), [
      '-TemplateLayout'
    ])
    if (/not valid/.test(receipt.out)) return t.skip('no printer at all on this machine')
    assert.match(receipt.out, /PREVIEW_DONE 1/)
    assert.ok(fs.statSync(receipt.png).size > 10000, 'a drawn page')
    assert.doesNotMatch(receipt.out, /PRINT_DONE/, 'a preview never claims a print')
    const report = render(
      buildShiftReportLines(
        {
          shift: {
            id: 6,
            username: 'AhmedSalah',
            initial_cash: 200,
            start_time: '2026-10-21 08:00:00'
          },
          cashSales: 1500,
          expected: 1665,
          actual: 1650,
          difference: -15,
          manualDiscounts: {
            count: 1,
            total: 2,
            invoices: [{ saleId: 28, amount: 2, username: 'owner' }]
          }
        },
        { store }
      )
    )
    assert.match(report.out, /PREVIEW_DONE 1/)
    fs.rmSync(receipt.dir, { recursive: true, force: true })
    fs.rmSync(report.dir, { recursive: true, force: true })
  }
)

test(
  'a real print to a missing printer fails with exit code 2 (unchanged)',
  { skip: !windows },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-print-'))
    const txt = path.join(dir, 'lines.txt')
    fs.writeFileSync(txt, 'سطر|1', 'utf8')
    const r = spawnSync(
      ps,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-TextFile',
        txt,
        '-PrinterName',
        'HeroMarket-no-such-printer'
      ],
      { encoding: 'utf8' }
    )
    assert.equal(r.status, 2)
    assert.match(r.stdout, /PRINT_FAILED: INVALID_PRINTER/)
    fs.rmSync(dir, { recursive: true, force: true })
  }
)
