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

const dirty = new WeakSet()
let asking = false

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

  const scan = () =>
    document.querySelectorAll('.modal-overlay:not([data-modal-chrome])').forEach(addCloseButton)
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
  scan()

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
