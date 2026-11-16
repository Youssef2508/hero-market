'use strict'
// A TCP proxy for the QA test stack (QA campaign 1.8.0): the test shop reaches the QA cloud through
// it, so the campaign can shape the link the way a shop's internet behaves:
//   pass      – everything goes through (optionally with latency each way);
//   cut       – every connection closed at once and new ones refused (the program or router
//               stops: the cloud sees the connection close);
//   blackhole – connections stay open but nothing goes through, and new ones hang (the Wi-Fi
//               drops: nobody tells the cloud, as on a real line).
// Listens on 127.0.0.1 only. Used by scripts/qa/stack-runner.js; never part of the product.
const net = require('net')

function createProxy({ listenPort, target, latencyMs = 0 }) {
  let mode = 'pass'
  const pairs = new Set()
  const delay = (fn) => (latencyMs ? setTimeout(fn, latencyMs) : fn())
  const server = net.createServer((client) => {
    if (mode === 'cut') return client.destroy()
    const upstream = net.connect(target)
    const pair = { client, upstream }
    pairs.add(pair)
    const forward = (from, to) =>
      from.on('data', (chunk) => {
        if (mode === 'pass') delay(() => to.writable && to.write(chunk))
        // blackhole: swallowed, nobody is told.
      })
    forward(client, upstream)
    forward(upstream, client)
    const end = () => {
      pairs.delete(pair)
      client.destroy()
      upstream.destroy()
    }
    client.on('close', end).on('error', end)
    upstream.on('close', end).on('error', end)
  })
  return {
    listen: () => new Promise((r) => server.listen(listenPort, '127.0.0.1', r)),
    set(next, opts = {}) {
      mode = next
      if (opts.latencyMs !== undefined) latencyMs = opts.latencyMs
      if (next === 'cut') for (const p of [...pairs]) (p.client.destroy(), p.upstream.destroy())
    },
    get mode() {
      return mode
    },
    close: () => {
      for (const p of [...pairs]) (p.client.destroy(), p.upstream.destroy())
      return new Promise((r) => server.close(r))
    }
  }
}

module.exports = { createProxy }
