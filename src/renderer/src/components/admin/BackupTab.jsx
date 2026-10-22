import { useEffect, useState } from 'react'
import {
  DatabaseBackup,
  Download,
  Upload,
  ShieldAlert,
  CircleCheck,
  RefreshCw,
  ShieldCheck,
  MoonStar
} from 'lucide-react'

/**
 * The automatic nightly backup (BACKUP-01): every day at 00:00, also with the program closed; 14
 * daily and 8 weekly copies. Its last result comes from logs\backup-status.json.
 */
function NightlyBackup() {
  const [s, setS] = useState(null)
  useEffect(() => {
    window.api?.db
      ?.nightlyStatus?.()
      .then(setS)
      .catch(() => setS(null))
  }, [])
  if (!s) return null
  const stamp = (v) => (v ? new Date(v).toLocaleString('ar-EG') : '—')
  return (
    <section className="card">
      <div className="card-body stack">
        <h2 className="card-title">
          <MoonStar size={18} aria-hidden="true" />
          النسخ الاحتياطي التلقائي كل ليلة
        </h2>
        <p className="cell-muted">
          كل يوم الساعة 12:00 منتصف الليل، حتى لو كان البرنامج مغلقاً. إذا كان الجهاز مغلقاً وقتها
          تؤخذ النسخة مرة واحدة عند تشغيله. يُحتفظ بآخر 14 نسخة يومية و8 نسخ أسبوعية.
        </p>
        <dl className="kv">
          <dt>آخر نسخة ناجحة</dt>
          <dd>{stamp(s.lastGood)}</dd>
          <dt>آخر محاولة</dt>
          <dd className={s.result === 'failed' ? 'text-danger' : ''}>
            {s.result === null
              ? 'لم تُؤخذ نسخة تلقائية بعد'
              : s.result === 'failed'
                ? `فشلت (${stamp(s.at)}): ${s.reason || ''}`
                : `${stamp(s.at)} – ${s.result === 'done' ? 'تمت' : 'لا حاجة (نسخة اليوم موجودة)'}`}
          </dd>
          <dt>النسخ المحفوظة</dt>
          <dd>{(s.kept || []).length}</dd>
          <dt>المجلد</dt>
          <dd className="mono">{s.folder}</dd>
        </dl>
      </div>
    </section>
  )
}

export default function BackupTab() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: '', message: '' })

  const handleBackup = async () => {
    setLoading(true)
    setStatus({ type: '', message: '' })
    try {
      const res = await window.api.db.backup()
      if (res.success) {
        setStatus({
          type: 'success',
          message: `تم بنجاح حفظ نسخة احتياطية في المسار: ${res.filePath}`
        })
      } else if (res.error !== 'User cancelled') {
        setStatus({ type: 'error', message: `فشل النسخ الاحتياطي: ${res.error}` })
      }
    } catch (e) {
      setStatus({ type: 'error', message: `خطأ غير متوقع: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = async () => {
    const confirmRestore = window.confirm(
      'تحذير هام جداً:\nاستيراد قاعدة بيانات سيبدل كافة البيانات الحالية بالكامل (المخزن، المبيعات، الحسابات) بالنسخة المستوردة ولا يمكن التراجع عن هذا الإجراء.\n\nهل تريد الاستمرار؟'
    )
    if (!confirmRestore) return

    setLoading(true)
    setStatus({ type: '', message: '' })
    try {
      const res = await window.api.db.restore()
      if (res.success) {
        setStatus({
          type: 'success',
          message:
            'تم استرجاع قاعدة البيانات بنجاح! يرجى إغلاق البرنامج وإعادة تشغيله لتطبيق التغييرات.'
        })
      } else if (res.error !== 'User cancelled') {
        setStatus({ type: 'error', message: `فشل استرجاع قاعدة البيانات: ${res.error}` })
      }
    } catch (e) {
      setStatus({ type: 'error', message: `خطأ غير متوقع: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="page-intro">
        <p>احمِ بيانات المتجر من الضياع بأخذ نسخ احتياطية دورية، واسترجعها بأمان عند الحاجة.</p>
      </div>

      {status.message && (
        <div
          className={`notice ${status.type === 'success' ? 'notice-success' : 'notice-danger'}`}
          role="status"
        >
          {status.type === 'success' ? <CircleCheck size={18} /> : <ShieldAlert size={18} />}
          <span style={{ fontWeight: 'var(--fw-semibold)' }}>{status.message}</span>
        </div>
      )}

      <NightlyBackup />

      <div className="two-col">
        <section className="card action-card">
          <div className="card-body stack">
            <span className="action-card-icon tone-accent" aria-hidden="true">
              <Download size={22} />
            </span>
            <h2 className="card-title">حفظ نسخة احتياطية جديدة</h2>
            <p className="text-2">
              تصدير نسخة كاملة ومحدّثة من قاعدة البيانات الحالية. يُنصح بحفظها على قرص خارجي أو
              فلاشة USB أسبوعياً.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleBackup}
              disabled={loading}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <DatabaseBackup size={18} />}
              إنشاء نسخة احتياطية الآن
            </button>
          </div>
        </section>

        <section className="card action-card">
          <div className="card-body stack">
            <span className="action-card-icon tone-danger" aria-hidden="true">
              <Upload size={22} />
            </span>
            <h2 className="card-title">استرجاع نسخة احتياطية سابقة</h2>
            <p className="text-2">
              اختر ملف نسخة احتياطية محفوظ سابقاً لاسترجاع البيانات بالكامل.{' '}
              <strong className="text-danger">تنبيه:</strong> سيتم مسح أي بيانات سُجلت بعد تاريخ
              النسخة.
            </p>
            <button
              type="button"
              className="btn btn-danger-soft btn-lg"
              onClick={handleRestore}
              disabled={loading}
            >
              {loading ? <RefreshCw className="spin" size={18} /> : <Upload size={18} />}
              استيراد واسترجاع البيانات
            </button>
          </div>
        </section>
      </div>

      <section className="notice notice-warning" aria-label="إرشادات الأمان">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong>إرشادات مهمة لحماية البيانات</strong>
          <ul className="bullet-list">
            <li>
              حافظ على سرية ملفات النسخ الاحتياطي؛ فهي تحتوي على كامل بيانات المبيعات والأرباح.
            </li>
            <li>لا تفصل الكهرباء أو تغلق الجهاز أثناء حفظ أو استرجاع قاعدة البيانات.</li>
            <li>
              قاعدة البيانات (PostgreSQL) تحفظ كل عملية بيع كاملة أو لا تحفظها أبداً، فلا تتلف
              البيانات عند انقطاع التيار. احتفظ بنسخة احتياطية حديثة خارج هذا الجهاز.
            </li>
          </ul>
        </div>
      </section>
    </>
  )
}
