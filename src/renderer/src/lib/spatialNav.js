// Arrow keys between controls everywhere (keyboard-first, owner, 1.9.0, D-118).
//
// One rule for the whole program: an arrow key moves the keyboard focus to the nearest usable control
// in that direction ON THE SCREEN – right, left, up or down as the eye sees them, so it is correct in
// Arabic (right to left) without depending on the order of the page's code. A window that is open
// (.modal-overlay) is the only place it looks; behind it nothing is reachable.
//
// It never takes a key someone else needs:
//   - a component that handles the key first keeps it (the product list, a table row, a radio
//     group, a menu, a window's own buttons: they call preventDefault, see keyboard.js);
//   - in a text field ← and → move the caret, and leave the field only from its edge (the end of the
//     text in the direction of the key, an empty field, or text that is all selected); ↑ and ↓ leave
//     a one-line field (they do nothing in it) and a multi-line field only from its first/last line;
//   - a closed list box (<select>) is passed like a button – an arrow never changes its choice
//     unseen; Enter opens it and the arrows choose inside the open list;
//   - nothing happens with Ctrl, Alt, Shift or Meta, or while composing text.
// Tab and Shift+Tab are untouched; Enter is keyboard.js's.

const ACTIONABLE = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]'
].join(',')

/** A control the keyboard may land on: shown, enabled, not taken out of the Tab order. */
export function usable(el) {
  if (!(el instanceof HTMLElement)) return false
  if (el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true') return false
  if (el.tabIndex < 0) return false
  if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return false
  const st = getComputedStyle(el)
  if (st.visibility === 'hidden' || st.display === 'none') return false
  return true
}

/** Where focus may go now: the open window on top, or the whole page. */
export function scopeOf(doc = document) {
  const windows = [...doc.querySelectorAll('.modal-overlay')].filter(
    (w) => w.getClientRects().length > 0
  )
  return windows.at(-1) || doc.body
}

const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/**
 * The best control in `dir` from rectangle `from` among `items` (each { el, r }). Controls that
 * overlap `from` across the direction (the same row for ← →, the same column for ↑ ↓) come first,
 * nearest first; otherwise, among the controls that lie mostly in that direction (within 45°), the
 * nearest by distance along the direction plus twice the distance across it. A tie goes to the first in the page's order (reading order: right to left in Arabic).
 * Exported for the tests.
 */
export function pick(from, items, dir, { cone = true } = {}) {
  const horizontal = dir === 'left' || dir === 'right'
  let best = null
  let bestScore = Infinity
  for (const it of items) {
    const r = it.r
    // How far ahead the candidate is (its near edge past our far edge), with a little tolerance for
    // controls that touch or overlap.
    let ahead
    if (dir === 'left') ahead = from.left - r.right
    else if (dir === 'right') ahead = r.left - from.right
    else if (dir === 'up') ahead = from.top - r.bottom
    else ahead = r.top - from.bottom
    const centerAhead =
      dir === 'left'
        ? from.left + from.width / 2 - (r.left + r.width / 2)
        : dir === 'right'
          ? r.left + r.width / 2 - (from.left + from.width / 2)
          : dir === 'up'
            ? from.top + from.height / 2 - (r.top + r.height / 2)
            : r.top + r.height / 2 - (from.top + from.height / 2)
    if (ahead < -Math.min(8, (horizontal ? from.width : from.height) / 2) || centerAhead <= 1)
      continue
    // Across the direction: 0 when the two overlap, else the gap.
    const across = horizontal
      ? Math.max(0, Math.max(from.top, r.top) - Math.min(from.bottom, r.bottom))
      : Math.max(0, Math.max(from.left, r.left) - Math.min(from.right, r.right))
    const acrossCenters = horizontal
      ? Math.abs(from.top + from.height / 2 - (r.top + r.height / 2))
      : Math.abs(from.left + from.width / 2 - (r.left + r.width / 2))
    const overlap = across === 0
    // Not on the same row (column): it must lie mostly in the key's direction, within 45° – a control
    // far below and a little to the right is not "to the right".
    if (cone && !overlap && centerAhead < acrossCenters) continue
    const score = (overlap ? 0 : 100000) + Math.max(0, ahead) + 2 * across + acrossCenters / 10
    if (score < bestScore) {
      bestScore = score
      best = it.el
    }
  }
  return best
}

/** Should this arrow key stay with the text field (caret movement)? */
function fieldKeeps(el, dir) {
  // A closed list box is passed like a button (an arrow would change its choice unseen); Enter opens
  // it (keyboard.js) and its arrows then choose inside the open list.
  if (el instanceof HTMLSelectElement) return el.multiple || el.size > 1
  const textual =
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color', 'range'].includes(
        el.type
      ))
  if (!textual) return el.isContentEditable
  if (el instanceof HTMLInputElement && el.type === 'number' && (dir === 'up' || dir === 'down'))
    return true
  let start, end
  try {
    start = el.selectionStart
    end = el.selectionEnd
  } catch {
    return false // a type without a caret (date, …): arrows go to the field's own picker
  }
  if (start === null) return false
  const len = el.value.length
  if (len === 0) return false
  if (start === 0 && end === len) return false // all selected: the whole field is the "cursor"
  if (dir === 'up' || dir === 'down') {
    if (!(el instanceof HTMLTextAreaElement)) return false
    const before = el.value.slice(0, start)
    const after = el.value.slice(end)
    return dir === 'up' ? before.includes('\n') : after.includes('\n')
  }
  if (start !== end) return true
  // ← and → in the field's own direction: in a right-to-left field ← moves toward the end of the
  // text. The caret leaves only from the end it is moving toward.
  const rtl = getComputedStyle(el).direction === 'rtl'
  const towardEnd = (dir === 'left') === rtl
  return towardEnd ? start < len : start > 0
}

// The program's areas: the top bar, the sidebar, the page itself (and the phone's bottom bar). An
// arrow stays in the area it starts in while that area has a control in that direction, and only
// then crosses to another: ← from the till's product field goes to the payment panel beside it, not
// to a top-bar button a little above; → (nothing more on the right in the page) goes to the sidebar.
const AREAS = '.topbar, .sidebar, .app-content, .phone-bar'
const areaOf = (el) => el.closest(AREAS)

/** Move the focus one step in `dir` from `el`. Returns the element focused, or null. */
export function moveFocus(el, dir, doc = document) {
  const scope = scopeOf(doc)
  const from = el.getBoundingClientRect()
  const items = []
  for (const c of scope.querySelectorAll(ACTIONABLE)) {
    if (c === el || c.contains(el) || !usable(c)) continue
    items.push({ el: c, r: c.getBoundingClientRect() })
  }
  // Within the area: the nearest in the key's direction (45°). Nothing there: the nearest in another
  // area (the top bar above the page, the sidebar beside it), wherever it is along that side.
  const area = areaOf(el)
  const same = area ? items.filter((it) => areaOf(it.el) === area) : items
  const others = area ? items.filter((it) => areaOf(it.el) !== area) : []
  const next = pick(from, same, dir) || pick(from, others, dir, { cone: false })
  if (!next) return null
  next.focus({ preventScroll: true })
  next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  // A field reached by the arrows: ready to type over (as Tab does).
  if (next instanceof HTMLInputElement && typeof next.select === 'function') {
    try {
      next.select()
    } catch {
      /* types without a selection */
    }
  }
  return next
}

export function onArrow(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.isComposing)
    return
  const dir = DIRS[e.key]
  if (!dir) return
  const el = document.activeElement
  if (!el || el === document.body) {
    // Nothing focused (a list that closed with the choice): the first control of the page itself,
    // not of the sidebar or the top bar.
    const scope = scopeOf()
    const page = scope === document.body ? document.querySelector('.app-content') || scope : scope
    const first = [...page.querySelectorAll(ACTIONABLE)].find(usable)
    if (first) {
      e.preventDefault()
      first.focus()
    }
    return
  }
  if (!scopeOf().contains(el)) return
  if (fieldKeeps(el, dir)) return
  if (moveFocus(el, dir)) e.preventDefault()
}
