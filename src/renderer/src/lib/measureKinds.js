// Measurement kinds (1.4.0, migration 0014): the three built-in kinds and those the owner adds.
// Loaded once after sign-in and again after a change; the service enforces the real rules.
import { useSyncExternalStore } from 'react'
import { api } from './api'

const BUILTIN = [
  { key: 'count', name: 'بالعدد', unit: 'قطعة', decimals: 0, isSystem: true, isActive: true },
  { key: 'weight', name: 'بالوزن', unit: 'كجم', decimals: 3, isSystem: true, isActive: true },
  { key: 'volume', name: 'بالحجم', unit: 'لتر', decimals: 3, isSystem: true, isActive: true }
]
// Labels of the built-in kinds in the product form (unchanged from before 1.4.0).
const BUILTIN_LABELS = {
  count: 'بالعدد (قطعة، علبة… أعداد صحيحة)',
  weight: 'بالوزن (كيلوجرام، 3 خانات عشرية)',
  volume: 'بالحجم (لتر، 3 خانات عشرية)'
}

let kinds = BUILTIN
const listeners = new Set()
const emit = () => listeners.forEach((l) => l())

export function setMeasureKinds(list) {
  if (Array.isArray(list) && list.length) kinds = list
  emit()
}

export async function loadMeasureKinds() {
  try {
    setMeasureKinds((await api('measureKinds.list')).kinds)
  } catch {
    /* keep the built-in kinds; the service still checks every quantity */
  }
  return kinds
}

/** { key, name, unit, decimals } of a kind; unknown keys get 3 decimals (never refuse locally). */
export function kindInfo(key) {
  const k = key || 'count'
  return (
    kinds.find((x) => x.key === k) ||
    BUILTIN.find((x) => x.key === k) || { key: k, name: k, unit: '', decimals: 3 }
  )
}

export function kindLabel(kind) {
  if (BUILTIN_LABELS[kind.key]) return BUILTIN_LABELS[kind.key]
  const places =
    kind.decimals === 0
      ? 'أعداد صحيحة'
      : kind.decimals === 1
        ? 'خانة عشرية واحدة'
        : kind.decimals === 2
          ? 'خانتان عشريتان'
          : '3 خانات عشرية'
  return `${kind.name} (${kind.unit}، ${places})${kind.isActive === false ? ' – موقوفة' : ''}`
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The list of kinds, re-rendering when it changes. */
export function useMeasureKinds() {
  return useSyncExternalStore(subscribe, () => kinds)
}
