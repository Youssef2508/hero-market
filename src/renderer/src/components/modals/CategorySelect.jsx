import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

/**
 * Category picker for the product forms. Lists active categories (and the product's current one,
 * even if it was stopped, so the form never silently changes it). `value` is a category id or null
 * (no category).
 */
export default function CategorySelect({ value, onChange, id }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let alive = true
    api('categories.list')
      .then((r) => alive && setList(r.categories))
      .catch(() => alive && setList([]))
    return () => {
      alive = false
    }
  }, [])
  const options = (list || []).filter((c) => c.isActive || c.id === value)
  return (
    <select
      id={id}
      className="form-input"
      value={value ?? ''}
      disabled={list === null}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">بدون تصنيف</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
          {c.isActive ? '' : ' (موقوف)'}
        </option>
      ))}
    </select>
  )
}
