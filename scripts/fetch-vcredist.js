// Fetch Microsoft's Visual C++ Redistributable (x64) for the Windows installer (1.4.0).
//
// The bundled PostgreSQL programs (initdb, pg_ctl, postgres) need the Visual C++ runtime DLLs. A
// clean Windows does not have them: the tools then exit with 0xC0000135 (DLL not found) and the
// store's database cannot be created. The installer runs this redistributable silently when the
// runtime is missing (build/installer.nsh). Central installation, as Microsoft recommends, keeps
// the DLLs serviced by Windows Update.
//
// The file is downloaded from Microsoft at build time (it is not kept in git) and accepted only
// with a valid Authenticode signature from Microsoft Corporation.
'use strict'
const fs = require('fs')
const path = require('path')
const https = require('https')
const { execFileSync } = require('child_process')

// Not called URL: that name would hide the URL class used to follow Microsoft's redirects.
const SOURCE = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
const target = path.join(__dirname, '..', 'build', 'vcredist', 'vc_redist.x64.exe')

function download(url, to, redirects = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects > 5) return reject(new Error('too many redirects'))
          return resolve(download(new URL(res.headers.location, url).href, to, redirects + 1))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        const out = fs.createWriteStream(to)
        res.pipe(out)
        out.on('finish', () => out.close(resolve))
        out.on('error', reject)
      })
      .on('error', reject)
  })
}

function signer(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`
  // Started from PowerShell 7 (the CI runner's shell), Windows PowerShell inherits a PSModulePath
  // naming PowerShell 7's modules and cannot load its own Get-AuthenticodeSignature: it then finds
  // its modules by itself, without that variable.
  const env = { ...process.env }
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k]
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    env
  }).trim()
}

function verified(file) {
  const [status, subject = ''] = signer(file).split('|')
  return status === 'Valid' && /O=Microsoft Corporation/.test(subject)
}

;(async () => {
  if (process.platform !== 'win32') {
    console.log('[vcredist] not on Windows: skipped (the Windows installer is built on Windows)')
    return
  }
  if (fs.existsSync(target) && verified(target)) {
    console.log(`[vcredist] present and signed by Microsoft: ${target}`)
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.download`
  console.log(`[vcredist] downloading ${SOURCE}`)
  await download(SOURCE, tmp)
  if (!verified(tmp)) {
    fs.rmSync(tmp, { force: true })
    throw new Error('vc_redist.x64.exe is not validly signed by Microsoft Corporation; refused')
  }
  fs.renameSync(tmp, target)
  console.log(`[vcredist] saved and verified: ${target}`)
})().catch((e) => {
  console.error(`[vcredist] ${e.message}`)
  process.exit(1)
})
