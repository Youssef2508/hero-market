/* eslint-disable */
// ─────────────────────────────────────────────────────────────
// HeroMarket icon generator.
// Rasterises resources/brand/heromarket-mark.svg with Electron's offscreen
// renderer (no extra dependencies) and writes:
//   resources/brand/png/heromarket-mark-<size>.png
//   resources/icon.png            (window icon, 512)
//   build/icon.png                (1024, electron-builder source)
//   build/icon.ico                (16–256, PNG-compressed entries)
//   build/icon.icns               (16–1024, PNG entries)
//   src/renderer/public/favicon.png (64)
//
// Run:  npm run icons
// (If ELECTRON_RUN_AS_NODE is set, the script relaunches itself under real Electron.)
// ─────────────────────────────────────────────────────────────
const electron = require('electron')
if (typeof electron === 'string') {
  // Running as plain Node: relaunch this file under the Electron runtime with the variable cleared.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const r = require('child_process').spawnSync(electron, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env
  })
  if (r.error) console.error('[icons] Failed to relaunch Electron:', r.error)
  process.exit(r.status ?? 1)
}
const { app, BrowserWindow } = electron
const os = require('os')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'resources', 'brand', 'heromarket-mark.svg')
const outPng = path.join(root, 'resources', 'brand', 'png')

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>${sized}</body></html>`
  const tmp = path.join(os.tmpdir(), `heromarket-icon-${size}.html`)
  fs.writeFileSync(tmp, html, 'utf8')
  await win.loadFile(tmp)
  await new Promise((r) => setTimeout(r, 150))
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  win.destroy()
  fs.unlinkSync(tmp)
  const s = img.getSize()
  if (s.width !== size || s.height !== size)
    img = img.resize({ width: size, height: size, quality: 'best' })
  return img.toPNG()
}

function buildIco(entries) {
  // entries: [{ size, png }]
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach((e, i) => {
    const b = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1)
    dir.writeUInt8(0, b + 2)
    dir.writeUInt8(0, b + 3)
    dir.writeUInt16LE(1, b + 4)
    dir.writeUInt16LE(32, b + 6)
    dir.writeUInt32LE(e.png.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

function buildIcns(entries) {
  // entries: [{ type, png }]
  const chunks = entries.map((e) => {
    const h = Buffer.alloc(8)
    h.write(e.type, 0, 'ascii')
    h.writeUInt32BE(e.png.length + 8, 4)
    return Buffer.concat([h, e.png])
  })
  const body = Buffer.concat(chunks)
  const h = Buffer.alloc(8)
  h.write('icns', 0, 'ascii')
  h.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([h, body])
}

// Each render destroys its window; keep the app alive between renders.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(svgPath, 'utf8')
    fs.mkdirSync(outPng, { recursive: true })
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    const pngs = {}
    for (const size of sizes) {
      pngs[size] = await render(svg, size)
      fs.writeFileSync(path.join(outPng, `heromarket-mark-${size}.png`), pngs[size])
    }
    fs.writeFileSync(path.join(root, 'resources', 'icon.png'), pngs[512])
    fs.writeFileSync(path.join(root, 'build', 'icon.png'), pngs[1024])
    fs.writeFileSync(
      path.join(root, 'build', 'icon.ico'),
      buildIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngs[size] })))
    )
    fs.writeFileSync(
      path.join(root, 'build', 'icon.icns'),
      buildIcns([
        { type: 'icp4', png: pngs[16] },
        { type: 'icp5', png: pngs[32] },
        { type: 'icp6', png: pngs[64] },
        { type: 'ic07', png: pngs[128] },
        { type: 'ic08', png: pngs[256] },
        { type: 'ic09', png: pngs[512] },
        { type: 'ic10', png: pngs[1024] }
      ])
    )
    const publicDir = path.join(root, 'src', 'renderer', 'public')
    fs.mkdirSync(publicDir, { recursive: true })
    fs.writeFileSync(path.join(publicDir, 'favicon.png'), pngs[64])
    console.log('[icons] Generated', sizes.join(', '), '+ icon.ico, icon.icns, favicon.png')
  } catch (e) {
    console.error('[icons] Failed:', e)
    process.exitCode = 1
  }
  app.quit()
})
