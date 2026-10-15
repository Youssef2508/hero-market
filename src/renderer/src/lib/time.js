// 12-hour display of times (owner, 2026-10-15): "03:45 PM", "09:20 AM", midnight "12:00 AM",
// noon "12:00 PM". Display only – stored timestamps stay 'YYYY-MM-DD HH:MM:SS' local time and all
// calculations keep using them. Formatted by hand, not with Intl, so the Windows region settings
// cannot change the result.

const pad = (n) => String(n).padStart(2, '0')

/** Hours (0–23) and minutes → "hh:mm AM/PM"; with seconds → "hh:mm:ss AM/PM". */
export function to12h(hours, minutes, seconds) {
  const h = Number(hours)
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const base = `${pad(h12)}:${pad(minutes)}`
  return `${seconds === undefined ? base : `${base}:${pad(seconds)}`} ${suffix}`
}

/** A Date's local time as "03:45 PM". */
export function formatClock(date = new Date(), { seconds = false } = {}) {
  return to12h(date.getHours(), date.getMinutes(), seconds ? date.getSeconds() : undefined)
}

/** An hour of the day (0–23) as a label: 0 → "12 AM", 13 → "1 PM". */
export function formatHour(hour) {
  const h = Number(hour)
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * A stored local date-time ('YYYY-MM-DD HH:MM[:SS]', or with a 'T') → { date, time } for display,
 * e.g. { date: '2026-10-15', time: '03:45 PM' }. Unknown text is returned unchanged as date.
 */
export function splitStamp(value, { seconds = false } = {}) {
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return { date: value ? String(value) : '', time: '' }
  return { date: m[1], time: to12h(m[2], m[3], seconds ? (m[4] ?? '00') : undefined) }
}

/** A stored local date-time as one string: "2026-10-15 03:45 PM". */
export function formatStamp(value, opts) {
  const { date, time } = splitStamp(value, opts)
  return time ? `${date} ${time}` : date
}
