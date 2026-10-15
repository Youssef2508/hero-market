// Event log, read through the HeroMarket service. Events are written by the service itself
// (every sensitive operation is audited server-side), so there is no client-side logEvent.
import { api } from '../api'

export async function getSystemLogs(limit = 100, offset = 0) {
  return (await api('logs.list', { limit: parseInt(limit), offset: parseInt(offset) })).rows
}
