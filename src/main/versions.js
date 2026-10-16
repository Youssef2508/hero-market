// Version order for safe updates (no Electron imports: tests use it directly).

/** Is version a newer than b? (1.4.1 > 1.4.0 > 1.4.0-test.1; unknown text is never "newer".) */
export function newerVersion(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(String(v || ''))
    return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] || null } : null
  }
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return false
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] > y.n[i]
  if (x.pre === y.pre) return false
  if (!x.pre) return true // a release is newer than its pre-releases
  if (!y.pre) return false
  return x.pre.localeCompare(y.pre, 'en', { numeric: true }) > 0
}
