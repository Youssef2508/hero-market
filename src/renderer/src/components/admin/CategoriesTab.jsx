import { useEffect, useMemo, useState } from 'react'
import {
  FolderTree,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Search,
  ArrowLeftRight,
  Save,
  X
} from 'lucide-react'
import { api } from '../../lib/api'

const UNCATEGORISED = 0

/**
 * Product categories (1.4.0, administrators: categories.manage). Categories are stopped rather than
 * deleted; only an empty category can be deleted. Products are moved between categories here or in
 * the product form. The till browses active categories (pos.categories).
 */
export default function CategoriesTab({ triggerCustomAlert, triggerCustomConfirm }) {
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null) // category id, or 0 for "without category"
  const [editing, setEditing] = useState(null) // { id?, name, description }
  const [busy, setBusy] = useState(false)
  const [products, setProducts] = useState({ rows: [], total: 0, page: 1 })
  const [checked, setChecked] = useState(new Set())
  const [moveTo, setMoveTo] = useState('')
  const [search, setSearch] = useState('')
  const [found, setFound] = useState([])

  // State is set only when an answer arrives (never synchronously inside an effect).
  const fetchList = () => api('categories.list')
  const fetchProducts = (categoryId, page) =>
    api('products.page', { categoryId, page }).then((r) => ({
      rows: r.rows,
      total: Number(r.total),
      page
    }))
  const showProducts = (p) => {
    setProducts(p)
    setChecked(new Set())
  }
  const load = () => fetchList().then(setData, (e) => triggerCustomAlert(e.message))
  const loadProducts = (categoryId, page = 1) =>
    categoryId === null
      ? Promise.resolve()
      : fetchProducts(categoryId, page).then(showProducts, (e) => triggerCustomAlert(e.message))
  useEffect(() => {
    let alive = true
    fetchList().then(
      (r) => alive && setData(r),
      (e) => alive && triggerCustomAlert(e.message)
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (selected === null) return
    let alive = true
    fetchProducts(selected, 1).then(
      (p) => alive && showProducts(p),
      (e) => alive && triggerCustomAlert(e.message)
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const categories = useMemo(() => data?.categories || [], [data])
  const run = async (fn, success) => {
    setBusy(true)
    try {
      await fn()
      if (success) triggerCustomAlert(success, 'تم')
      await load()
      await loadProducts(selected, products.page)
    } catch (e) {
      triggerCustomAlert(e.message)
    } finally {
      setBusy(false)
    }
  }

  const save = (e) => {
    e.preventDefault()
    if (!editing || !editing.name.trim()) return
    run(async () => {
      const r = await api('categories.save', {
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name.trim(),
        description: editing.description?.trim() || null
      })
      setEditing(null)
      setSelected(r.id)
    })
  }
  const move = (c, dir) => {
    const i = categories.findIndex((x) => x.id === c.id)
    const other = categories[i + dir]
    if (!other) return
    run(async () => {
      // Swap positions (sort orders are renumbered so equal values cannot block the swap).
      await api('categories.save', { id: c.id, name: c.name, sortOrder: (i + dir) * 10 })
      await api('categories.save', { id: other.id, name: other.name, sortOrder: i * 10 })
    })
  }
  const remove = (c) =>
    triggerCustomConfirm(`حذف التصنيف "${c.name}"؟ يمكن حذف التصنيف الفارغ فقط.`, () =>
      run(async () => {
        await api('categories.delete', { id: c.id })
        if (selected === c.id) setSelected(null)
      })
    )
  const assign = (barcodes, categoryId) =>
    run(async () => {
      const r = await api('categories.assign', { categoryId, barcodes })
      setFound([])
      setSearch('')
      return r
    })
  const doSearch = async (e) => {
    e.preventDefault()
    if (!search.trim()) return
    try {
      const r = await api('products.page', { search: search.trim(), page: 1 })
      setFound(r.rows)
    } catch (err) {
      triggerCustomAlert(err.message)
    }
  }

  if (!data) return <div className="loading-block">جاري تحميل التصنيفات…</div>
  const current =
    selected === UNCATEGORISED
      ? { id: UNCATEGORISED, name: 'بدون تصنيف' }
      : categories.find((c) => c.id === selected) || null
  const pages = Math.max(1, Math.ceil(products.total / 12))

  return (
    <div className="categories-page">
      <section className="card categories-list">
        <div className="card-header">
          <h2 className="card-title">
            <FolderTree size={18} aria-hidden="true" />
            التصنيفات
          </h2>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditing({ name: '', description: '' })}
          >
            <Plus size={15} aria-hidden="true" />
            تصنيف جديد
          </button>
        </div>
        {editing && (
          <form className="card-body category-form" onSubmit={save}>
            <label className="field">
              <span className="field-label">اسم التصنيف</span>
              <input
                className="input"
                value={editing.name}
                maxLength={60}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span className="field-label">وصف (اختياري)</span>
              <input
                className="input"
                value={editing.description || ''}
                maxLength={200}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              />
            </label>
            <div className="row">
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                <Save size={15} aria-hidden="true" />
                حفظ
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditing(null)}
              >
                <X size={15} aria-hidden="true" />
                إلغاء
              </button>
            </div>
          </form>
        )}
        <ul className="category-items" role="listbox" aria-label="التصنيفات">
          {categories.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={selected === c.id}
              className={`category-item ${selected === c.id ? 'is-selected' : ''} ${c.isActive ? '' : 'is-stopped'}`}
            >
              <button type="button" className="category-pick" onClick={() => setSelected(c.id)}>
                <span className="category-name">{c.name}</span>
                <span className="badge num">{c.products}</span>
                {!c.isActive && <span className="badge badge-warning">موقوف</span>}
              </button>
              <div className="cell-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`أعلى ${c.name}`}
                  disabled={busy || i === 0}
                  onClick={() => move(c, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`أسفل ${c.name}`}
                  disabled={busy || i === categories.length - 1}
                  onClick={() => move(c, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`تعديل ${c.name}`}
                  onClick={() =>
                    setEditing({ id: c.id, name: c.name, description: c.description || '' })
                  }
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={c.isActive ? `إيقاف ${c.name}` : `تفعيل ${c.name}`}
                  title={
                    c.isActive ? 'إيقاف (يختفي من تصفح الكاشير، والأصناف تبقى متاحة)' : 'تفعيل'
                  }
                  disabled={busy}
                  onClick={() =>
                    run(() => api('categories.setActive', { id: c.id, isActive: !c.isActive }))
                  }
                >
                  {c.isActive ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`حذف ${c.name}`}
                  disabled={busy || c.products + c.inactiveProducts > 0}
                  title={c.products + c.inactiveProducts > 0 ? 'لا يُحذف تصنيف به أصناف' : 'حذف'}
                  onClick={() => remove(c)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          ))}
          <li className={`category-item ${selected === UNCATEGORISED ? 'is-selected' : ''}`}>
            <button
              type="button"
              className="category-pick"
              onClick={() => setSelected(UNCATEGORISED)}
            >
              <span className="category-name">بدون تصنيف</span>
              <span className="badge num">{data.uncategorised}</span>
            </button>
          </li>
        </ul>
      </section>

      <section className="card category-products">
        <div className="card-header">
          <h2 className="card-title">
            {current ? `أصناف: ${current.name}` : 'اختر تصنيفاً لعرض أصنافه'}
          </h2>
        </div>
        {current && (
          <div className="card-body stack">
            <form className="row" onSubmit={doSearch}>
              <div className="search-field" style={{ flex: 1 }}>
                <Search size={15} aria-hidden="true" />
                <input
                  className="input"
                  placeholder="ابحث عن صنف لإضافته لهذا التصنيف (الاسم أو الباركود)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="بحث عن صنف"
                />
              </div>
              <button type="submit" className="btn btn-secondary btn-sm">
                بحث
              </button>
            </form>
            {found.length > 0 && (
              <ul className="found-products">
                {found.map((p) => (
                  <li key={p.barcode}>
                    <span>
                      {p.name} <span className="cell-muted num">{p.barcode}</span>
                      {p.category_name ? <span className="badge">{p.category_name}</span> : null}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy || p.category_id === (current.id || null)}
                      onClick={() => assign([p.barcode], current.id || null)}
                    >
                      نقل إلى {current.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th aria-label="تحديد" />
                    <th>الصنف</th>
                    <th>الباركود</th>
                    <th>السعر</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {products.rows.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="table-empty">
                        لا توجد أصناف في هذا التصنيف.
                      </td>
                    </tr>
                  ) : (
                    products.rows.map((p) => (
                      <tr key={p.barcode}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`تحديد ${p.name}`}
                            checked={checked.has(p.barcode)}
                            onChange={(e) => {
                              const next = new Set(checked)
                              if (e.target.checked) next.add(p.barcode)
                              else next.delete(p.barcode)
                              setChecked(next)
                            }}
                          />
                        </td>
                        <td>{p.name}</td>
                        <td className="num cell-muted">{p.barcode}</td>
                        <td className="num">{Number(p.retail_price).toFixed(2)}</td>
                        <td>
                          {p.is_active === false ? (
                            <span className="badge badge-warning">موقوف عن البيع</span>
                          ) : (
                            <span className="badge badge-success">متاح</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="row category-actions">
              <span className="cell-muted">
                صفحة {products.page} من {pages} – {products.total} صنف
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={products.page <= 1}
                onClick={() => loadProducts(selected, products.page - 1)}
              >
                السابق
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={products.page >= pages}
                onClick={() => loadProducts(selected, products.page + 1)}
              >
                التالي
              </button>
              <select
                className="form-input"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                aria-label="نقل المحدد إلى"
              >
                <option value="">نقل المحدد إلى…</option>
                {categories
                  .filter((c) => c.isActive && c.id !== current.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                {current.id !== UNCATEGORISED && <option value="none">بدون تصنيف</option>}
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || !checked.size || !moveTo}
                onClick={() => assign([...checked], moveTo === 'none' ? null : Number(moveTo))}
              >
                <ArrowLeftRight size={15} aria-hidden="true" />
                نقل ({checked.size})
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
