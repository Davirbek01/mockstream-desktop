// ============================================================================
// machineId — a stable, hardware-backed per-machine identifier.
// ----------------------------------------------------------------------------
// The runner's localStorage device id is wiped whenever the user clears app
// data / reinstalls, which orphans their guest results history. The OS machine
// GUID survives all of that, so we derive the desktop device id from it. We
// hash the raw GUID (salted, app-scoped) so the raw OS identifier never leaves
// the machine and can't be correlated across apps.
// ============================================================================
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

let cached: string | null = null

function rawMachineGuid(): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', windowsHide: true },
      )
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i)
      if (m) return m[1]
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' })
      const m = out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (m) return m[1]
    } else {
      try {
        return readFileSync('/etc/machine-id', 'utf8').trim()
      } catch {
        return readFileSync('/var/lib/dbus/machine-id', 'utf8').trim()
      }
    }
  } catch {
    /* fall through to empty — caller keeps the localStorage fallback */
  }
  return ''
}

/** Returns a 32-char app-scoped hash of the OS machine GUID, or '' if it can't
 *  be read (the renderer then falls back to its random localStorage id). */
export function getMachineId(): string {
  if (cached) return cached
  const raw = rawMachineGuid()
  if (!raw) return ''
  cached = createHash('sha256').update('mockstream:' + raw).digest('hex').slice(0, 32)
  return cached
}
