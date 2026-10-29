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

// 1.5.2 (D-098): the detailed close report – every return, credit sale, supplier invoice and
// purchase return on its own line – is drawn by the printing code, right to left, with no line
// dropped. HM_KEEP_PREVIEW=<file> keeps the drawn page for a person to look at.
test('the detailed close report renders to PNG with every line', { skip: !windows }, async (t) => {
  const { buildCloseReportLines } = await import('../../src/shared/reportLines.mjs')
  const rep = {
    shiftId: 9,
    cashier: 'AhmedSalah',
    openedAt: '2026-10-29 08:00:00',
    closedAt: '2026-10-29 20:00:00',
    openingFloat: 2000,
    invoiceCount: 4,
    totalSales: 390,
    salesByMethod: { cash: 220, visa: 0, wallet: 0, instapay: 0 },
    cash: { sales: 220, inflow: 90, expenses: 15, refunds: 65, supplier: 320 },
    expected: { cash: 1910, visa: 0, wallet: 0, instapay: 0 },
    actual: { cash: 1910, visa: 0, wallet: 0, instapay: 0 },
    variance: { cash: 0, visa: 0, wallet: 0, instapay: 0 },
    expectedTotal: 1910,
    actualTotal: 1910,
    netTotal: 1910,
    varianceTotal: 0,
    expenses: {
      count: 1,
      total: 15,
      lines: [
        {
          id: 3,
          category: 'بوفيه',
          description: 'شاي للعمال',
          amount: 15,
          at: '2026-10-29 10:05:00',
          username: 'cashier'
        }
      ]
    },
    returns: {
      count: 2,
      total: 65,
      lines: [
        {
          saleId: 11,
          kindLabel: 'مرتجع جزئي',
          customer: 'عميل بدون اسم – فاتورة #11',
          items: [{ name: 'سكر', qty: 1, unit: 'كيلو' }],
          refund: 25,
          at: '2026-10-29 11:00:00',
          username: 'cashier'
        },
        {
          saleId: 12,
          kindLabel: 'مرتجع الفاتورة كاملة',
          customer: 'سعاد (C00001)',
          items: [{ name: 'شاي', qty: 1, unit: 'علبة' }],
          refund: 40,
          at: '2026-10-29 11:10:00',
          username: 'cashier'
        }
      ]
    },
    creditSales: {
      count: 1,
      total: 50,
      lines: [
        {
          saleId: 13,
          customer: 'سعاد (C00001)',
          total: 50,
          paidNow: 0,
          unpaid: 50,
          at: '2026-10-29 12:00:00'
        }
      ]
    },
    partialSales: {
      count: 1,
      total: 120,
      paidNow: 30,
      unpaid: 90,
      lines: [
        {
          saleId: 14,
          customer: 'سعاد (C00001)',
          total: 120,
          paidNow: 30,
          unpaid: 90,
          at: '2026-10-29 12:30:00'
        }
      ]
    },
    supplierInvoices: {
      purchases: {
        count: 3,
        total: 510,
        paid: 160,
        remaining: 350,
        lines: [
          {
            ref: 'S-0',
            supplier: 'مورد التفاصيل',
            total: 300,
            paid: 0,
            remaining: 300,
            status: 'آجل (لم يُدفع شيء)',
            at: '2026-10-29 13:00:00'
          },
          {
            ref: 'S-60',
            supplier: 'مورد التفاصيل',
            total: 60,
            paid: 60,
            remaining: 0,
            status: 'مدفوعة بالكامل',
            at: '2026-10-29 13:10:00'
          },
          {
            ref: 'S-100',
            supplier: 'مورد التفاصيل',
            total: 150,
            paid: 100,
            remaining: 50,
            status: 'دفع جزئي',
            at: '2026-10-29 13:20:00'
          }
        ]
      },
      preliminary: {
        count: 1,
        total: 400,
        paid: 0,
        remaining: 400,
        lines: [
          {
            ref: '#1',
            supplier: 'مورد التفاصيل',
            total: 400,
            paid: 0,
            remaining: 400,
            status: 'آجل (لم يُدفع شيء)',
            stateLabel: 'بانتظار الأصناف',
            at: '2026-10-29 14:00:00'
          }
        ]
      }
    },
    purchaseReturns: {
      count: 1,
      refund: 60,
      lines: [
        {
          ref: 'S-0',
          supplier: 'مورد التفاصيل',
          value: 60,
          credit: 60,
          refund: 60,
          items: [{ name: 'شاي', qty: 2, unit: 'علبة' }],
          at: '2026-10-29 15:00:00'
        }
      ]
    },
    supplierPayments: { withInvoices: 160, settlements: 0, requests: 40 },
    supplierRefunds: 60,
    collections: 0,
    events: {
      supplierPayments: {
        count: 1,
        total: 40,
        lines: [
          {
            id: 9,
            kind: 'supplier_payment_request',
            party: 'مورد التفاصيل',
            method: 'cash',
            amount: 40,
            at: '2026-10-29 16:00:00',
            username: 'cashier',
            refType: 'supplier_payment_request',
            refId: 1,
            requestStatusLabel: 'معتمد'
          }
        ]
      }
    },
    treasuryEntries: {
      count: 1,
      lines: [
        {
          kind: 'shift_close',
          label: 'توريد الوردية إلى الخزنة عند الإغلاق',
          method: 'cash',
          amount: 1910
        }
      ]
    }
  }
  const lines = buildCloseReportLines(rep, { store })
  for (const needle of [
    'S-0 مورد التفاصيل|300.00 ج.م',
    'مرتجع جزئي',
    'سكر × 1 كيلو',
    'فاتورة #13',
    'طلب سداد #1'
  ])
    assert.ok(
      lines.some((l) => l.includes(needle)),
      needle
    )
  const drawn = render(lines, ['-TemplateLayout'])
  if (/not valid/.test(drawn.out)) return t.skip('no printer at all on this machine')
  // A long report continues on the next page of the roll (the printer feeds it on).
  const pages = Number(drawn.out.match(/PREVIEW_DONE (\d+)/)?.[1])
  assert.ok(pages >= 1, drawn.out)
  const files = fs.readdirSync(drawn.dir).filter((f) => f.endsWith('.png'))
  assert.ok(files.length >= 1)
  if (process.env.HM_KEEP_PREVIEW)
    for (const f of files)
      fs.copyFileSync(path.join(drawn.dir, f), `${process.env.HM_KEEP_PREVIEW}-${f}`)
  fs.rmSync(drawn.dir, { recursive: true, force: true })
})
