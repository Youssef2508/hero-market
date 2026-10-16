import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../../lib/api'

// Search field + scrollable list of every product (1.4.0, purchase invoice). It filters by name or
// barcode as you type and loads more as the list is scrolled. A click (or ↑/↓ then Enter) adds the
// product. A scanner still works: a barcode followed by Enter is looked up exactly.
const ProductPicker = ({ added, onPick, onType }) => {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [list, setList] = useState({ query: null, rows: [], total: 0, page: 0 })
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const wrap = useRef(null)
  const input = useRef(null)
  const request = useRef(0)
  const query = text.trim()

  const load = async (q, page) => {
    const id = ++request.current
    setLoading(true)
    try {
      const r = await api('products.page', { search: q, page })
      if (id !== request.current) return
      setList((prev) => ({
        query: q,
        rows: page === 1 ? r.rows : [...prev.rows, ...r.rows],
        total: Number(r.total),
        page
      }))
    } catch {
      if (id === request.current) setList({ query: q, rows: [], total: 0, page: 1 })
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const t = setTimeout(() => load(query, 1), 200)
    return () => clearTimeout(t)
  }, [open, query])

  useEffect(() => {
    if (!open) return undefined
    const outside = (e) => {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  const pick = async (barcode, row) => {
    if (await onPick(barcode, row)) {
      setText('')
      setActive(-1)
    }
    input.current?.focus()
  }

  const onScroll = (e) => {
    const el = e.currentTarget
    const more = list.rows.length < list.total
    if (more && !loading && el.scrollTop + el.clientHeight >= el.scrollHeight - 40)
      load(list.query ?? '', list.page + 1)
  }

  const onKeyDown = (e) => {
    const rows = list.rows
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!query) return
      if (active >= 0 && rows[active]) return pick(rows[active].barcode, rows[active])
      // A single match for exactly this text: take it. Otherwise treat the text as a barcode
      // (a scanner types faster than the list refreshes).
      const exact = rows.find((r) => r.barcode === query)
      if (exact) return pick(exact.barcode, exact)
      if (list.query === query && rows.length === 1) return pick(rows[0].barcode, rows[0])
      pick(query, null)
    }
  }

  useEffect(() => {
    if (active < 0 || !wrap.current) return
    wrap.current.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const listId = 'purchase-product-list'
  return (
    <div className="product-picker" ref={wrap}>
      <div className="product-picker-field">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          className="form-input"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(-1)
            setOpen(true)
            onType?.()
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="ابحث باسم الصنف أو الباركود، أو امسح الباركود"
          aria-label="بحث عن صنف مستلم"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
        />
      </div>
      {open && (
        <ul className="product-picker-list" id={listId} role="listbox" onScroll={onScroll}>
          {list.rows.map((r, i) => {
            const isAdded = added.includes(r.barcode)
            return (
              <li
                key={r.barcode}
                data-index={i}
                role="option"
                aria-selected={i === active}
                aria-disabled={isAdded}
                className={`product-picker-item${i === active ? ' is-active' : ''}${isAdded ? ' is-added' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => !isAdded && pick(r.barcode, r)}
              >
                <span className="product-picker-name">{r.name}</span>
                <span className="cell-muted num ltr" dir="ltr">
                  {r.barcode}
                </span>
                <span className="cell-muted">
                  {isAdded
                    ? 'مضاف'
                    : `المخزون ${Number(r.stock_qty) || 0}${r.unit ? ` ${r.unit}` : ''}`}
                </span>
              </li>
            )
          })}
          {!loading && list.query !== null && list.rows.length === 0 && (
            <li className="product-picker-empty">
              {query ? `لا يوجد صنف يطابق «${query}».` : 'لا توجد أصناف مسجلة.'}
            </li>
          )}
          {loading && <li className="product-picker-empty">جارٍ التحميل…</li>}
        </ul>
      )}
    </div>
  )
}

export default ProductPicker
