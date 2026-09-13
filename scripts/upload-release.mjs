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

// Project-local secrets, loaded before anything reads process.env below.
// Two Cloudflare accounts once shared ONE set of Windows-global R2_* variables,
// so configuring one project silently broke the other: on 2026-09-13 the global
// R2_ACCOUNT_ID was left pointing at the other account while the keys still
// belonged to Mock Stream, which yields a valid-looking S3 client aimed at the
// wrong endpoint — an upload that fails for a reason the error never names.
// This file WINS over the ambient environment on purpose: the ambient copy is
// exactly the part that goes stale. CI has no .env, so the GitHub Secrets in
// the release workflows keep working untouched.
const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
}

// Flavor-aware: a clone (e.g. bek) publishes to its OWN bucket + artifact prefix
// so its auto-update feed never crosses Mock Stream's. Defaults = Mock Stream.
//   RELEASE_BUCKET=gs://bekzods-desktop-releases RELEASE_PREFIX=Bekzods-Setup
const BUCKET = process.env.RELEASE_BUCKET || 'gs://mockstream-desktop-releases'
const PREFIX = process.env.RELEASE_PREFIX || 'MockStream-Setup'
const dist = join(process.cwd(), 'dist')

// A Windows build leaves latest.yml; a macOS build leaves latest-mac.yml. Accept
// either so this guard doesn't reject a valid mac-only build (the bug that made
// the macOS CI publish step fail with "dist/latest.yml not found").
if (!existsSync(join(dist, 'latest.yml')) && !existsSync(join(dist, 'latest-mac.yml'))) {
  console.error('✗ No update feed (latest.yml / latest-mac.yml) found in dist/ — run `npm run dist` first.')
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
  `${PREFIX}-${version}.exe`,
  `${PREFIX}-${version}.exe.blockmap`,
  // macOS
  `${PREFIX}-${version}.dmg`,
  `${PREFIX}-${version}.dmg.blockmap`,
  `${PREFIX}-${version}.zip`,
  `${PREFIX}-${version}.zip.blockmap`,
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
  // `shell: true` joins these into a shell command line, so any path containing
  // spaces (e.g. a repo checked out under "Mock Stream Mega") MUST be quoted or
  // the shell re-splits it and gcloud sees several bogus source URLs.
  execFileSync('gcloud', ['storage', 'cp', `"${src}"`, `"${BUCKET}/"`, `--cache-control=${cache}`], {
    stdio: 'inherit',
    shell: true,
  })
}

console.log(`\n✓ Published ${files.length} file(s) to ${BUCKET}`)

// ── Cloudflare R2, in parallel with GCS ─────────────────────────────────────
// Downloads moved to R2 on 2026-09-12 (free egress; GCS egress was ~a third of
// the storage bill). GCS is NOT retired and must not be: every app installed
// before the switch polls its update feed at the GCS address baked into that
// build. So a release goes to BOTH — GCS for the installed base, R2 for the
// download pages and for builds published with publish.url pointing at R2.
//
// Uses R2's **S3 API**, not `wrangler` and not the Cloudflare v4 API. An R2
// token scoped to "Object Read & Write" grants exactly that — objects — and
// both of those paths first ask something broader (list buckets / account
// endpoints) and answer 403 "Authentication error" even though the token is
// perfectly valid. That cost an afternoon and two needlessly rolled tokens on
// 2026-09-12; the S3 endpoint is what R2 hands you those keys for.
//
// Skipped silently-but-loudly when the credentials are absent, so a release
// never fails because of this. Required to actually upload:
//   R2_RELEASE_PREFIX      e.g. desktop/mockstream   (no trailing slash)
//   R2_ACCESS_KEY_ID       \  the "Access Key ID" / "Secret Access Key" pair
//   R2_SECRET_ACCESS_KEY   /  shown when the R2 API token is created
//   R2_ACCOUNT_ID          the "Mock Stream" account id (not secret)
const R2_PREFIX   = process.env.R2_RELEASE_PREFIX || ''
const R2_BUCKET   = process.env.R2_BUCKET || 'mockstream-audio'
const R2_ACCOUNT  = process.env.R2_ACCOUNT_ID || '5ba79ef3e377250a69af22b372251686'
const haveR2Auth  = !!process.env.R2_ACCESS_KEY_ID && !!process.env.R2_SECRET_ACCESS_KEY

if (!R2_PREFIX || !haveR2Auth) {
  console.warn(
    '\n⚠️  R2 upload skipped — ' +
      (!R2_PREFIX ? 'R2_RELEASE_PREFIX not set' : 'R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not set') +
      '.\n   GCS has the release, so installed apps still update. But the download pages\n' +
      '   and any build whose publish.url points at R2 will NOT see this version.',
  )
} else {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  const TYPES = {
    '.exe': 'application/x-msdownload',
    '.dmg': 'application/x-apple-diskimage',
    '.zip': 'application/zip',
    '.yml': 'text/yaml; charset=utf-8',
    '.blockmap': 'application/octet-stream',
  }
  let r2ok = 0
  for (const f of files) {
    const key = `${R2_PREFIX.replace(/\/$/, '')}/${f}`
    // A version-stamped installer never changes; a feed must never be cached,
    // or an app checks for updates and is told about the previous release.
    const cache = FEEDS.includes(f) ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable'
    const ext = f.slice(f.lastIndexOf('.'))
    console.log(`↑ r2:${key}`)
    try {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: readFileSync(join(dist, f)),
        ContentType: TYPES[ext] || 'application/octet-stream',
        CacheControl: cache,
      }))
      r2ok++
    } catch (e) {
      // One failed object must not fail the release: GCS already has it.
      console.warn(`⚠️  R2 upload failed for ${f} — GCS copy stands. (${e.name}: ${e.message})`)
    }
  }
  console.log(`✓ Published ${r2ok}/${files.length} file(s) to r2://${R2_BUCKET}/${R2_PREFIX}`)
}

console.log('  Installed apps will pick up the new version on their next check (and install on quit).')
