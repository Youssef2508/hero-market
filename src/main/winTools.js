// Full paths of the Windows tools HeroMarket starts (1.4.0 release checks).
//
// A tool started by bare name ("whoami", "sc.exe") is looked up on PATH, and PATH may list other
// folders before Windows' own. On the owner's laptop, C:\WinAVR-20100110\utils\bin (a Unix toolset)
// comes before System32 and has its own whoami.exe: the installer's setup ran that one, got no SID
// and stopped. Starting tools by name from the elevated setup would also let any program placed
// earlier on PATH run with administrator rights. Every Windows tool is therefore started from
// %SystemRoot%\System32, never by name. (No Electron imports: tests use this module directly.)
import { join } from 'path'

function systemRoot() {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows'
}

/** Full path of a tool in %SystemRoot%\System32, e.g. systemTool('sc.exe'). */
export function systemTool(name) {
  if (!/^[\w.-]+\.exe$/i.test(name)) throw new Error(`Invalid tool name: ${name}`)
  return join(systemRoot(), 'System32', name)
}

/** Windows PowerShell 5.1, the one every Windows 10/11 has. */
export function powershellExe() {
  return join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}
