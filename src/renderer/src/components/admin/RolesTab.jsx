import { useEffect, useMemo, useState } from 'react'
import { ShieldCheck, Plus, Save, Trash2, Lock, Users, Copy } from 'lucide-react'
import { EmptyState } from '../ui'
import { api } from '../../lib/api'

const MODULE_LABELS = {
  pos: 'البيع',
  shifts: 'الورديات',
  tills: 'الأدراج القديمة',
  sales: 'الفواتير والمرتجعات',
  products: 'الأصناف',
  inventory: 'المخزون',
  customers: 'العملاء',
  suppliers: 'الموردون',
  finance: 'الحسابات',
  reports: 'التقارير',
  admin: 'الإدارة'
}

const emptyDraft = { id: null, name: '', description: '', permissions: [] }

/**
 * Roles & permissions. The service enforces every rule shown here (no escalation, protected
 * super-administrator role, roles in use cannot be deleted); the UI only explains them.
 */
export default function RolesTab({ currentUser, triggerCustomAlert, triggerCustomConfirm }) {
  const [roles, setRoles] = useState([])
  const [catalog, setCatalog] = useState([])
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const mine = useMemo(() => new Set(currentUser?.permissions || []), [currentUser])

  const load = async (selectId) => {
    try {
      const [r, c] = await Promise.all([api('roles.list'), api('roles.catalog')])
      setRoles(r)
      setCatalog(c)
      const pick = r.find((x) => x.id === (selectId ?? draft?.id)) || r[0]
      if (pick) setDraft({ ...pick, permissions: [...pick.permissions] })
    } catch (e) {
      triggerCustomAlert(e.message)
    }
  }
  useEffect(() => {
    load()
  }, [])

  const groups = useMemo(() => {
    const g = {}
    for (const p of catalog) (g[p.module] = g[p.module] || []).push(p)
    return Object.entries(g)
  }, [catalog])

  const original = draft?.id ? roles.find((r) => r.id === draft.id) : null
  const locked = !!original?.is_protected
  const has = (k) => draft?.permissions.includes(k)
  const toggle = (k) =>
    setDraft((d) => ({
      ...d,
      permissions: d.permissions.includes(k)
        ? d.permissions.filter((x) => x !== k)
        : [...d.permissions, k]
    }))
  const toggleModule = (perms, on) =>
    setDraft((d) => {
      const allowed = perms.map((p) => p.key).filter((k) => mine.has(k))
      const set = new Set(d.permissions)
      for (const k of allowed) on ? set.add(k) : set.delete(k)
      return { ...d, permissions: [...set] }
    })

  const added = original
    ? draft.permissions.filter((p) => !original.permissions.includes(p))
    : draft?.permissions || []
  const removed = original ? original.permissions.filter((p) => !draft.permissions.includes(p)) : []
  const dirty =
    !!draft &&
    (!original ||
      added.length ||
      removed.length ||
      draft.name !== original.name ||
      (draft.description || '') !== (original.description || ''))

  const save = async () => {
    if (!draft.name.trim()) return triggerCustomAlert('يرجى إدخال اسم الدور.')
    setSaving(true)
    try {
      if (draft.id) {
        const res = await api('roles.update', {
          id: draft.id,
          name: draft.name,
          description: draft.description || '',
          permissions: draft.permissions
        })
        triggerCustomAlert(
          `تم حفظ الدور. التغيير يطبق فوراً على ${res.affectedUsers} مستخدم.`,
          'تم الحفظ'
        )
        await load(draft.id)
      } else {
        const res = await api('roles.create', {
          name: draft.name,
          description: draft.description || '',
          permissions: draft.permissions
        })
        triggerCustomAlert(
          'تم إنشاء الدور. يمكنك الآن إسناده للمستخدمين من شاشة المستخدمين.',
          'تم الحفظ'
        )
        await load(res.id)
      }
    } catch (e) {
      triggerCustomAlert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = () =>
    triggerCustomConfirm(`هل تريد حذف الدور "${original.name}"؟`, async () => {
      try {
        await api('roles.delete', { id: original.id })
        setDraft(null)
        await load(null)
      } catch (e) {
        triggerCustomAlert(e.message)
      }
    })

  const label = (k) => catalog.find((p) => p.key === k)?.label || k

  return (
    <div className="roles-layout">
      <section className="card roles-list">
        <div className="card-header">
          <h2 className="card-title">
            <ShieldCheck size={18} aria-hidden="true" />
            الأدوار
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setDraft({ ...emptyDraft })}
          >
            <Plus size={16} aria-hidden="true" />
            دور جديد
          </button>
        </div>
        <ul className="role-items" aria-label="الأدوار">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={draft?.id === r.id}
                className={`role-item ${draft?.id === r.id ? 'is-active' : ''}`}
                onClick={() => setDraft({ ...r, permissions: [...r.permissions] })}
              >
                <span className="role-item-name">
                  {r.is_protected && <Lock size={13} aria-label="محمي" />}
                  {r.name}
                </span>
                <span className="role-item-meta">
                  <Users size={13} aria-hidden="true" />
                  <span className="num">{r.user_count}</span> مستخدم ·{' '}
                  <span className="num">{r.permissions.length}</span> صلاحية
                  {r.is_system && <span className="badge badge-accent">أساسي</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {!draft ? (
        <section className="card">
          <EmptyState
            icon={ShieldCheck}
            title="اختر دوراً"
            text="اختر دوراً من القائمة لعرض صلاحياته أو أنشئ دوراً جديداً."
          />
        </section>
      ) : (
        <section className="card role-editor">
          <div className="card-header">
            <h2 className="card-title">
              {draft.id ? `صلاحيات: ${original?.name || draft.name}` : 'دور جديد'}
            </h2>
            <div className="row">
              {draft.id && !locked && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      id: null,
                      name: `${draft.name} (نسخة)`,
                      permissions: draft.permissions.filter((k) => mine.has(k))
                    })
                  }
                >
                  <Copy size={15} aria-hidden="true" />
                  نسخ كدور جديد
                </button>
              )}
              {original && !original.is_system && (
                <button
                  type="button"
                  className="btn btn-danger-soft btn-sm"
                  onClick={remove}
                  disabled={Number(original.user_count) > 0}
                  title={Number(original.user_count) > 0 ? 'الدور مسند لمستخدمين' : ''}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  حذف
                </button>
              )}
              {!locked && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={save}
                  disabled={!dirty || saving}
                >
                  <Save size={15} aria-hidden="true" />
                  حفظ
                </button>
              )}
            </div>
          </div>
          <div className="card-body role-editor-body">
            {locked && (
              <div className="notice notice-info">
                <Lock size={18} aria-hidden="true" />
                <div>
                  دور مدير النظام محمي: يملك كل الصلاحيات دائماً ولا يمكن تعديله أو حذفه، ويجب أن
                  يبقى مستخدم نشط واحد على الأقل بهذا الدور.
                </div>
              </div>
            )}
            <div className="form-grid">
              <label className="field">
                <span className="field-label">اسم الدور</span>
                <input
                  className="input"
                  value={draft.name}
                  disabled={locked}
                  maxLength={60}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">الوصف</span>
                <textarea
                  className="input"
                  rows={2}
                  value={draft.description || ''}
                  disabled={locked}
                  maxLength={300}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
            </div>

            {(added.length > 0 || removed.length > 0) && original && (
              <div className="notice notice-warning" role="status">
                <div>
                  <strong>أثر التغيير على {original.user_count} مستخدم:</strong>
                  {added.length > 0 && <div>إضافة: {added.map(label).join('، ')}</div>}
                  {removed.length > 0 && <div>سحب: {removed.map(label).join('، ')}</div>}
                </div>
              </div>
            )}

            <div className="perm-groups">
              {groups.map(([mod, perms]) => {
                const onCount = perms.filter((p) => has(p.key)).length
                return (
                  <fieldset key={mod} className="perm-group">
                    <legend>
                      <span>{MODULE_LABELS[mod] || mod}</span>
                      <span className="num text-muted">
                        {onCount}/{perms.length}
                      </span>
                      {!locked && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          onClick={() => toggleModule(perms, onCount < perms.length)}
                        >
                          {onCount < perms.length ? 'تحديد الكل' : 'إلغاء الكل'}
                        </button>
                      )}
                    </legend>
                    {perms.map((p) => {
                      const beyond = !mine.has(p.key)
                      return (
                        <label
                          key={p.key}
                          className={`perm-row ${beyond ? 'is-disabled' : ''}`}
                          title={beyond ? 'لا يمكنك منح صلاحية لا تملكها' : p.description}
                        >
                          <input
                            type="checkbox"
                            checked={has(p.key)}
                            disabled={locked || beyond}
                            onChange={() => toggle(p.key)}
                          />
                          <span>
                            <strong>{p.label}</strong>
                            <small>{p.description}</small>
                          </span>
                        </label>
                      )
                    })}
                  </fieldset>
                )
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
