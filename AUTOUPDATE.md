# Auto-update (Mock Stream desktop)

The installed Windows app updates itself in the background via
[`electron-updater`](https://www.electron.build/auto-update). No more manual
reinstalls after each change.

## Two stores, and why (2026-09-12)

Installers are served from **Cloudflare R2** (`audio.mock-stream.com/desktop/<centre>/`)
because R2 charges nothing for egress and a desktop installer is 100–226 MB. The **update
feeds stay on GCS** and must: every app already installed polls `latest.yml` at the address
baked into its own build, and that address cannot be changed retroactively.

So a release goes to **both** — `scripts/upload-release.mjs` uploads to GCS and, when the
R2 credentials are present, to R2 as well. The download pages read `latest.yml` from the
bucket they are served from, then HEAD the R2 copy and use it only if it is there, falling
back to GCS otherwise.

### `publish.url` — moved one centre at a time

The order that must hold: R2 credentials working → ship that centre's release → confirm its
`latest.yml` **and the installer it names** are on R2 → only then switch that centre's
`publish.url`. Switching first would leave newly installed apps polling an address with no
feed — the newest users worst off, and silently.

**Mock Stream: switched 2026-09-12** after 1.0.141 was verified live on R2 (feed 200,
`version: 1.0.141`, and a range request on `MockStream-Setup-1.0.141.exe` returning 206 /
105,282,646 bytes — the same size GCS serves).

**The six clones still point at their GCS buckets**, because R2 has no feed for them yet
(`desktop/<centre>/latest.yml` is 404 for all six). Each clone's `publish.url` moves as part
of that clone's own release — `npm run release:<clone>` uploads to R2 in the same run, so the
feed exists by the time any app built from it is installed. `electron-builder.preview.yml`
stays on GCS for the same reason.

⚠️ Don't trust "build OK". Verify the feed **and** range-request the installer it names: in
August two clones published a `latest.yml` whose `version:` looked right but whose `url:`
named another clone's installer — a 404 for every updating app. Only the range check catches
that.

⚠️ `setx` does not reach an already-open shell. `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`
can be set at User scope and still be invisible to the terminal running the release, in which
case `upload-release.mjs` skips R2 with a warning and exits 0 — a release that looks fine and
never reached R2. Load them in the same command:
`$env:R2_ACCESS_KEY_ID = [Environment]::GetEnvironmentVariable('R2_ACCESS_KEY_ID','User')`

## How it works
- The packaged app reads an update **feed** from the address baked into its own build
  (the `publish` block in its `electron-builder*.yml`):
  Mock Stream → `https://audio.mock-stream.com/desktop/mockstream` (R2, since 1.0.141);
  the six clones → `https://storage.googleapis.com/<clone>-desktop-releases` (GCS, until each
  clone's next release). Both stores receive every release either way.
- It checks `latest.yml` there **on launch, every 6 hours, and whenever you click
  back into the app window** (focus, throttled to once a minute). If a newer
  version exists, it downloads the installer in the background and shows an
  in-app **"Update ready — Restart to update / Later"** banner; "Later" still
  installs it the next time the app is closed — so it never interrupts an exam.
- Update verification uses the sha512 in `latest.yml`, so this works while the
  app is still **unsigned**. (A code-signing cert later only removes the
  Windows SmartScreen prompt — it isn't required for updating.)
- Dev runs (`npm run dev`) skip updating entirely (`app.isPackaged` is false).

## Publishing a new version (the only steps for each change)
1. **Bump the version** in `package.json` (e.g. `1.0.0` → `1.0.1`). Auto-update
   only triggers when the feed version is **higher** than the installed one.
2. **Build + upload in one command:**
   ```
   npm run release
   ```
   This runs `npm run dist` (rebuilds the runner + packages the installer) then
   `scripts/upload-release.mjs`, which uploads `latest.yml`,
   `MockStream-Setup-<ver>.exe` and its `.blockmap` to the bucket.
   - Already built? Just upload: `npm run publish:feed`.
3. Done. Every installed app picks up the new version on its next check and
   installs it on quit.

Requires the `gcloud` CLI authenticated to the `mock-stream-audio` project.

## One-time migration
Auto-update only works for apps **installed from a build that already contains
the updater**. Install the current `dist/MockStream-Setup-1.0.0.exe` **once**
more — from then on, every future change arrives automatically.

## macOS note
macOS auto-update is **not enabled yet**: Gatekeeper requires the app to be
code-signed **and notarized** (free with the existing Apple Developer
membership) or it refuses to run an updated build. Wire that when the `.dmg`
target is built. Windows is unaffected.
