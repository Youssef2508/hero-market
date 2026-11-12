'use strict'
// How the PC's sync agent reaches the cloud. Only the PC opens connections (outbound HTTPS).
//   HttpTransport       – the real cloud (phase 5; nothing is hosted yet, D-043)
//   InProcessTransport  – a cloud service in the same process (tests, local test cloud)
// Both raise TransportError on any failure; the agent retries on its next cycle.

class TransportError extends Error {
  constructor(message, { status = 0, code = 'network' } = {}) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** What the cloud says about itself on every answer (architecture §14.1). */
function peerOf(get) {
  const schema = get('x-heromarket-schema')
  return schema
    ? { schema: String(schema), version: String(get('x-heromarket-version') || '') }
    : null
}

function unwrap(status, body) {
  if (status >= 200 && status < 300) return body
  throw new TransportError(body?.error?.message || `cloud answered ${status}`, {
    status,
    code: body?.error?.code || 'http'
  })
}

class BaseTransport {
  newEpoch() {
    return this.call('sync.epoch', {})
  }
  push(batch) {
    return this.call('sync.push', batch)
  }
  pullCommands(limit = 50) {
    return this.call('sync.commands', { limit }).then((r) => r.commands)
  }
  checksums() {
    return this.call('sync.checksums', {})
  }
  recoverRows(afterEpoch, afterVersion, limit = 2000) {
    return this.call('sync.recover', { afterEpoch, afterVersion, limit }).then((r) => r.rows)
  }
  // The request kept open to the cloud (D-101): returns the operations to carry out here, and
  // the ids of earlier ones whose outcome the cloud never heard.
  wait(body) {
    return this.call('link.wait', body, { timeoutMs: (body.timeoutMs ?? 25000) + 15000 })
  }
  results(body) {
    return this.call('link.results', body)
  }
  // The cloud's own changes, made while the shop was unreachable (D-103), and their receipt.
  fetch(body) {
    return this.call('link.fetch', body)
  }
  ack(body) {
    return this.call('link.ack', body)
  }
}

// Every request names the shop database's version (its latest migration): the cloud refuses a
// shop on another version rather than mix two shapes of the same tables (D-105).
const headersOf = (t) => ({
  authorization: `Bearer ${t.token}`,
  'x-store-id': t.storeId,
  ...(t.schema ? { 'x-heromarket-schema': t.schema } : {})
})

class InProcessTransport extends BaseTransport {
  constructor({ app, storeId, token, schema = null }) {
    super()
    Object.assign(this, { app, storeId, token, schema })
  }
  async call(op, body) {
    let res
    try {
      res = await this.app.inject({
        method: 'POST',
        url: `/api/${op}`,
        payload: body,
        headers: headersOf(this)
      })
    } catch (e) {
      throw new TransportError(e.message)
    }
    this.peer = peerOf((h) => res.headers[h]) || this.peer
    return unwrap(res.statusCode, res.body ? JSON.parse(res.body) : null)
  }
}

class HttpTransport extends BaseTransport {
  constructor({
    url,
    storeId,
    token,
    schema = null,
    timeoutMs = 30000,
    fetchImpl = globalThis.fetch
  }) {
    super()
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url))
      throw new Error('The cloud address must use HTTPS.')
    Object.assign(this, {
      url: url.replace(/\/+$/, ''),
      storeId,
      token,
      schema,
      timeoutMs,
      fetchImpl
    })
  }
  async call(op, body, { timeoutMs = this.timeoutMs } = {}) {
    let res
    try {
      res = await this.fetchImpl(`${this.url}/api/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersOf(this) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      throw new TransportError(e.message)
    }
    this.peer = peerOf((h) => res.headers.get(h)) || this.peer
    let json = null
    try {
      json = await res.json()
    } catch {
      /* empty or invalid body */
    }
    return unwrap(res.status, json)
  }
}

module.exports = { TransportError, InProcessTransport, HttpTransport }
