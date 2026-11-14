// What a reloaded browser page shows (1.6.3): a valid session continues, a refused one goes to the
// sign-in screen, and a failure to ask is retried – never mistaken for "signed out".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumeWebSession } from '../../src/renderer/src/lib/sessionResume.js'

const answer = (r) => async (op) => {
  assert.equal(op, 'auth.session')
  return r
}

test('a valid session continues with the sign-in answer', async () => {
  const data = { user: { id: 1, username: 'owner', permissions: [] }, openShift: null }
  assert.deepEqual(await resumeWebSession(answer({ status: 200, data })), data)
})

test('no session, expired, revoked or no internet access: the sign-in screen', async () => {
  for (const status of [401, 403])
    assert.equal(
      await resumeWebSession(answer({ status, error: { code: 'unauthorized', message: 'x' } })),
      null
    )
})

test('the service could not be asked: retried as a start-up failure, not signed out', async () => {
  for (const r of [
    { status: 503, error: { code: 'server_unreachable', message: 'تعذر الاتصال' } },
    { status: 500, error: { code: 'error', message: 'x' } },
    { status: 200, data: null },
    null
  ])
    await assert.rejects(resumeWebSession(answer(r)), (e) => e.status === 503)
})
