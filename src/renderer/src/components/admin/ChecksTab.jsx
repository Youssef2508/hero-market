import { Landmark, Archive } from 'lucide-react'
import { EmptyState } from '../ui'
import { formatMoney } from '../../lib/utils'

/**
 * Cheque archive, read only (owner, 2026-10-21, D-060). Cheques are no longer recorded, settled or
 * deleted; administrators can still look up the old records. Data comes from useChecksManager.
 */
export default function ChecksTab({ checksList }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">
          <Archive size={18} aria-hidden="true" />
          أرشيف الشيكات
        </h2>
      </div>
      <div className="card-body">
        <p className="cell-muted">
          الشيكات متوقفة في HeroMarket. هذه السجلات القديمة محفوظة للعرض فقط ولا يمكن تعديلها أو
          حذفها.
        </p>
        {checksList.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="لا توجد شيكات قديمة"
            text="لم يُسجَّل أي شيك من قبل."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>رقم الشيك</th>
                  <th>البنك</th>
                  <th>الجهة</th>
                  <th>الإصدار</th>
                  <th>الاستحقاق</th>
                  <th className="num">المبلغ</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {checksList.map((c) => (
                  <tr key={c.id}>
                    <td>{c.check_type}</td>
                    <td className="num">{c.check_number || '—'}</td>
                    <td>{c.bank_name || '—'}</td>
                    <td className="cell-strong">{c.party_name}</td>
                    <td className="num nowrap cell-muted">{c.issue_date || '—'}</td>
                    <td className="num nowrap">{c.due_date}</td>
                    <td className="num money-strong">{formatMoney(c.amount)}</td>
                    <td>{c.status}</td>
                    <td className="cell-muted">{c.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
