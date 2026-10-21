// Which start-up screen follows backend.status() when the store did not open. An installed shop
// whose own database failed (a failed preparation included) gets the store-problem screen with a
// retry, never the connection settings: another mode would not repair it (owner's laptop, 2026-10-16).
export function startupPhaseFor(status) {
  if (status && status.ready) return null
  return status && status.installedStore && status.errorCode ? 'store_problem' : 'connect'
}
