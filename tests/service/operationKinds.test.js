'use strict'
// Every service operation has a declared kind for the internet way in (D-101), so a new operation
// that changes data can never be answered from the cloud's copy by mistake, and nothing the cloud
// carries to the shop is a read. No database is needed: the registry is the service's own.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createService } = require('../../src/server/app')
const {
  KINDS,
  kindOf,
  cloudRoute,
  withoutSecrets
} = require('../../src/server/sync/operationKinds')

const service = (role) =>
  createService({
    databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none',
    secret: 'x'.repeat(40),
    logger: false,
    role
  })

test('every operation that changes data is declared; nothing declared is missing from the service', async () => {
  const svc = await service('store')
  try {
    const names = [...svc.operations.keys()]
    const changes = (o) =>
      /ctx\.tx\(|\b(INSERT INTO|UPDATE |DELETE FROM)\b/.test(o.handler.toString())
    // Reads that open a transaction only to lock or to read consistently.
    const READS_IN_A_TRANSACTION = new Set(['pos.checkoutStatus'])
    const undeclared = [...svc.operations.values()]
      .filter((o) => changes(o) && kindOf(o.name) === 'read' && !READS_IN_A_TRANSACTION.has(o.name))
      .map((o) => o.name)
    assert.deepEqual(undeclared, [], 'declare these in src/server/sync/operationKinds.js')
    assert.deepEqual(
      Object.keys(KINDS).filter((k) => !names.includes(k)),
      [],
      'declared but not an operation'
    )
    const by = (route) => names.filter((x) => cloudRoute(x) === route).length
    assert.equal(names.length, 165)
    // 79 reads + sign-in and sign-out are answered by the cloud itself; 12 belong to the shop PC;
    // the other 71 are carried out in the shop by their own handler.
    assert.deepEqual([by('local'), by('refused'), by('shop')], [81, 12, 72])
  } finally {
    await svc.app.close()
  }
})

test('the cloud has the same operations, minus the link settings, plus its view of the link', async () => {
  const shop = await service('store')
  const cloud = await service('cloud')
  try {
    const a = [...shop.operations.keys()]
    const b = [...cloud.operations.keys()]
    assert.deepEqual(
      a.filter((x) => !b.includes(x)),
      [
        'sync.status',
        'sync.configure',
        'sync.pair',
        'sync.unlink',
        'sync.runNow',
        'sync.recover',
        'sync.skipRecovery'
      ]
    )
    assert.deepEqual(
      b.filter((x) => !a.includes(x)),
      ['link.state', 'link.watch', 'link.operation', 'link.operations']
    )
    // Asked by every screen on both sides; each side answers for itself.
    assert.notEqual(
      cloud.operations.get('sync.state').handler,
      shop.operations.get('sync.state').handler
    )
    // The same permission on every shared operation: one definition, two ways in.
    for (const name of a.filter((x) => b.includes(x) && x !== 'sync.state'))
      assert.deepEqual(
        [cloud.operations.get(name).permission, cloud.operations.get(name).anyPermission],
        [shop.operations.get(name).permission, shop.operations.get(name).anyPermission],
        name
      )
  } finally {
    await shop.app.close()
    await cloud.app.close()
  }
})

test('answers are stored without what is shown only once', () => {
  assert.deepEqual(
    withoutSecrets({ id: 4, temporaryPassword: 'AB12-CD34-56', user: { token: 't', name: 'x' } }),
    { id: 4, temporaryPassword: '[shown once]', user: { token: '[shown once]', name: 'x' } }
  )
  assert.equal(withoutSecrets(null), null)
})
