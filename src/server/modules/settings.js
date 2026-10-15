'use strict'
// Store-wide settings and receipt templates. Machine-specific settings (printer override, server
// address, terminal name) live in the terminal's local config, not here (see .docs/ARCHITECTURE.md).
const path = require('path')
const { pathToFileURL } = require('url')
const { badRequest, conflict, notFound } = require('../errors')
const { DEFAULT_SCALE, normalizeScaleLabels } = require('../inventory/units')

let receiptLib = null
async function receipt() {
  // Shared ESM module (also used by the printer and the designer preview).
  if (!receiptLib)
    receiptLib = await import(
      pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'receipt.mjs')).href
    )
  return receiptLib
}

// key → { default, validate(value) → normalised string, public }
const SETTINGS = {
  store_name: { default: 'هيرو ماركت', type: 'text', max: 60, public: true },
  branch_name: { default: 'الفرع الرئيسي', type: 'text', max: 60, public: true },
  store_address: { default: '', type: 'text', max: 120, public: true, optional: true },
  store_phone: { default: '', type: 'text', max: 30, public: true, optional: true },
  store_logo: { default: '', type: 'image', public: true, optional: true },
  printer_name: { default: 'CITIZEN CT-S300', type: 'text', max: 80, public: true },
  default_opening_cash: { default: '200', type: 'number', min: 0, max: 1000000, public: true },
  audit_enabled: { default: 'true', type: 'bool', public: true },
  audit_interval_minutes: { default: '60', type: 'number', min: 10, max: 720, public: true },
  audit_idle_seconds: { default: '20', type: 'number', min: 5, max: 600, public: true },
  print_receipt_default: { default: 'true', type: 'bool', public: true },
  receipt_paper: { default: '80mm', type: 'enum', values: ['80mm', '58mm'], public: true },
  // Scale labels: which prefixes carry a weight or a price, and where the code and value sit.
  scale_labels: {
    default: JSON.stringify(DEFAULT_SCALE),
    type: 'json',
    validate: normalizeScaleLabels,
    public: true
  }
}

function normalise(key, raw) {
  const def = SETTINGS[key]
  if (!def) throw badRequest(`إعداد غير معروف: ${key}`)
  if (def.type === 'json') return def.validate(raw)
  const v = raw === null || raw === undefined ? '' : String(raw).trim()
  switch (def.type) {
    case 'text':
      if (!v && !def.optional) throw badRequest('هذا الحقل مطلوب.')
      if (v.length > def.max) throw badRequest(`الحد الأقصى ${def.max} حرفاً.`)
      if (/[|~<>]/.test(v)) throw badRequest('لا يُسمح بالرموز | ~ < > في هذا الحقل.')
      return v
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n) || n < def.min || n > def.max)
        throw badRequest(`القيمة يجب أن تكون بين ${def.min} و ${def.max}.`)
      return String(n)
    }
    case 'bool':
      if (!['true', 'false'].includes(v)) throw badRequest('قيمة غير صالحة.')
      return v
    case 'enum':
      if (!def.values.includes(v)) throw badRequest('قيمة غير صالحة.')
      return v
    case 'image':
      if (!v) return ''
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v))
        throw badRequest('الشعار يجب أن يكون صورة PNG.')
      if (v.length > 300 * 1024) throw badRequest('حجم الشعار يجب ألا يزيد عن 200 كيلوبايت.')
      return v
    default:
      return v
  }
}

async function readAll(db) {
  const { rows } = await db.query('SELECT key, value FROM settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, d]) => [k, stored[k] ?? d.default]))
}

async function activeTemplates(db) {
  const { rows } = await db.query(
    'SELECT id, name, paper, config FROM receipt_templates WHERE is_active'
  )
  const lib = await receipt()
  const byPaper = {}
  for (const r of rows)
    byPaper[r.paper] = {
      id: r.id,
      name: r.name,
      paper: r.paper,
      config: lib.normalizeTemplate(r.config).value
    }
  if (!byPaper['80mm'])
    byPaper['80mm'] = {
      id: null,
      name: 'افتراضي',
      paper: '80mm',
      config: lib.defaultTemplate('80mm')
    }
  return byPaper
}

const templateSchema = {
  type: 'object',
  required: ['name', 'config'],
  properties: {
    id: { type: ['integer', 'null'] },
    name: { type: 'string', minLength: 2, maxLength: 60 },
    config: { type: 'object' }
  }
}

module.exports = function settingsModule(app) {
  // Everything a terminal needs to run (store profile, checkout/audit behaviour, active receipt templates).
  app.operation({
    name: 'settings.public',
    handler: async (ctx) => {
      const all = await readAll(ctx.pool)
      const pub = Object.fromEntries(Object.entries(all).filter(([k]) => SETTINGS[k].public))
      return { settings: pub, receiptTemplates: await activeTemplates(ctx.pool) }
    }
  })

  app.operation({
    name: 'settings.get',
    permission: 'settings.manage',
    handler: async (ctx) => ({ settings: await readAll(ctx.pool), definitions: SETTINGS })
  })

  app.operation({
    name: 'settings.update',
    permission: 'settings.manage',
    schema: { type: 'object', required: ['values'], properties: { values: { type: 'object' } } },
    handler: async (ctx, { values }) =>
      ctx.tx(async (db) => {
        const before = await readAll(db)
        const changes = {}
        for (const [k, raw] of Object.entries(values)) {
          const v = normalise(k, raw)
          if (v === before[k]) continue
          await db.query(
            'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [k, v]
          )
          changes[k] = k === 'store_logo' ? { changed: true } : { from: before[k], to: v }
        }
        if (Object.keys(changes).length)
          await ctx.audit(
            db,
            'settings_update',
            `تعديل إعدادات المتجر (${Object.keys(changes).length})`,
            changes
          )
        return { settings: await readAll(db), changed: Object.keys(changes) }
      })
  })

  // ── Receipt templates ──────────────────────────────────────
  app.operation({
    name: 'receipts.list',
    permission: 'settings.manage',
    handler: async (ctx) => {
      const lib = await receipt()
      const rows = (await ctx.pool.query('SELECT * FROM receipt_templates ORDER BY paper, name'))
        .rows
      return {
        templates: rows.map((r) => ({ ...r, config: lib.normalizeTemplate(r.config).value })),
        defaults: {
          '58mm': lib.defaultTemplate('58mm'),
          '80mm': lib.defaultTemplate('80mm'),
          A4: lib.defaultTemplate('A4')
        }
      }
    }
  })

  app.operation({
    name: 'receipts.save',
    permission: 'settings.manage',
    schema: templateSchema,
    handler: async (ctx, { id, name, config }) => {
      const lib = await receipt()
      const n = lib.normalizeTemplate(config)
      if (!n.ok) throw badRequest(n.errors.join(' '))
      return ctx.tx(async (db) => {
        let row
        if (id) {
          row = (
            await db.query(
              'UPDATE receipt_templates SET name = $1, paper = $2, config = $3, updated_at = LOCALTIMESTAMP(0) WHERE id = $4 RETURNING *',
              [name.trim(), n.value.paper, JSON.stringify(n.value), id]
            )
          ).rows[0]
          if (!row) throw notFound('القالب غير موجود.')
        } else {
          row = (
            await db.query(
              'INSERT INTO receipt_templates (name, paper, config, is_active) VALUES ($1, $2, $3, false) RETURNING *',
              [name.trim(), n.value.paper, JSON.stringify(n.value)]
            )
          ).rows[0]
        }
        await ctx.audit(
          db,
          'receipt_template_save',
          `حفظ قالب الفاتورة "${row.name}" (${row.paper})`
        )
        return row
      })
    }
  })

  app.operation({
    name: 'receipts.activate',
    permission: 'settings.manage',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const t = (await db.query('SELECT * FROM receipt_templates WHERE id = $1 FOR UPDATE', [id]))
          .rows[0]
        if (!t) throw notFound('القالب غير موجود.')
        await db.query(
          'UPDATE receipt_templates SET is_active = false WHERE paper = $1 AND is_active',
          [t.paper]
        )
        await db.query('UPDATE receipt_templates SET is_active = true WHERE id = $1', [id])
        await ctx.audit(
          db,
          'receipt_template_activate',
          `اعتماد قالب الفاتورة "${t.name}" لورق ${t.paper}`
        )
      })
  })

  // Return to the built-in default for a paper size (no active custom template).
  app.operation({
    name: 'receipts.restoreDefault',
    permission: 'settings.manage',
    schema: {
      type: 'object',
      required: ['paper'],
      properties: { paper: { type: 'string', enum: ['58mm', '80mm', 'A4'] } }
    },
    handler: async (ctx, { paper }) =>
      ctx.tx(async (db) => {
        await db.query('UPDATE receipt_templates SET is_active = false WHERE paper = $1', [paper])
        await ctx.audit(
          db,
          'receipt_template_activate',
          `العودة إلى قالب الفاتورة الافتراضي لورق ${paper}`
        )
      })
  })

  app.operation({
    name: 'receipts.delete',
    permission: 'settings.manage',
    schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
    handler: async (ctx, { id }) =>
      ctx.tx(async (db) => {
        const t = (await db.query('SELECT * FROM receipt_templates WHERE id = $1', [id])).rows[0]
        if (!t) throw notFound('القالب غير موجود.')
        if (t.is_active)
          throw conflict('لا يمكن حذف القالب المعتمد حالياً. اعتمد قالباً آخر أولاً.')
        await db.query('DELETE FROM receipt_templates WHERE id = $1', [id])
        await ctx.audit(db, 'receipt_template_delete', `حذف قالب الفاتورة "${t.name}"`)
      })
  })
}

module.exports.SETTINGS = SETTINGS

module.exports.readAll = readAll
