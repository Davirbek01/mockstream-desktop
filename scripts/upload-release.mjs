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
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUCKET = 'gs://mockstream-desktop-releases'
const dist = join(process.cwd(), 'dist')

if (!existsSync(join(dist, 'latest.yml'))) {
  console.error('✗ dist/latest.yml not found — run `npm run dist` first.')
  process.exit(1)
}

// Publish ONLY the current version's artifacts (the feed + this build's
// installer/blockmap) — not the whole accumulated dist/ backlog. dist/ keeps
// every version ever built locally; re-uploading all of them made each release
// a ~40-min sync. electron-updater only needs the feed(s) + the versions named.
//
// Platform-agnostic: a Windows build leaves latest.yml + .exe (+ .blockmap); a
// macOS build (CI runner) leaves latest-mac.yml + .dmg + .zip (+ blockmaps). We
// upload whichever of these exist, so the same script serves both pipelines.
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const FEEDS = ['latest.yml', 'latest-mac.yml']
const candidates = new Set([
  ...FEEDS,
  // Windows
  `MockStream-Setup-${version}.exe`,
  `MockStream-Setup-${version}.exe.blockmap`,
  // macOS
  `MockStream-Setup-${version}.dmg`,
  `MockStream-Setup-${version}.dmg.blockmap`,
  `MockStream-Setup-${version}.zip`,
  `MockStream-Setup-${version}.zip.blockmap`,
])
const files = readdirSync(dist).filter((f) => candidates.has(f))

const installers = files.filter((f) => !FEEDS.includes(f))
if (!installers.length) {
  console.error(`✗ No v${version} installer artifacts found in dist/ — run \`npm run dist\` first.`)
  process.exit(1)
}

for (const f of files) {
  const src = join(dist, f)
  const cache = FEEDS.includes(f) ? 'no-cache,max-age=0' : 'public,max-age=300'
  console.log(`↑ ${f}`)
  execFileSync('gcloud', ['storage', 'cp', src, `${BUCKET}/`, `--cache-control=${cache}`], {
    stdio: 'inherit',
    shell: true,
  })
}

console.log(`\n✓ Published ${files.length} file(s) to ${BUCKET}`)
console.log('  Installed apps will pick up the new version on their next check (and install on quit).')
