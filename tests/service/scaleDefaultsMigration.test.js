'use strict'
// Migration 0024 (scale-label defaults, D-084): saved settings that are still exactly the previous
// defaults get the new code positions (offset 1, 6 digits); anything the owner changed stays; the
// owner's label reads the same product and weight before and after.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { requireDb, freshDatabase } = require('./helpers')
const { createPool } = require('../../src/server/db/pool')
const { migrate, listMigrations } = require('../../src/server/db/migrate')
const { parseScaleLabel } = require('../../src/server/inventory/units')

const quiet = { info() {} }
const OLD_DEFAULTS = {
  enabled: true,
  length: 13,
  codeStart: 2,
  codeLength: 5,
  valueStart: 7,
  valueLength: 5,
  weightDivisor: 1000,
  priceDivisor: 100,
  prefixes: { 20: 'weight', 21: 'weight', 22: 'price', 25: 'weight' },
  checkDigit: 'ean13'
}

async function upTo23(stored) {
  const fresh = await freshDatabase()
  const pool = createPool(fresh.url, { max: 2 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-mig24-'))
  for (const m of listMigrations().filter((x) => Number(x.version) <= 23))
    fs.copyFileSync(
      path.join(__dirname, '../../src/server/db/migrations', `${m.name}.sql`),
      path.join(tmp, `${m.name}.sql`)
    )
  await migrate(pool, { dir: tmp, logger: quiet })
  if (stored !== undefined)
    await pool.query("INSERT INTO settings (key, value) VALUES ('scale_labels', $1)", [stored])
  return { fresh, pool }
}
const saved = async (pool) =>
  (await pool.query("SELECT value FROM settings WHERE key = 'scale_labels'")).rows[0]?.value

test('0024: the previous defaults move to the new positions; the label reads the same', async (t) => {
  if (!requireDb(t)) return
  const { fresh, pool } = await upTo23(JSON.stringify(OLD_DEFAULTS))
  try {
    const before = parseScaleLabel(OLD_DEFAULTS, '2000001001257')
    await migrate(pool, { logger: quiet })
    const now = JSON.parse(await saved(pool))
    assert.deepEqual([now.codeStart, now.codeLength], [1, 6])
    // Everything else the store saved is kept (prefixes, enabled, check digit, value positions).
    assert.deepEqual({ ...now, codeStart: 2, codeLength: 5 }, OLD_DEFAULTS)
    const after = parseScaleLabel(now, '2000001001257')
    assert.deepEqual([after.fullCode, after.value], [before.fullCode, before.value])
    assert.deepEqual([after.fullCode, after.value], ['2000001', 0.125])
  } finally {
    await pool.end()
    await fresh.dispose()
  }
})

test('0024: settings the owner changed, unreadable settings and no settings are left alone', async (t) => {
  if (!requireDb(t)) return
  const custom = JSON.stringify({ ...OLD_DEFAULTS, codeStart: 2, codeLength: 4 })
  for (const stored of [custom, '{not json', undefined]) {
    const { fresh, pool } = await upTo23(stored)
    try {
      await migrate(pool, { logger: quiet })
      assert.equal(await saved(pool), stored, String(stored))
    } finally {
      await pool.end()
      await fresh.dispose()
    }
  }
})
