import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, FolderTree, Loader2, Package, Plus, Scale } from 'lucide-react'
import { api } from '../../lib/api'
import { createCatalogCache } from '../../lib/catalogCache'

// One cache per till window: categories already opened switch instantly (no database round trip).
const cache = createCatalogCache(api)

const money = (n) => (Number(n) || 0).toFixed(2)
const UNCATEGORISED = 0

/**
 * Category browsing at the till (1.4.0): for products without a barcode or when scanning fails.
 * It complements scanning and search – the scanner keeps working while the panel is open – and
 * never touches the cart except to add: a product is added through the same path as a scan
 * (onAdd → pos.resolve), so prices, units, weighing and automatic discounts are the current ones.
 * Escape closes the panel (it does not clear the cart here); F6 opens and closes it.
 */
export default function CategoryBrowser({ open, onClose, onAdd, cart, cartTotal }) {
  const [cats, setCats] = useState(null)
  const [active, setActive] = useState(null)
  const [page, setPage] = useState(null) // { forId, products, more }
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState(null) // barcode just added (visual confirmation)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    cache
      .categories()
      .then((r) => {
        if (!alive) return
        setError('')
        setCats(r)
        // Keep the category the cashier was in; otherwise the first one.
        setActive((cur) => cur ?? r.categories[0]?.id ?? UNCATEGORISED)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [open])

  useEffect(() => {
    if (!open || active === null) return
    let alive = true
    cache.products(active).then(
      (r) => {
        if (!alive) return
        setError('')
        setPage({ ...r, forId: active })
      },
      (e) => alive && setError(e.message)
    )
    return () => {
      alive = false
    }
  }, [open, active])

  // Escape closes the panel before the till's own Escape (clear cart) can see it.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.modal-overlay')) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const inCart = useMemo(() => {
    const m = new Map()
    for (const l of cart || []) m.set(l.barcode, (m.get(l.barcode) || 0) + Number(l.qty || 0))
    return m
  }, [cart])

  if (!open) return null

  // Loading while the page shown is not yet the selected category's.
  const loading = loadingMore || (active !== null && page?.forId !== active && !error)

  const add = async (p) => {
    setFlash(p.barcode)
    setTimeout(() => setFlash((f) => (f === p.barcode ? null : f)), 450)
    const ok = await onAdd(p.barcode)
    // A product stopped or changed since it was cached: refresh what is shown.
    if (ok === false) {
      cache.invalidate()
      setPage({ ...(await cache.products(active)), forId: active })
    }
  }
  const loadMore = async () => {
    setLoadingMore(true)
    try {
      setPage({ ...(await cache.more(active)), forId: active })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const groups = cats
    ? [
        ...cats.categories,
        // Always listed last: every product without a (working) category is found here.
        { id: UNCATEGORISED, name: 'بدون تصنيف', products: cats.uncategorised || 0 }
      ]
    : []
  const lines = (cart || []).length

  // ↑/↓ (and Home/End) move between categories in the vertical list.
  const moveBetweenCategories = (e) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }
    if (!(e.key in keys) || !groups.length) return
    e.preventDefault()
    const i = Math.max(
      0,
      groups.findIndex((g) => g.id === active)
    )
    const step = keys[e.key]
    const next = Number.isFinite(step)
      ? Math.min(groups.length - 1, Math.max(0, i + step))
      : step < 0
        ? 0
        : groups.length - 1
    setActive(groups[next].id)
    e.currentTarget.querySelectorAll('.cat-chip')[next]?.focus()
  }

  return (
    <section className="category-browser" ref={panelRef} aria-label="تصفح الأصناف حسب التصنيف">
      <header className="browser-head">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          <ArrowRight size={16} aria-hidden="true" />
          رجوع للفاتورة
          <kbd className="kbd">Esc</kbd>
        </button>
        <span className="browser-title">
          <FolderTree size={17} aria-hidden="true" />
          تصفح الأصناف
        </span>
        <span className="browser-cart" aria-live="polite">
          في الفاتورة: <strong className="num">{lines}</strong> صنف –{' '}
          <strong className="money">{money(cartTotal)}</strong> ج.م
        </span>
      </header>

      <div className="browser-body">
        <nav className="browser-cats" aria-label="التصنيفات" onKeyDown={moveBetweenCategories}>
          {!cats && !error && <Loader2 size={18} className="spin" aria-hidden="true" />}
          {groups.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`cat-chip ${active === c.id ? 'is-active' : ''}`}
              aria-pressed={active === c.id}
              onClick={() => setActive(c.id)}
              title={c.name}
            >
              <span className="cat-name">{c.name}</span>
              <span className="cat-count num">{c.products}</span>
            </button>
          ))}
        </nav>
        <div className="browser-products">
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}

          <div className="browser-grid" role="list" aria-busy={loading}>
            {page?.products.map((p) => {
              const qty = inCart.get(p.barcode)
              return (
                <button
                  type="button"
                  role="listitem"
                  key={p.barcode}
                  className={`product-card ${flash === p.barcode ? 'is-added' : ''} ${qty ? 'in-cart' : ''}`}
                  onClick={() => add(p)}
                  title={`${p.name} – ${money(p.price)} ج.م`}
                >
                  <span className="product-card-name">{p.name}</span>
                  <span className="product-card-meta">
                    <span className="money">{money(p.price)}</span>
                    <span className="product-card-unit">
                      {p.unitKind === 'weight' ? <Scale size={13} aria-hidden="true" /> : null}
                      {p.unitKind === 'weight' ? 'للكيلو' : p.unit || ''}
                    </span>
                  </span>
                  {p.packs > 0 && (
                    <span
                      className="product-card-packs"
                      title="له عبوات أخرى (كرتونة…) يمكن اختيارها في الفاتورة"
                    >
                      <Package size={12} aria-hidden="true" /> {p.packs}
                    </span>
                  )}
                  {qty ? (
                    <span className="product-card-qty num" aria-label={`في الفاتورة: ${qty}`}>
                      {qty}
                    </span>
                  ) : (
                    <Plus size={15} className="product-card-plus" aria-hidden="true" />
                  )}
                </button>
              )
            })}
            {page && page.products.length === 0 && !loading && (
              <p className="field-hint browser-empty">لا توجد أصناف متاحة في هذا التصنيف.</p>
            )}
          </div>
          {page?.more && (
            <button
              type="button"
              className="btn btn-ghost btn-sm browser-more"
              onClick={loadMore}
              disabled={loading}
            >
              {loading && <Loader2 size={15} className="spin" aria-hidden="true" />}
              عرض المزيد
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
