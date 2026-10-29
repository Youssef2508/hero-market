// Using the whole program from the keyboard (owner, 2026-10-21, D-065).
//
// - Forms that move money or stock (`<form data-enter-step>`): Enter in a field goes to the next
//   field, and from the last field to the confirm button. Only Enter on that button – a second,
//   deliberate key – carries the action out; a stray Enter while typing an amount never does.
//   Lists with their own Enter (the product search, role="combobox") keep it.
// - Table rows that open something (`rowKeys(open)`): reachable by Tab, Enter or Space opens,
//   ↑ and ↓ move to the row above or below.
// - Groups of choices (1.5.2, D-093): in a radio group (segmented buttons), a tab list, a menu
//   and the sidebar, the arrow keys move between the items (roving focus, right to left: ← is the
//   next item), Home and End go to the first and last. In a radio group and a tab list the item
//   reached is also chosen, as standard radios and tabs do; in a menu or the sidebar Enter opens it.
//   Text fields keep their arrows; nothing here runs while typing.
// The windows' own keys (Tab stays inside, Esc closes, focus returns) are in modalChrome.js.

const FIELDS =
  'input:not([type=hidden]):not([type=button]):not([type=submit]):not([disabled]):not([readonly]),' +
  'select:not([disabled])'

const visible = (el) => el.getClientRects().length > 0

function stepEnter(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.isComposing) return
  const field = e.target
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return
  if (field.getAttribute('role') === 'combobox') return
  const form = field.closest('form[data-enter-step]')
  if (!form) return
  e.preventDefault()
  const fields = [...form.querySelectorAll(FIELDS)].filter(
    (f) => visible(f) && f.closest('form') === form
  )
  const next =
    fields[fields.indexOf(field) + 1] ||
    [...form.querySelectorAll('button[type=submit]:not([disabled])')].find(visible)
  next?.focus()
  next?.select?.()
}

// Item selector per group kind; `choose`: the item reached is also selected (radios, tabs).
const GROUPS = [
  { group: '[role=radiogroup]', item: '[role=radio]', choose: true },
  { group: '[role=tablist]', item: '[role=tab]', choose: true },
  { group: '[role=menu]', item: '[role=menuitem]', choose: false, vertical: true },
  { group: '.sidebar-nav', item: '.nav-item', choose: false, vertical: true },
  // The till: payment methods (a press chooses; arrows only move) and the customer matches.
  // Quick-period buttons and similar button rows (role=group).
  { group: '.segmented[role=group]', item: 'button', choose: false },
  { group: '.pay-grid', item: '.pay-option', choose: false },
  { group: '.client-results', item: '.client-result', choose: false, vertical: true }
]

function roveArrows(e) {
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const el = document.activeElement
  if (!el || el.matches('input:not([type=radio]):not([type=checkbox]), textarea, select')) return
  for (const g of GROUPS) {
    const group = el.closest(g.group)
    if (!group || !el.matches(g.item)) continue
    const items = [...group.querySelectorAll(g.item)].filter(
      (x) => visible(x) && !x.disabled && x.closest(g.group) === group
    )
    const i = items.indexOf(el)
    if (i === -1 || items.length < 2) return
    const rtl = getComputedStyle(group).direction === 'rtl'
    let next = null
    if (e.key === 'Home') next = items[0]
    else if (e.key === 'End') next = items.at(-1)
    else {
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      // A vertical list (menu, sidebar) leaves ← and → alone.
      if (horizontal && g.vertical) return
      const forward = horizontal ? (e.key === 'ArrowLeft') === rtl : e.key === 'ArrowDown'
      next = items[(i + (forward ? 1 : -1) + items.length) % items.length]
    }
    e.preventDefault()
    next.focus()
    if (g.choose && next !== el) next.click()
    return
  }
}

export function installKeyboard() {
  if (window.__heroKeyboard) return
  window.__heroKeyboard = true
  // Capture: before the form's implicit submission.
  document.addEventListener('keydown', stepEnter, true)
  // Bubbling: a component's own handler runs first and may keep the key (preventDefault).
  document.addEventListener('keydown', roveArrows)
}

/** Props that make a clickable table row usable from the keyboard. */
export function rowKeys(open) {
  return {
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const row =
          e.key === 'ArrowDown'
            ? e.currentTarget.nextElementSibling
            : e.currentTarget.previousElementSibling
        row?.focus()
      }
    }
  }
}
