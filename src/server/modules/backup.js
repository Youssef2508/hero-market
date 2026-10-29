'use strict'
// Logical backup/restore of the whole HeroMarket database through the service (works for a standalone
// till and for a central server). Values are exported as PostgreSQL text so nothing is rounded or
// re-zoned. Restore is all-or-nothing and only accepts a backup made with the same schema version.
// Server administrators should additionally schedule pg_dump (see .docs/DATABASE_ARCHITECTURE.md).
const { badRequest } = require('../errors')
const { listMigrations } = require('../db/migrate')

// FK-safe insert order; deletes run in reverse. Sessions are not backed up (everyone logs in again).
const TABLES = [
  'roles',
  'role_permissions',
  'permission_catalog',
  'users',
  'categories',
  'measure_kinds',
  'products',
  'product_units',
  'product_barcodes',
  'stock_movements',
  'discount_rules',
  'clients',
  'client_addresses',
  'client_ledger',
  'approvals',
  'shifts',
  'treasury_ledger',
  'shift_closings',
  'sales',
  'sale_items',
  'sale_item_cost_backfill',
  'sale_discounts',
  'sale_returns',
  'suppliers',
  'supplier_ledger',
  'supplier_purchases',
  'supplier_purchase_items',
  'product_cost_migration',
  'supplier_pending_invoices',
  'supplier_purchase_returns',
  'supplier_purchase_return_items',
  'checks_register',
  'expense_categories',
  'expenses',
  'damaged_goods',
  'settings',
  'shift_audits',
  'system_logs',
  'momkn_transactions',
  'mobile_money_transactions',
  'safe_ledger',
  'supplier_payment_requests',
  'sale_payment_corrections',
  'receipt_templates'
]
// User triggers are off while rows are restored: restored movements must not be applied to stock
// a second time, and restored stock is not a direct write (stock_movements, products guard).
const TRIGGER_TABLES = ['products', 'stock_movements', 'sales', 'shifts']
const FORMAT = 'heromarket-backup'

async function columnsOf(db, table) {
  const { rows } = await db.query(
    `SELECT column_name, data_type, is_identity, identity_generation FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  )
  return rows
}

async function schemaVersion(db) {
  return (await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
    (r) => r.version
  )
}

async function exportAll(db) {
  const out = {
    format: FORMAT,
    version: 1,
    createdAt: new Date().toISOString(),
    schema: await schemaVersion(db),
    tables: {},
    sequences: {},
    // Where synchronisation stood (D-047): a restore starts a new epoch from this point.
    sync: (
      await db.query(
        `SELECT s.store_id AS "storeId", s.epoch,
                (SELECT COALESCE(max(version), 0) FROM sync_row_versions)::text AS version
           FROM sync_state s`
      )
    ).rows[0]
  }
  for (const t of TABLES) {
    const cols = await columnsOf(db, t)
    const names = cols.map((c) => c.column_name)
    const pk = names.includes('id') ? 'id' : names[0]
    const rows = (
      await db.query(
        `SELECT ${names.map((n) => `"${n}"::text AS "${n}"`).join(', ')} FROM "${t}" ORDER BY "${pk}"`
      )
    ).rows
    out.tables[t] = { columns: names, rows: rows.map((r) => names.map((n) => r[n])) }
    if (names.includes('id')) {
      const seq = (await db.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [t])).rows[0].s
      if (seq) {
        const v = (await db.query(`SELECT last_value, is_called FROM ${seq}`)).rows[0]
        out.sequences[t] = { last: Number(v.last_value), called: v.is_called }
      }
    }
  }
  return out
}

/**
 * The whole database as one consistent copy: every table is read in one read-only REPEATABLE READ
 * transaction, so a sale committing meanwhile is either entirely in the copy or not at all (before
 * 1.5.0 each table was read on any free connection). Reading never blocks the tills.
 */
async function exportSnapshot(pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const data = await exportAll(client)
    await client.query('COMMIT')
    return data
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

module.exports = function backupModule(app) {
  app.operation({
    name: 'backup.export',
    permission: 'backup.manage',
    handler: async (ctx) => {
      const data = await exportSnapshot(ctx.pool)
      await ctx.audit(ctx.pool, 'database_backup', 'أخذ نسخة احتياطية من قاعدة البيانات')
      return data
    }
  })

  app.operation({
    name: 'backup.restore',
    permission: 'backup.manage',
    bodyLimit: 512 * 1024 * 1024,
    schema: {
      type: 'object',
      required: ['backup', 'confirm'],
      properties: { backup: { type: 'object' }, confirm: { const: 'RESTORE' } }
    },
    handler: async (ctx, { backup }) => {
      if (backup.format !== FORMAT || backup.version !== 1 || !backup.tables)
        throw badRequest('الملف المختار ليس نسخة احتياطية صالحة من HeroMarket.')
      const current = listMigrations().map((m) => m.version)
      if (JSON.stringify(backup.schema) !== JSON.stringify(current)) {
        throw badRequest(
          `النسخة الاحتياطية من إصدار قاعدة بيانات مختلف (${(backup.schema || []).join(',')}) عن الحالي (${current.join(',')}).`
        )
      }
      const actor = ctx.user
      const result = await ctx.tx(async (db) => {
        // Rows rewritten by the restore are not queued one by one: synchronisation restarts below.
        await db.query("SELECT set_config('hm.sync_capture', 'off', true)")
        // Restored history includes closed shifts and their money movements (migration 0011).
        await db.query("SELECT set_config('hm.bulk_load', 'on', true)")
        const counts = {}
        for (const t of TRIGGER_TABLES) await db.query(`ALTER TABLE "${t}" DISABLE TRIGGER USER`)
        await db.query('DELETE FROM sessions')
        for (const t of [...TABLES].reverse()) await db.query(`DELETE FROM "${t}"`)
        for (const t of TABLES) {
          const data = backup.tables[t]
          if (!data) throw badRequest(`النسخة الاحتياطية لا تحتوي على الجدول ${t}.`)
          const cols = await columnsOf(db, t)
          const types = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]))
          for (const name of data.columns)
            if (!(name in types)) throw badRequest(`عمود غير معروف ${t}.${name}`)
          const castOf = (n) => {
            const ty = types[n]
            if (ty === 'timestamp without time zone') return 'timestamp'
            if (ty === 'USER-DEFINED' || ty === 'ARRAY') return 'text'
            return ty
          }
          for (let i = 0; i < data.rows.length; i += 200) {
            const chunk = data.rows.slice(i, i + 200)
            const params = []
            const tuples = chunk.map(
              (row) =>
                `(${row.map((v, j) => (params.push(v), `$${params.length}::${castOf(data.columns[j])}`)).join(', ')})`
            )
            await db.query(
              `INSERT INTO "${t}" (${data.columns.map((c) => `"${c}"`).join(', ')}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(', ')}`,
              params
            )
          }
          counts[t] = data.rows.length
          const seq = backup.sequences?.[t]
          if (seq) {
            const s = (await db.query(`SELECT pg_get_serial_sequence($1, 'id') AS s`, [t])).rows[0]
              .s
            await db.query('SELECT setval($1, $2, $3)', [s, seq.last, seq.called])
          }
        }
        for (const t of TRIGGER_TABLES) await db.query(`ALTER TABLE "${t}" ENABLE TRIGGER USER`)
        // Synchronisation continues in a new epoch: the restored state is sent again in full, and
        // the cloud stops accepting changes from the database that was replaced (D-047).
        await db.query('DELETE FROM sync_outbox')
        await db.query('DELETE FROM sync_row_versions')
        // A store linked to the cloud first writes back what reached the cloud after this backup;
        // writes pause until then (or until an administrator skips it).
        await db.query(
          `UPDATE sync_state SET epoch = NULL, recover_from = $1,
                  recovery_pending = (enabled AND cloud_url IS NOT NULL AND device_token IS NOT NULL)`,
          [JSON.stringify({ backupCreatedAt: backup.createdAt, sync: backup.sync || null })]
        )
        await db.query(
          `INSERT INTO system_logs (timestamp, user_id, username, action_type, description, details)
           VALUES (LOCALTIMESTAMP(0), NULL, $1, 'database_restore', $2, $3)`,
          [
            actor.username,
            `استعادة نسخة احتياطية بتاريخ ${backup.createdAt}`,
            JSON.stringify(counts)
          ]
        )
        return { restored: counts, createdAt: backup.createdAt }
      })
      if (app.refreshSyncFlags) await app.refreshSyncFlags()
      return result
    }
  })
}

module.exports.exportAll = exportAll
module.exports.exportSnapshot = exportSnapshot
module.exports.TABLES = TABLES
module.exports.TRIGGER_TABLES = TRIGGER_TABLES
