// ============================================================================
// scripts/upload-release.mjs — publish the built installer + update feed to GCS.
// ----------------------------------------------------------------------------
// Run AFTER `npm run dist` (or via `npm run release`, which does both). Uploads
// the three files electron-updater needs from dist/ to the public release
// bucket:  latest.yml  +  MockStream-Setup-<ver>.exe  +  its .blockmap
//
//   • latest.yml      → no-cache, so installed apps always see the newest version
//   • the .exe/.blockmap → short cache (filenames are version-stamped anyway)
//
// Requires the `gcloud` CLI authenticated to the mock-stream-audio project
// (same auth the rest of the project uses).
// ============================================================================
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BUCKET = 'gs://mockstream-desktop-releases'
const dist = join(process.cwd(), 'dist')

if (!existsSync(join(dist, 'latest.yml'))) {
  console.error('✗ dist/latest.yml not found — run `npm run dist` first.')
  process.exit(1)
}

const files = readdirSync(dist).filter(
  (f) => f === 'latest.yml' || /^MockStream-Setup-.*\.exe(\.blockmap)?$/.test(f),
)

for (const f of files) {
  const src = join(dist, f)
  const cache = f === 'latest.yml' ? 'no-cache,max-age=0' : 'public,max-age=300'
  console.log(`↑ ${f}`)
  execFileSync('gcloud', ['storage', 'cp', src, `${BUCKET}/`, `--cache-control=${cache}`], {
    stdio: 'inherit',
    shell: true,
  })
}

console.log(`\n✓ Published ${files.length} file(s) to ${BUCKET}`)
console.log('  Installed apps will pick up the new version on their next check (and install on quit).')
