# Auto-update (Mock Stream desktop)

The installed Windows app updates itself in the background via
[`electron-updater`](https://www.electron.build/auto-update). No more manual
reinstalls after each change.

## How it works
- The packaged app reads an update **feed** from a public GCS bucket:
  `https://storage.googleapis.com/mockstream-desktop-releases`
  (configured as the `publish` block in `electron-builder.yml`).
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
