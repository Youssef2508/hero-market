'use strict'
// QA campaign 1.8.0 – a targeted mutation sample. Each mutant is a small, realistic bug in a
// critical rule; the tests named with it must fail ("killed"). A surviving mutant is a gap in the
// tests. Every file is restored after its mutant, also when the run is interrupted.
//   node scripts/qa/mutation-sample.js   (HEROMARKET_TEST_DATABASE_URL, or npm run pg:dev)
process.env.HEROMARKET_TEST_DATABASE_URL ||= require('../pg-dev').url('postgres')
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
// [name, file, the text, the mutated text, the tests that must catch it]
const MUTANTS = [
  [
    'exact code first',
    'src/server/modules/pos.js',
    'ORDER BY s.n, (p.barcode = s.code) DESC',
    'ORDER BY (p.barcode = s.code) DESC',
    ['tests/service/productCodes.test.js']
  ],
  [
    'UPC-A spelling rule',
    'src/server/modules/pos.js',
    'if (/^\\d{12}$/.test(raw)) return [raw, `0${raw}`]',
    'if (/^\\d{1,12}$/.test(raw)) return [raw, `0${raw}`]',
    ['tests/service/productCodes.test.js']
  ],
  [
    'correction moves the payable by the difference',
    'src/server/modules/purchaseRevisions.js',
    'const delta = round2(net - oldNet)',
    'const delta = round2(net - paid)',
    ['tests/service/purchaseRevisions.test.js']
  ],
  [
    'correction checks the revision',
    'src/server/modules/purchaseRevisions.js',
    'if (Number(b.expectedRevision) !== Number(purchase.revision))',
    'if (false)',
    ['tests/service/purchaseRevisions.test.js']
  ],
  [
    'correction stock difference',
    'src/server/modules/purchaseRevisions.js',
    'const change = roundQty(p.newBase - p.oldBase)',
    'const change = roundQty(p.newBase)',
    ['tests/service/purchaseRevisions.test.js']
  ],
  [
    'returns limit a correction',
    'src/server/modules/purchaseRevisions.js',
    'if (qty + 0.0005 < was.returned)',
    'if (qty + 0.0005 < 0)',
    ['tests/service/purchaseRevisions.test.js']
  ],
  [
    'only sign-ins set the cookie',
    'src/server/app.js',
    'if (SESSION_OPERATIONS.has(def.name) && result?.token) {',
    'if (result?.token) {',
    ['tests/service/cloudOwnerOffline.test.js']
  ],
  [
    'linked operations deferred offline',
    'src/server/app.js',
    "if (kindOf(def.name) === 'linked') {\n            reply.code(202)",
    'if (false) {\n            reply.code(202)',
    ['tests/service/cloudOwnerOffline.test.js']
  ],
  [
    'password rule follows internet access',
    'src/server/auth/access.js',
    "permissions.includes('internet.access') ? 'strong' : 'simple'",
    "'simple'",
    ['tests/service/passwordPolicy.test.js']
  ],
  [
    'granting internet needs a strong password',
    'src/server/modules/admin.js',
    "if (weak.length) throw conflict(weakMessage(weak), { code: 'weak_password_for_internet' })",
    'void weak',
    ['tests/service/passwordPolicy.test.js']
  ],
  [
    'reservation blocks another user',
    'src/server/money/reservations.js',
    '  if (row.active && row.reserved_by !== ctx.user.id)\n    throw conflict(k.busy(row.reserved_by_name, hhmm(row.until_text)), {',
    '  if (false)\n    throw conflict(k.busy(row.reserved_by_name, hhmm(row.until_text)), {',
    ['tests/service/reservations.test.js']
  ],
  [
    'approval pays the balance once',
    'src/server/modules/supplierPayments.js',
    "if (r.status === 'approved') return { request: withLabels(r), duplicate: true }",
    'if (false) return { request: withLabels(r), duplicate: true }',
    ['tests/service/supplierPaymentRequests.test.js']
  ],
  [
    'cancellation enters the returned payment (QA-03)',
    'src/server/modules/supplierInvoices.js',
    '-paid,\n            `إلغاء ${label}: المدفوع ${paid.toFixed(2)} أعاده المورد`',
    '0,\n            `إلغاء ${label}: المدفوع ${paid.toFixed(2)} أعاده المورد`',
    ['tests/service/supplierLedgerRepair.test.js']
  ],
  [
    'connectivity: healthy threshold',
    'src/server/cloud/link.js',
    ': now - last > healthyMs',
    ': now - last > healthyMs * 1000',
    ['tests/service/linkConnectivity.test.js']
  ],
  [
    'connectivity: a dead request is not contact (QA-02)',
    'src/server/cloud/link.js',
    '        if (gone) {\n          live.lastContact = 0\n          changed()\n        }',
    '        if (gone) {\n          live.lastContact = 0\n          changed()\n        } else live.lastContact = Date.now()',
    ['tests/service/linkConnectivity.test.js']
  ],
  [
    'impossible dates refused (QA-01)',
    'src/server/errors.js',
    "    case '22008':\n      return badRequest('تاريخ غير صالح.')",
    "    case '22008':\n      return null",
    ['tests/service/apiHardening.test.js']
  ],
  [
    'an unknown product at checkout',
    'src/server/modules/pos.js',
    'throw notFound(`الصنف (${i.barcode}) غير مسجل في قاعدة البيانات!`)',
    'continue',
    ['tests/service/checkout.test.js']
  ]
]

const results = []
for (const [name, file, from, to, tests] of MUTANTS) {
  const p = path.join(ROOT, file)
  const original = fs.readFileSync(p, 'utf8')
  if (!original.includes(from)) {
    results.push({ name, outcome: 'not applied (the line changed)' })
    console.log(`? ${name}: the line to mutate was not found`)
    continue
  }
  const restore = () => fs.writeFileSync(p, original)
  process.once('SIGINT', restore)
  try {
    fs.writeFileSync(p, original.replace(from, to))
    const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 15 * 60 * 1000
    })
    const failed = /ℹ fail [1-9]/.test(r.stdout) || r.status !== 0
    results.push({ name, file, outcome: failed ? 'killed' : 'SURVIVED', tests })
    console.log(`${failed ? '✔ killed' : '✖ SURVIVED'} ${name}`)
  } finally {
    restore()
    process.removeListener('SIGINT', restore)
  }
}
const survived = results.filter((r) => r.outcome === 'SURVIVED')
fs.writeFileSync(
  path.join(ROOT, 'scripts', 'qa', 'mutation-results.json'),
  JSON.stringify(results, null, 1)
)
console.log(
  `\n${results.filter((r) => r.outcome === 'killed').length}/${results.length} killed, ${survived.length} survived`
)
process.exit(survived.length || results.some((r) => r.outcome !== 'killed') ? 1 : 0)
