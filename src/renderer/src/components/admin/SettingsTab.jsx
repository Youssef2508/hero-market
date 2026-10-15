import { useEffect, useState } from 'react'
import {
  Settings,
  Store,
  Printer,
  ClipboardCheck,
  Save,
  ImagePlus,
  Trash2,
  Monitor
} from 'lucide-react'
import { api } from '../../lib/api'
import ScaleLabelsSection from './ScaleLabelsSection'

const FIELDS = {
  store: [
    { key: 'store_name', label: 'اسم المتجر', hint: 'يظهر في الفاتورة وأعلى القائمة الجانبية.' },
    { key: 'branch_name', label: 'اسم الفرع' },
    {
      key: 'store_address',
      label: 'العنوان',
      hint: 'يظهر في الفاتورة إذا فعّلته في قالب الفاتورة.'
    },
    { key: 'store_phone', label: 'الهاتف', ltr: true }
  ]
}

/**
 * Store-wide settings (one store, shared by all tills). Machine-specific choices (server address,
 * terminal name, theme) stay on each till. Values are validated again by the service.
 */
export default function SettingsTab({ triggerCustomAlert, onSettingsChanged }) {
  const [values, setValues] = useState(null)
  const [saved, setSaved] = useState(null)
  const [device, setDevice] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('settings.get')
      .then((r) => {
        setValues(r.settings)
        setSaved(r.settings)
      })
      .catch((e) => triggerCustomAlert(e.message))
    window.api?.backend
      ?.status()
      .then(setDevice)
      .catch(() => {})
  }, [])

  if (!values) return <div className="loading-block">جاري تحميل الإعدادات…</div>

  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }))
  const changed = Object.keys(values).filter((k) => values[k] !== saved[k])

  const onLogo = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'image/png') return triggerCustomAlert('الشعار يجب أن يكون صورة PNG.')
    if (file.size > 200 * 1024)
      return triggerCustomAlert('حجم الشعار يجب ألا يزيد عن 200 كيلوبايت.')
    const reader = new FileReader()
    reader.onload = () => set('store_logo', String(reader.result))
    reader.readAsDataURL(file)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = Object.fromEntries(changed.map((k) => [k, values[k]]))
      const r = await api('settings.update', { values: payload })
      setValues(r.settings)
      setSaved(r.settings)
      if (onSettingsChanged) onSettingsChanged()
      triggerCustomAlert('تم حفظ الإعدادات وتطبيقها على كل أجهزة الكاشير.', 'تم الحفظ')
    } catch (err) {
      triggerCustomAlert(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="settings-page" onSubmit={save}>
      <div className="settings-actions">
        <p className="text-muted">
          <Settings size={16} aria-hidden="true" /> إعدادات عامة للمتجر بالكامل.
        </p>
        <button type="submit" className="btn btn-primary" disabled={!changed.length || busy}>
          <Save size={16} aria-hidden="true" />
          حفظ التغييرات{' '}
          {changed.length > 0 && <span className="count-pill num">{changed.length}</span>}
        </button>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Store size={18} aria-hidden="true" />
            بيانات المتجر
          </h2>
        </div>
        <div className="card-body form-grid">
          {FIELDS.store.map((f) => (
            <label key={f.key} className="field">
              <span className="field-label">{f.label}</span>
              <input
                className={`input ${f.ltr ? 'ltr' : ''}`}
                dir={f.ltr ? 'ltr' : undefined}
                value={values[f.key] || ''}
                onChange={(e) => set(f.key, e.target.value)}
                maxLength={120}
              />
              {f.hint && <span className="field-hint">{f.hint}</span>}
            </label>
          ))}
          <div className="field span-2">
            <span className="field-label">شعار المتجر (PNG حتى 200 كيلوبايت)</span>
            <div className="logo-row">
              <div className="logo-preview">
                {values.store_logo ? (
                  <img src={values.store_logo} alt="شعار المتجر" />
                ) : (
                  <span className="text-muted">شعار HeroMarket الافتراضي</span>
                )}
              </div>
              <label className="btn btn-secondary btn-sm">
                <ImagePlus size={15} aria-hidden="true" />
                اختيار صورة
                <input type="file" accept="image/png" hidden onChange={onLogo} />
              </label>
              {values.store_logo && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => set('store_logo', '')}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  إزالة
                </button>
              )}
            </div>
            <span className="field-hint">
              يُطبع أعلى الفاتورة عند تفعيل «إظهار الشعار» في قالب الفاتورة.
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Printer size={18} aria-hidden="true" />
            الطباعة
          </h2>
        </div>
        <div className="card-body form-grid">
          <label className="field">
            <span className="field-label">اسم الطابعة الافتراضية</span>
            <input
              className="input ltr"
              dir="ltr"
              value={values.printer_name}
              onChange={(e) => set('printer_name', e.target.value)}
              maxLength={80}
            />
            <span className="field-hint">
              كما يظهر في إعدادات Windows. يمكن لكل جهاز استخدام طابعة مختلفة من إعدادات الجهاز.
            </span>
          </label>
          <label className="field">
            <span className="field-label">مقاس ورق الفاتورة</span>
            <select
              className="input"
              value={values.receipt_paper}
              onChange={(e) => set('receipt_paper', e.target.value)}
            >
              <option value="80mm">حراري 80 مم</option>
              <option value="58mm">حراري 58 مم</option>
            </select>
          </label>
          <label className="check-row span-2">
            <input
              type="checkbox"
              checked={values.print_receipt_default === 'true'}
              onChange={(e) => set('print_receipt_default', e.target.checked ? 'true' : 'false')}
            />
            <span>
              طباعة الفاتورة تلقائياً بعد كل عملية بيع (يمكن للكاشير إيقافها لفاتورة واحدة)
            </span>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <ClipboardCheck size={18} aria-hidden="true" />
            الوردية والجرد الدوري
          </h2>
        </div>
        <div className="card-body form-grid">
          <label className="field">
            <span className="field-label">مبلغ الفكة الافتراضي عند فتح الوردية (ج.م)</span>
            <input
              className="input input-money"
              type="number"
              min="0"
              step="0.01"
              value={values.default_opening_cash}
              onChange={(e) => set('default_opening_cash', e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={values.audit_enabled === 'true'}
              onChange={(e) => set('audit_enabled', e.target.checked ? 'true' : 'false')}
            />
            <span>تذكير الكاشير بجرد الدرج دورياً</span>
          </label>
          <label className="field">
            <span className="field-label">الجرد كل (دقيقة)</span>
            <input
              className="input"
              type="number"
              min="10"
              max="720"
              value={values.audit_interval_minutes}
              disabled={values.audit_enabled !== 'true'}
              onChange={(e) => set('audit_interval_minutes', e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">بعد خمول الشاشة لمدة (ثانية)</span>
            <input
              className="input"
              type="number"
              min="5"
              max="600"
              value={values.audit_idle_seconds}
              disabled={values.audit_enabled !== 'true'}
              onChange={(e) => set('audit_idle_seconds', e.target.value)}
            />
            <span className="field-hint">لا يظهر التذكير أثناء وجود أصناف في الفاتورة.</span>
          </label>
        </div>
      </section>

      {values.scale_labels && (
        <ScaleLabelsSection value={values.scale_labels} onChange={(v) => set('scale_labels', v)} />
      )}

      {device && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Monitor size={18} aria-hidden="true" />
              هذا الجهاز
            </h2>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>اسم الجهاز</dt>
              <dd>{device.terminalName}</dd>
              <dt>طريقة الاتصال</dt>
              <dd>
                {device.mode === 'client'
                  ? 'جهاز كاشير متصل بخادم المتجر'
                  : 'جهاز رئيسي متصل بقاعدة البيانات مباشرة'}
              </dd>
            </dl>
          </div>
        </section>
      )}
    </form>
  )
}
