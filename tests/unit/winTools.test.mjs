// Regression tests for the installation failure on the owner's laptop (1.4.0 release checks): a
// Unix whoami.exe earlier on PATH (C:\WinAVR-20100110\utils\bin) answered instead of Windows' own,
// so the installer's setup could not read the user's SID and stopped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { systemTool, powershellExe } from '../../src/main/winTools.js'

const onWindows = process.platform === 'win32'

test('Windows tools are always taken from System32, never looked up on PATH', () => {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  assert.equal(systemTool('whoami.exe'), path.join(root, 'System32', 'whoami.exe'))
  assert.equal(systemTool('sc.exe'), path.join(root, 'System32', 'sc.exe'))
  assert.match(powershellExe(), /WindowsPowerShell\\v1\.0\\powershell\.exe$/)
  assert.throws(() => systemTool('..\\evil.exe'))
  assert.throws(() => systemTool('whoami'), 'a bare name without .exe is refused')
})

test('the laptop case: another whoami.exe first on PATH does not change what HeroMarket runs', (t) => {
  if (!onWindows) return t.skip('Windows only')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-path-'))
  try {
    // Any other program named whoami.exe placed first on PATH (here: Windows' hostname.exe, which
    // prints the computer name instead of a SID, like WinAVR's whoami prints something else).
    fs.copyFileSync(systemTool('hostname.exe'), path.join(dir, 'whoami.exe'))
    const env = { ...process.env, PATH: `${dir};${process.env.PATH}` }
    const byName = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], {
      env,
      encoding: 'utf8',
      shell: true
    })
    assert.doesNotMatch(
      `${byName.stdout}${byName.stderr}`,
      /S-1-5-/,
      'by name, the impostor answers (no SID: the failure seen on the laptop)'
    )
    const byPath = execFileSync(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      env,
      encoding: 'utf8'
    })
    assert.match(byPath, /"S-1-5-[0-9-]+"/, 'by full path, Windows answers with the SID')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('no main-process code starts a Windows tool by bare name', () => {
  const dir = path.join(import.meta.dirname, '..', '..', 'src', 'main')
  const offenders = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    const re =
      /\b(?:execFile|execFileSync|spawn|spawnSync|exec|execSync)\(\s*['"`](?:[a-z]+(?:\.exe)?)['"`]/gi
    for (const m of text.matchAll(re)) offenders.push(`${f}: ${m[0]}`)
  }
  assert.deepEqual(offenders, [])
})
