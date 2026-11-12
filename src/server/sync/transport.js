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

class InProcessTransport extends BaseTransport {
  constructor({ app, storeId, token }) {
    super()
    Object.assign(this, { app, storeId, token })
  }
  async call(op, body) {
    let res
    try {
      res = await this.app.inject({
        method: 'POST',
        url: `/api/${op}`,
        payload: body,
        headers: { authorization: `Bearer ${this.token}`, 'x-store-id': this.storeId }
      })
    } catch (e) {
      throw new TransportError(e.message)
    }
    return unwrap(res.statusCode, res.body ? JSON.parse(res.body) : null)
  }
}

class HttpTransport extends BaseTransport {
  constructor({ url, storeId, token, timeoutMs = 30000, fetchImpl = globalThis.fetch }) {
    super()
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url))
      throw new Error('The cloud address must use HTTPS.')
    Object.assign(this, { url: url.replace(/\/+$/, ''), storeId, token, timeoutMs, fetchImpl })
  }
  async call(op, body, { timeoutMs = this.timeoutMs } = {}) {
    let res
    try {
      res = await this.fetchImpl(`${this.url}/api/${op}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.token}`,
          'x-store-id': this.storeId
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (e) {
      throw new TransportError(e.message)
    }
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
