// Shared behaviour of every small window (1.4.0, owner's request).
//
// A window is a `.modal-overlay` holding a `.modal-content`. When the window has a button marked
// `data-modal-close` (its cancel / close button), it also gets:
//   - an X button in its corner (unless it already has its own `.modal-close`);
//   - closing by a click outside it, on the dimmed background (press and release both outside, so
//     selecting text inside and releasing outside does not close it).
// Both close the window the way its own button does, by clicking that button. If something was
// typed in the window, it first asks "إغلاق بدون حفظ؟". The window's own cancel button closes
// without asking, as before.
//
// Windows without a marked button stay as they are: they cannot be dismissed this way (for example
// opening a shift when it is required, or the recovery notice).
//
// Keyboard (owner, 2026-10-21, D-065): Esc closes the top window the same way (unless the window
// used Esc itself, for example to close a list inside it); Tab and Shift+Tab stay inside the top
// window; a window that opens takes the focus (its first field, else its cancel button, never a
// confirm button) and gives it back to where it was when it closes. The arrow keys move between
// its buttons (owner, 2026-10-22).

const dirty = new WeakSet()
let asking = false
const openers = new Map()
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
let lastOutside = null

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

function topOverlay() {
  let top = null
  let topZ = -Infinity
  for (const o of document.querySelectorAll('.modal-overlay')) {
    if (!o.getClientRects().length) continue
    const z = Number(getComputedStyle(o).zIndex) || 0
    if (z >= topZ) [top, topZ] = [o, z]
  }
  return top
}

function focusablesIn(overlay) {
  return [...overlay.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.getClientRects().length && el.closest('.modal-overlay') === overlay
  )
}

function focusInto(overlay) {
  if (!overlay.isConnected || overlay.contains(document.activeElement)) return
  const all = focusablesIn(overlay)
  const target =
    all.find((el) => el.matches('input:not([readonly]),select,textarea')) ||
    all.find((el) => el.matches('[data-modal-close]')) ||
    all.find((el) => !el.matches('.modal-close')) ||
    all[0]
  target?.focus()
}

function trackFocus() {
  for (const o of document.querySelectorAll('.modal-overlay:not([data-modal-chrome])')) {
    if (openers.has(o)) continue
    // A field with autoFocus already took the focus inside: the opener is the last one outside.
    const from = o.contains(document.activeElement) ? lastOutside : document.activeElement
    openers.set(o, from && !o.contains(from) ? from : null)
    // After React's own autoFocus, which wins.
    requestAnimationFrame(() => focusInto(o))
  }
  for (const [o, from] of openers) {
    if (o.isConnected) continue
    openers.delete(o)
    const lost = !document.activeElement || document.activeElement === document.body
    if (lost && from?.isConnected) from.focus()
  }
}

function onKeyDown(e) {
  if (asking) return
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
    const top = topOverlay()
    if (!top) return
    const list = focusablesIn(top)
    if (!list.length) return e.preventDefault()
    const i = list.indexOf(document.activeElement)
    const wrapTo =
      i === -1
        ? e.shiftKey
          ? list.at(-1)
          : list[0]
        : !e.shiftKey && i === list.length - 1
          ? list[0]
          : e.shiftKey && i === 0
            ? list.at(-1)
            : null
    if (wrapTo) {
      e.preventDefault()
      wrapTo.focus()
    }
  } else if (ARROWS.has(e.key) && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    // Arrows move between a window's buttons and checkboxes (owner, 2026-10-22). Text and number
    // fields, lists, dropdowns, radio groups and tabs keep their own arrows.
    const top = topOverlay()
    const el = document.activeElement
    if (!top || !el || !top.contains(el) || e.defaultPrevented) return
    const movable =
      el.matches('button, a[href], input[type=checkbox]') &&
      !el.closest('[role=tablist], [role=listbox], [role=menu], [role=radiogroup], tr[tabindex]')
    if (!movable) return
    // Only among buttons and checkboxes: an arrow never lands in a text field (which keeps its own).
    const list = focusablesIn(top).filter(
      (x) =>
        !x.matches('.modal-close') &&
        x.matches('button, a[href], input[type=checkbox]') &&
        !x.closest('[role=tablist], [role=listbox], [role=menu], [role=radiogroup], tr[tabindex]')
    )
    const i = list.indexOf(el)
    if (i === -1) return
    // Right to left: ← and ↓ go forward, → and ↑ go back.
    const rtl = getComputedStyle(top).direction === 'rtl'
    const forward = e.key === 'ArrowDown' || (rtl ? e.key === 'ArrowLeft' : e.key === 'ArrowRight')
    const next = list[(i + (forward ? 1 : -1) + list.length) % list.length]
    if (next && next !== el) {
      e.preventDefault()
      next.focus()
    }
  } else if (e.key === 'Escape') {
    const top = topOverlay()
    if (!top || top.matches('[data-modal-chrome]')) return
    // After the window's own handlers: a window (or a list in it) that used Esc keeps it.
    setTimeout(() => {
      if (!e.defaultPrevented && top.isConnected && topOverlay() === top) requestClose(top)
    }, 0)
  }
}

function closerOf(overlay) {
  const content = overlay.querySelector(':scope > .modal-content')
  if (!content) return null
  // The window's own button, not one of a window opened inside it.
  const button = [...content.querySelectorAll('[data-modal-close]')].find(
    (b) => b.closest('.modal-overlay') === overlay
  )
  return button ? { content, button } : null
}

function addCloseButton(overlay) {
  const found = closerOf(overlay)
  if (!found || found.content.querySelector('.modal-close')) return
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'icon-btn modal-close'
  x.setAttribute('aria-label', 'إغلاق')
  x.title = 'إغلاق'
  x.dataset.modalChrome = ''
  x.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  x.addEventListener('click', (e) => {
    e.preventDefault()
    requestClose(overlay)
  })
  // Appended last: React places its own children relative to its own nodes, so an extra node at
  // the end does not disturb it. The X is positioned absolutely in the corner.
  found.content.appendChild(x)
}

function askDiscard() {
  return new Promise((resolve) => {
    asking = true
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.dataset.modalChrome = ''
    overlay.style.zIndex = '200000'
    overlay.innerHTML = `
      <div class="modal-content tone-warning" role="alertdialog" aria-modal="true"
           aria-labelledby="discard-title" style="width: 400px">
        <div class="modal-header">
          <h2 id="discard-title">إغلاق بدون حفظ؟</h2>
          <p>ما كتبته في هذه النافذة لن يُحفظ.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-answer="stay">متابعة الكتابة</button>
          <button type="button" class="btn btn-danger" data-answer="close">إغلاق بدون حفظ</button>
        </div>
      </div>`
    const finish = (answer) => {
      window.removeEventListener('keydown', onKey, true)
      overlay.remove()
      asking = false
      resolve(answer)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(document.activeElement?.dataset?.answer === 'close')
      }
    }
    overlay.addEventListener('click', (e) => {
      const answer = e.target.closest('[data-answer]')?.dataset.answer
      if (answer) finish(answer === 'close')
      else if (e.target === overlay) finish(false)
    })
    window.addEventListener('keydown', onKey, true)
    document.body.appendChild(overlay)
    overlay.querySelector('[data-answer="stay"]').focus()
  })
}

async function requestClose(overlay) {
  if (asking) return
  const found = closerOf(overlay)
  if (!found || found.button.disabled) return
  if (dirty.has(found.content) && !(await askDiscard())) return
  if (found.button.isConnected && !found.button.disabled) found.button.click()
}

function markDirty(e) {
  if (!e.isTrusted || !(e.target instanceof Element)) return
  const content = e.target.closest('.modal-overlay:not([data-modal-chrome]) > .modal-content')
  if (content) dirty.add(content)
}

export function installModalChrome() {
  if (window.__heroModalChrome) return
  window.__heroModalChrome = true

  const scan = () => {
    document.querySelectorAll('.modal-overlay:not([data-modal-chrome])').forEach(addCloseButton)
    trackFocus()
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
  scan()
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener(
    'focusin',
    (e) => {
      if (e.target instanceof Element && !e.target.closest('.modal-overlay')) lastOutside = e.target
    },
    true
  )

  document.addEventListener('input', markDirty, true)
  document.addEventListener('change', markDirty, true)

  let pressedOn = null
  document.addEventListener(
    'mousedown',
    (e) => {
      pressedOn =
        e.button === 0 && e.target.matches?.('.modal-overlay:not([data-modal-chrome])')
          ? e.target
          : null
    },
    true
  )
  document.addEventListener(
    'mouseup',
    (e) => {
      const overlay = pressedOn
      pressedOn = null
      if (overlay && e.target === overlay) requestClose(overlay)
    },
    true
  )
}
