// ─────────────────────────────────────────────
// Shared Utility Functions
// ─────────────────────────────────────────────

/**
 * Escapes single-quote characters for safe SQL string embedding.
 * NOTE: All user input must pass through this before being placed
 * inside a SQL string literal.
 */
export function escapeSql(str) {
  if (!str) return ''
  return str.toString().replace(/\0/g, '').replace(/'/g, "''")
}

/**
 * Generates SHA-256 hash of a string using Web Crypto API.
 */
export async function hashPin(pin) {
  if (!pin) return ''
  const encoder = new TextEncoder()
  const data = encoder.encode(pin.toString().trim())
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Converts Arabic-Indic (٠١٢…) and Persian-Indic (۰۱۲…) digits
 * to standard Latin digits so barcode/price fields parse correctly.
 */
export function normalizeDigits(str) {
  if (!str) return ''
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
  let res = str.toString()
  for (let i = 0; i < 10; i++) {
    res = res
      .replace(new RegExp(arabicDigits[i], 'g'), i)
      .replace(new RegExp(persianDigits[i], 'g'), i)
  }
  return res
}

let _audioCtx = null
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (AudioContext) {
      _audioCtx = new AudioContext()
    }
  }
  return _audioCtx
}

/**
 * Plays an audio feedback tone using the Web Audio API.
 * 100% offline — no external sound files required.
 * @param {'success'|'chime'|'error'} type
 */
export function playSound(type) {
  try {
    const ctx = getAudioCtx()
    if (!ctx) return

    if (type === 'success') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      gain.gain.setValueAtTime(0.05, ctx.currentTime)
      osc.start()
      osc.stop(ctx.currentTime + 0.08)
    } else if (type === 'chime') {
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(ctx.destination)
      osc1.frequency.setValueAtTime(1200, ctx.currentTime)
      osc2.frequency.setValueAtTime(1500, ctx.currentTime)
      gain.gain.setValueAtTime(0.06, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc1.start()
      osc2.start()
      osc1.stop(ctx.currentTime + 0.35)
      osc2.stop(ctx.currentTime + 0.35)
    } else if (type === 'error') {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(150, ctx.currentTime)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    }
  } catch (e) {
    // Silently ignore — browser autoplay policy may block this
  }
}

/**
 * Parses a localized locale date string (containing Arabic-indic digits or
 * standard English digits) or ISO timestamp into a standard JS Date object.
 * Supporting formats like "19/7/2026 12:01:59 PM", "١٩‏/٧‏/٢٠٢٦ ١٢:٠١:٥٩ ص", "2026-07-19 12:01:59".
 */
export function parseLocaleDateString(str) {
  if (!str) return null
  let clean = normalizeDigits(str.toString())
  clean = clean.replace(/[\u200e\u200f]/g, '') // Remove RTL/LTR marks

  const dateMatch = clean.match(/(\d+)[/-](\d+)[/-](\d+)/)
  if (!dateMatch) return null

  let day, month, year
  if (dateMatch[1].length === 4) {
    year = parseInt(dateMatch[1], 10)
    month = parseInt(dateMatch[2], 10) - 1
    day = parseInt(dateMatch[3], 10)
  } else {
    day = parseInt(dateMatch[1], 10)
    month = parseInt(dateMatch[2], 10) - 1
    year = parseInt(dateMatch[3], 10)
  }

  let hours = 0,
    minutes = 0,
    seconds = 0
  const timeMatch = clean.match(/(\d+):(\d+):?(\d+)?/)
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10)
    minutes = parseInt(timeMatch[2], 10)
    if (timeMatch[3]) seconds = parseInt(timeMatch[3], 10)
  }

  const isPM = clean.includes('م') || clean.toLowerCase().includes('pm')
  const isAM = clean.includes('ص') || clean.toLowerCase().includes('am')
  if (isPM && hours !== 12) hours += 12
  if (isAM && hours === 12) hours = 0

  return new Date(year, month, day, hours, minutes, seconds)
}

/**
 * Returns standard YYYY-MM-DD HH:mm:ss format for local date time.
 */
export function getNowStr(d = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Maps SQLite DB and network errors to friendly Arabic messages for display.
 */
export function getFriendlyErrorMessage(err) {
  if (!err) return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
  const msg = err.message || err.toString()
  if (msg.includes('UNIQUE constraint failed: clients.phone')) {
    return 'خطأ: رقم هاتف العميل هذا مسجل بالفعل لعميل آخر.'
  }
  if (msg.includes('UNIQUE constraint failed: suppliers.phone')) {
    return 'خطأ: رقم هاتف المورد هذا مسجل بالفعل لمورد آخر.'
  }
  if (msg.includes('UNIQUE constraint failed: products.barcode')) {
    return 'خطأ: رمز الباركود هذا مسجل بالفعل لمنتج آخر.'
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return 'خطأ: لا يمكن إتمام العملية أو الحذف لارتباط هذا السجل ببيانات أخرى مسجلة بالنظام.'
  }
  if (
    msg.includes('prevent_negative_stock') ||
    msg.includes('نفاد الكمية') ||
    msg.includes('stock')
  ) {
    return 'خطأ: كمية الصنف المطلوبة غير متوفرة بالكامل في المخزن.'
  }
  if (
    msg.includes('prevent_sale_on_closed_shift') ||
    msg.includes('وردية مغلقة') ||
    msg.includes('closed')
  ) {
    return 'خطأ: لا يمكن التسجيل لأن الوردية مغلقة حالياً. يرجى فتح وردية جديدة.'
  }
  if (msg.includes('prevent_multiple_open_shifts') || msg.includes('وردية مفتوحة بالفعل')) {
    return 'خطأ: يوجد وردية مفتوحة بالفعل لهذا المستخدم.'
  }
  return msg || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.'
}

/**
 * Rounds a number to exactly 2 decimal places to avoid floating-point inaccuracies.
 */
export function round2(n) {
  const val = parseFloat(n) || 0
  return Math.round((val + Number.EPSILON) * 100) / 100
}

/**
 * Formats a number to a money string (e.g., 1,234.56).
 */
export function formatMoney(amount) {
  return (parseFloat(amount) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}
