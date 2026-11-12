// A page left open on a phone while the cloud is updated (architecture §14.1, D-105). The cloud
// names its version on every answer; when it differs from this page's own, the page reloads at
// the next change of screen – never in the middle of a form – and comes back as the new version.
// In the desktop program nothing is ever marked: the program and its service are one installation.

let own = null
let newer = false

/** This page's version (the browser bridge sets it from the build). */
export function setOwnVersion(version) {
  own = version || null
}

/** The cloud answered with this version (the browser bridge reports each answer's). */
export function noteServerVersion(version) {
  if (own && version && version !== own) newer = true
}

/** Before showing another screen: reload when a newer version is waiting. True when it does. */
export function reloadIfUpdated(reload = () => window.location.reload()) {
  if (!newer) return false
  newer = false
  reload()
  return true
}
