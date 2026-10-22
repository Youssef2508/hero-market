// Using the whole program from the keyboard (owner, 2026-10-21, D-065).
//
// - Forms that move money or stock (`<form data-enter-step>`): Enter in a field goes to the next
//   field, and from the last field to the confirm button. Only Enter on that button – a second,
//   deliberate key – carries the action out; a stray Enter while typing an amount never does.
//   Lists with their own Enter (the product search, role="combobox") keep it.
// - Table rows that open something (`rowKeys(open)`): reachable by Tab, Enter or Space opens,
//   ↑ and ↓ move to the row above or below.
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

export function installKeyboard() {
  if (window.__heroKeyboard) return
  window.__heroKeyboard = true
  // Capture: before the form's implicit submission.
  document.addEventListener('keydown', stepEnter, true)
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
