// Certificate pinning for cashier terminals talking to the store server over HTTPS (G-24).
//
// The store server's TLS proxy (Caddy, docker-compose.yml) issues its certificate from its own local
// root CA. Instead of installing that root into every till's Windows trust store, the till stores the
// root certificate in heromarket.json (`serverCaPem`) and accepts a server certificate only if:
//   – every certificate in the presented chain is signed by the next one, and the last by the pinned root;
//   – every certificate is within its validity period; and
//   – the leaf certificate is valid for the host name or IP address the till connects to.
// No Electron imports here, so the rules are unit-tested directly.
import { X509Certificate, createHash } from 'crypto'

/** SHA-256 fingerprint of a PEM certificate, as shown to the owner when pinning. */
export function fingerprint(pem) {
  const der = new X509Certificate(pem).raw
  return createHash('sha256').update(der).digest('hex').toUpperCase().match(/.{2}/g).join(':')
}

/** Parse and check a root certificate before it is pinned. */
export function describeRoot(pem) {
  const cert = new X509Certificate(pem)
  if (!cert.ca) throw new Error('الشهادة المختارة ليست شهادة جهة إصدار (CA).')
  return { subject: cert.subject, validTo: cert.validTo, fingerprint: fingerprint(pem) }
}

const within = (cert, now) => now >= new Date(cert.validFrom) && now <= new Date(cert.validTo)
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')

/**
 * @param {string[]} chainPems presented chain, leaf first (Electron: certificate → issuerCert → …)
 * @param {string} rootPem pinned root certificate
 * @param {string} host host name or IP of the server URL
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyPinnedChain(chainPems, rootPem, host, now = new Date()) {
  try {
    const root = new X509Certificate(rootPem)
    if (!root.ca) return { ok: false, reason: 'pinned certificate is not a CA' }
    if (!within(root, now)) return { ok: false, reason: 'pinned root expired' }
    const chain = chainPems
      .map((p) => new X509Certificate(p))
      .filter((c) => !c.raw.equals(root.raw))
    if (!chain.length) return { ok: false, reason: 'empty chain' }
    for (let i = 0; i < chain.length; i++) {
      const cert = chain[i]
      const issuer = chain[i + 1] || root
      if (!within(cert, now)) return { ok: false, reason: `certificate ${i} outside its validity` }
      if (i > 0 && !cert.ca) return { ok: false, reason: `certificate ${i} is not a CA` }
      if (!cert.verify(issuer.publicKey))
        return { ok: false, reason: `certificate ${i} not signed by its issuer` }
    }
    const leaf = chain[0]
    const matches = isIp(host) ? leaf.checkIP(host) : leaf.checkHost(host)
    if (!matches) return { ok: false, reason: `certificate not valid for ${host}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err.message }
  }
}
