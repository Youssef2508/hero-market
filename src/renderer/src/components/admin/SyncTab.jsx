import { useEffect, useState } from 'react'
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Link2,
  Unlink,
  Save,
  CircleCheck,
  TriangleAlert,
  History,
  Loader2
} from 'lucide-react'
import { api } from '../../lib/api'
import { formatStamp } from '../../lib/time'
import PasswordInput from '../auth/PasswordInput'

const STATUS_LABEL = {
  applied: 'طُبّقت',
  partially_applied: 'طُبّقت جزئياً (تعارض)',
  rejected: 'رُفضت'
}

/**
 * Cloud synchronisation (stage 4 phase 4, administrators only). The store keeps working without
 * internet; this screen links it to the owner's cloud account, shows what has been sent, and – after
 * a backup restore – brings back what reached the cloud after that backup.
 */
export default function SyncTab({ triggerCustomAlert, triggerCustomConfirm }) {
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState('')
  const [lastRun, setLastRun] = useState(null)

  const load = async () => {
    try {
      const s = await api('sync.status')
      setStatus(s)
      setForm(
        (f) =>
          f || {
            cloudUrl: s.cloudUrl || '',
            storeId: s.storeId || '',
            deviceToken: '',
            enabled: s.linked || s.enabled
          }
      )
    } catch (e) {
      triggerCustomAlert(e.message)
    }
  }
  useEffect(() => {
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (label, fn) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      triggerCustomAlert(e.message)
    } finally {
      setBusy('')
      load()
    }
  }

  if (!status || !form) return <div className="loading-block">جاري تحميل حالة المزامنة…</div>

  const save = (e) => {
    e.preventDefault()
    run('save', async () => {
      const body = {
        cloudUrl: form.cloudUrl.trim(),
        storeId: form.storeId.trim(),
        enabled: !!form.enabled,
        ...(form.deviceToken.trim() ? { deviceToken: form.deviceToken.trim() } : {})
      }
      try {
        setStatus(await api('sync.configure', body))
      } catch (err) {
        if (err.status !== 409) throw err
        await new Promise((resolve) =>
          triggerCustomConfirm(
            `${err.message}\n\nهل تريد ربط هذا الجهاز بالمتجر الجديد؟`,
            async () => {
              try {
                setStatus(await api('sync.configure', { ...body, relink: true }))
              } catch (e2) {
                triggerCustomAlert(e2.message)
              }
              resolve()
            },
            () => resolve()
          )
        )
      }
      setForm((f) => ({ ...f, deviceToken: '' }))
    })
  }

  const syncNow = () =>
    run('sync', async () => {
      const r = await api('sync.runNow')
      setStatus(r.status)
      setLastRun(r.result)
    })

  const recover = () =>
    run('recover', async () => {
      const r = await api('sync.recover')
      setStatus(r.status)
      triggerCustomAlert(
        `تم استرجاع ${r.recovery.rows} تغييراً من السحابة. يمكن متابعة العمل الآن.`,
        'تم الاسترجاع'
      )
    })

  const skip = () =>
    triggerCustomConfirm(
      'تخطي الاسترجاع يعني أن المبيعات والحركات التي وصلت للسحابة بعد تاريخ النسخة الاحتياطية لن تعود إلى هذا الجهاز. تبقى محفوظة في السحابة ويظهر الفرق في حالة المزامنة. هل أنت متأكد؟',
      () =>
        run('skip', async () => {
          setStatus(await api('sync.skipRecovery', { confirm: 'SKIP' }))
        })
    )

  const unlink = () =>
    triggerCustomConfirm(
      'إلغاء الربط يوقف المزامنة ويحذف رمز الجهاز من هذا الكمبيوتر. بيانات المتجر لا تتأثر. متابعة؟',
      () =>
        run('unlink', async () => {
          setStatus(await api('sync.unlink'))
          setForm((f) => ({ ...f, enabled: false, deviceToken: '' }))
        })
    )

  const healthy = status.linked && !status.lastError && status.checkOk !== false
  return (
    <div className="settings-page">
      {status.recoveryPending && (
        <section className="card tone-warning">
          <div className="card-header">
            <h2 className="card-title">
              <History size={18} aria-hidden="true" />
              استرجاع البيانات بعد استعادة نسخة احتياطية
            </h2>
          </div>
          <div className="card-body stack">
            <p>
              تمت استعادة نسخة احتياطية
              {status.recoverFrom?.backupCreatedAt
                ? ` بتاريخ ${formatStamp(status.recoverFrom.backupCreatedAt.replace('T', ' ').slice(0, 19))}`
                : ''}
              . المبيعات والمدفوعات والحركات التي تمت بعدها ووصلت إلى السحابة يمكن إعادتها الآن.
              العمل متوقف على كل الأجهزة حتى تختار.
            </p>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={recover} disabled={!!busy}>
                {busy === 'recover' ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <Cloud size={16} aria-hidden="true" />
                )}
                استرجاع من السحابة
              </button>
              <button type="button" className="btn btn-secondary" onClick={skip} disabled={!!busy}>
                تخطي الاسترجاع
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            {status.linked ? (
              <Cloud size={18} aria-hidden="true" />
            ) : (
              <CloudOff size={18} aria-hidden="true" />
            )}
            حالة المزامنة
          </h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={syncNow}
            disabled={!status.linked || status.recoveryPending || !!busy}
          >
            {busy === 'sync' ? (
              <Loader2 size={15} className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={15} aria-hidden="true" />
            )}
            مزامنة الآن
          </button>
        </div>
        <div className="card-body">
          {!status.linked ? (
            <p className="field-hint">
              المتجر غير مربوط بالسحابة. كل شيء يعمل على هذا الجهاز بدون إنترنت؛ الربط يتيح للمالك
              متابعة المتجر عن بعد. بيانات الربط (عنوان السحابة ورقم المتجر ورمز الجهاز) تأتي من
              حساب المالك في السحابة.
            </p>
          ) : (
            <>
              <p
                className={healthy ? 'notice notice-success' : 'notice notice-danger'}
                role="status"
              >
                {healthy ? (
                  <CircleCheck size={16} aria-hidden="true" />
                ) : (
                  <TriangleAlert size={16} aria-hidden="true" />
                )}
                <span>
                  {status.lastError
                    ? `آخر محاولة فشلت: ${status.lastError}`
                    : status.checkOk === false
                      ? 'السحابة لا تطابق هذا الجهاز بالكامل (انظر التفاصيل).'
                      : status.pending
                        ? `${status.pending} تغيير بانتظار الإرسال.`
                        : 'كل التغييرات وصلت إلى السحابة وتطابقت.'}
                </span>
              </p>
              <dl className="kv">
                <dt>آخر إرسال</dt>
                <dd>{status.lastPushAt ? formatStamp(status.lastPushAt) : '—'}</dd>
                <dt>آخر استلام أوامر</dt>
                <dd>{status.lastPullAt ? formatStamp(status.lastPullAt) : '—'}</dd>
                <dt>آخر مطابقة</dt>
                <dd>{status.lastCheckAt ? formatStamp(status.lastCheckAt) : '—'}</dd>
                <dt>بانتظار الإرسال</dt>
                <dd className="num">{status.pending}</dd>
                <dt>أوامر المالك المنفذة</dt>
                <dd>
                  {status.commands.length
                    ? status.commands
                        .map((c) => `${STATUS_LABEL[c.status] || c.status}: ${c.n}`)
                        .join('، ')
                    : 'لا يوجد'}
                </dd>
              </dl>
              {status.checkOk === false && status.checkDetail?.tables?.length > 0 && (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>الجدول</th>
                        <th>على الجهاز</th>
                        <th>في السحابة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.checkDetail.tables.map((t) => (
                        <tr key={t.table}>
                          <td dir="ltr">{t.table}</td>
                          <td className="num">{t.local}</td>
                          <td className="num">{t.cloud}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {lastRun?.commands?.length > 0 && (
                <p className="field-hint">
                  نُفذ الآن {lastRun.commands.filter((c) => !c.duplicate).length} أمر من المالك.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <form className="card" onSubmit={save}>
        <div className="card-header">
          <h2 className="card-title">
            <Link2 size={18} aria-hidden="true" />
            الربط بالسحابة
          </h2>
        </div>
        <div className="card-body form-grid">
          <label className="field">
            <span className="field-label">عنوان السحابة</span>
            <input
              className="input"
              dir="ltr"
              value={form.cloudUrl}
              onChange={(e) => setForm({ ...form, cloudUrl: e.target.value })}
              placeholder="https://"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">رقم المتجر</span>
            <input
              className="input"
              dir="ltr"
              value={form.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value })}
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">
              رمز الجهاز {status.hasToken ? '(محفوظ – اتركه فارغاً لعدم التغيير)' : ''}
            </span>
            <PasswordInput
              className="input"
              value={form.deviceToken}
              onChange={(e) => setForm({ ...form, deviceToken: e.target.value })}
              maxLength={200}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={!!form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>المزامنة مفعّلة</span>
          </label>
        </div>
        <div className="card-footer row">
          <button type="submit" className="btn btn-primary" disabled={!!busy}>
            <Save size={16} aria-hidden="true" />
            حفظ الربط
          </button>
          {status.hasToken && (
            <button type="button" className="btn btn-ghost" onClick={unlink} disabled={!!busy}>
              <Unlink size={16} aria-hidden="true" />
              إلغاء الربط
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
