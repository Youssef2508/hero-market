'use strict'
// Who is signed out automatically (owner, 1.5.1, D-083): a successful shift close signs out every
// user except the administrators («مدير النظام», «مدير المتجر»); the service answers it with the
// close (signOut), and the screen follows that answer. Nothing else signs out: a return (approved,
// refused, with a wrong supervisor password, of a whole invoice) or a close that fails leaves the
// session as it was.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const {
  requireDb,
  freshDatabase,
  startService,
  createUser,
  login,
  seedProducts,
  passwordFor
} = require('./helpers')
const { signOutAfterClose, ADMINS } = require('../../src/server/auth/shiftRule')

let db, svc
const token = {}
const ok = (r, what = '') => {
  assert.equal(r.status, 200, `${what} ${JSON.stringify(r.body)}`)
  return r.body
}
const sessionAlive = async (who) => (await svc.call('auth.me', {}, token[who])).status === 200
const openShift = async (who) =>
  ok(await svc.call('shifts.open', { startingCash: 0 }, token[who]), `open ${who}`)
const sell = async (who, shiftId, qty = 2) =>
  ok(
    await svc.call(
      'pos.checkout',
      {
        clientRef: crypto.randomUUID(),
        shiftId,
        paymentType: 'نقدي',
        items: [{ barcode: 'S1', qty }]
      },
      token[who]
    ),
    'sale'
  ).saleId
const close = (who, shiftId, clientRef = crypto.randomUUID()) =>
  svc.call('shifts.close', { shiftId, actualCash: 0, clientRef }, token[who])

before(async () => {
  if (!process.env.HEROMARKET_TEST_DATABASE_URL) return
  db = await freshDatabase()
  svc = await startService(db.url)
  const users = [
    ['owner', '8642', 'super_admin'],
    ['storeadmin', '8643', 'store_admin'],
    ['manager', '9517', 'manager'],
    ['cashier', '5173', 'cashier'],
    ['cashier2', '5174', 'cashier']
  ]
  for (const [username, pin, roleKey] of users) await createUser(svc, { username, pin, roleKey })
  await seedProducts(
    svc,
    "INSERT INTO products (barcode, name, retail_price, stock_qty, unit) VALUES ('S1', 'صنف', 10, 500, 'قطعة')"
  )
  for (const [username, pin] of users) token[username] = await login(svc, pin)
})

after(async () => {
  if (svc) await svc.close()
  if (db) await db.dispose()
})

test('the rule: administrators keep their session, every other role is signed out', () => {
  assert.deepEqual(ADMINS, ['super_admin', 'store_admin'])
  assert.equal(signOutAfterClose({ roleKey: 'super_admin' }), false)
  assert.equal(signOutAfterClose({ roleKey: 'store_admin' }), false)
  for (const roleKey of ['manager', 'cashier', 'inventory', 'auditor', null])
    assert.equal(signOutAfterClose({ roleKey }), true, String(roleKey))
  // A role made by the owner (no key) is not an administrator role.
  assert.equal(signOutAfterClose({ roleKey: null, roleId: 99 }), true)
})

test('returns never sign the cashier out: approved, refused, wrong password, whole invoice', async (t) => {
  if (!requireDb(t)) return
  const shift = await openShift('cashier')
  const saleId = await sell('cashier', shift.id, 3)
  const item = (await svc.pool.query('SELECT id FROM sale_items WHERE sale_id = $1', [saleId]))
    .rows[0].id
  const req = (extra) =>
    svc.call(
      'sales.returnItem',
      { saleItemId: item, quantity: 1, reason: 'عبوة تالفة', currentShiftId: shift.id, ...extra },
      token.cashier
    )
  const wrong = await req({ approver: { username: 'manager', password: 'not-the-password-1' } })
  assert.equal(wrong.status, 403)
  assert.ok(await sessionAlive('cashier'), 'after a wrong supervisor password')
  const refused = await req({
    approver: { username: 'manager', password: passwordFor('9517'), decision: 'refuse' }
  })
  assert.equal(refused.status, 403)
  assert.ok(await sessionAlive('cashier'), 'after the supervisor refused')
  const done = ok(await req({ approver: { username: 'manager', password: passwordFor('9517') } }))
  assert.equal(done.signOut, undefined, 'a return carries no sign-out')
  assert.ok(await sessionAlive('cashier'), 'after an approved return')
  ok(
    await svc.call(
      'sales.returnEntire',
      {
        saleId,
        reason: 'إلغاء الفاتورة',
        currentShiftId: shift.id,
        approver: { username: 'manager', password: passwordFor('9517') }
      },
      token.cashier
    )
  )
  assert.ok(await sessionAlive('cashier'), 'after returning the whole invoice')
  // Through the return lookup by number, as the till and the «المرتجعات» screen do.
  ok(await svc.call('sales.lookup', { saleId, action: 'return' }, token.cashier))
  assert.ok(await sessionAlive('cashier'))
  // The cashier's shift is still open after all of it.
  assert.equal(
    (await svc.pool.query('SELECT status FROM shifts WHERE id = $1', [shift.id])).rows[0].status,
    'open'
  )
})

test('a cashier and a supervisor: a successful close answers signOut, also on a retry', async (t) => {
  if (!requireDb(t)) return
  const cashierShift = (
    await svc.pool.query(
      "SELECT id FROM shifts WHERE status = 'open' AND user_id = (SELECT id FROM users WHERE username = 'cashier')"
    )
  ).rows[0]
  const ref = crypto.randomUUID()
  const closed = ok(await close('cashier', cashierShift.id, ref), 'cashier close')
  assert.equal(closed.signOut, true)
  // The same close sent again (a retry): the saved close, with the same answer.
  const retry = ok(await close('cashier', cashierShift.id, ref), 'retry')
  assert.equal(retry.duplicate, true)
  assert.equal(retry.signOut, true)
  const mShift = await openShift('manager')
  await sell('manager', mShift.id)
  assert.equal(ok(await close('manager', mShift.id), 'manager close').signOut, true)
})

test('a close that fails carries no sign-out and leaves the session as it was', async (t) => {
  if (!requireDb(t)) return
  const shift = await openShift('cashier2')
  // Another cashier may not close it.
  const foreign = await close('cashier', shift.id)
  assert.notEqual(foreign.status, 200)
  assert.equal(foreign.body.signOut, undefined)
  // Invalid amounts: refused before anything is saved.
  const invalid = await svc.call(
    'shifts.close',
    { shiftId: shift.id, actualCash: -5, clientRef: crypto.randomUUID() },
    token.cashier2
  )
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.signOut, undefined)
  assert.ok(await sessionAlive('cashier2'), 'the cashier is still signed in')
  assert.equal(
    (await svc.pool.query('SELECT status FROM shifts WHERE id = $1', [shift.id])).rows[0].status,
    'open',
    'the shift is still open'
  )
  // A shift already closed (without the request id of its close): refused, no sign-out.
  ok(await close('cashier2', shift.id))
  const again = await close('cashier2', shift.id)
  assert.equal(again.status, 409)
  assert.equal(again.body.signOut, undefined)
})

test('administrators: a successful close never signs them out', async (t) => {
  if (!requireDb(t)) return
  for (const who of ['owner', 'storeadmin']) {
    const shift = await openShift(who)
    await sell(who, shift.id)
    const closed = ok(await close(who, shift.id), `${who} close`)
    assert.equal(closed.signOut, false, who)
    assert.ok(await sessionAlive(who), `${who} stays signed in`)
    // And can open the next shift right away, in the same session.
    const next = await openShift(who)
    assert.equal(ok(await close(who, next.id)).signOut, false)
  }
})
