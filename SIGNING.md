# Code signing the Mock Stream desktop app (Windows)

The installer (`dist/Mock Stream Setup 1.0.0.exe`) currently ships **unsigned**, so the
first time a user runs it Windows shows **"Windows protected your PC / Unknown publisher"**
(SmartScreen). They can still install via **More info → Run anyway** — but signing removes
that warning and builds publisher trust.

Signing is **wired and ready**. It just needs a real certificate (which can't be faked — a
self-signed cert is NOT trusted by Windows and won't remove the warning).

## What you need
A **code-signing certificate** from a Certificate Authority (DigiCert, Sectigo, GlobalSign, …):

| Type | Cost (approx) | SmartScreen | Notes |
|------|---------------|-------------|-------|
| **OV** (Organization Validation) | ~$200–400/yr | trust builds up over downloads | usually requires a registered company; key on a hardware token/HSM since 2023 |
| **EV** (Extended Validation) | ~$300–700/yr | **instant** trust | requires a hardware USB token / cloud HSM + stricter company vetting |

(Apple/macOS is separate and already covered by your existing $99/yr Apple Developer
membership if you later build the `.dmg`.)

## How to sign once you have the cert

### OV cert as a `.pfx` file
```bat
set CSC_LINK=C:\path\to\your-cert.pfx
set CSC_KEY_PASSWORD=your-pfx-password
npm run dist
```
electron-builder picks these up automatically and signs the `.exe` + the NSIS installer. No
code change needed.

### EV cert on a hardware token / cloud HSM
EV keys can't be exported to a `.pfx`. Use the token vendor's signing tool via electron-builder's
custom sign hook, or a cloud-signing service (e.g. Azure Trusted Signing, DigiCert KeyLocker).
Set the appropriate `win.signtoolOptions` / `sign` hook in `electron-builder.yml` per the
vendor's docs, then `npm run dist`.

## Verifying a signed build
Right-click the produced `.exe` → **Properties → Digital Signatures** tab should list your
certificate. Or: `signtool verify /pa "dist\Mock Stream Setup 1.0.0.exe"`.

## Decision (2026-06-29): ship Windows UNSIGNED for now

A cert is **not required to install** — an unsigned build runs fine; Windows just shows the
SmartScreen **"Windows protected your PC / Unknown publisher"** popup, and the user clicks
**More info → Run anyway**. That's cosmetic friction, not a blocker.

Until the app has real paying users, the certificate cost isn't justified, so **v1 ships
unsigned**. The download page must carry a short reassurance note (see below). When revenue
supports it, add signing — recommended **Azure Trusted Signing (~$10/mo)**: cloud-based, no
hardware token, near-EV trust; the only hurdle is identity verification (registered business
with ~3 yrs history, or the individual-developer option). Once you have it, set the
`win.signtoolOptions` / cloud-sign hook and rebuild — existing users just get a cleaner update.

**Download-page note to include (TODO when the page is built):**
> ⚠️ On first run Windows may say *"Unknown publisher"*. This is normal for new apps — click
> **More info → Run anyway** to install. The app is safe.

## Status (Windows)
- ✅ Build pipeline is signing-ready (`electron-builder.yml` reads `CSC_LINK`/`CSC_KEY_PASSWORD`).
- ✅ **Decision made: ship unsigned for v1** (no cert cost pre-revenue). Add Azure Trusted Signing later.
- ⛔ Not signed — intentional for now. Plug in a cert (above) when revenue justifies it.

---

# Code signing + notarizing the macOS app

Distributed via **Developer ID + notarization (direct download)**, **not** the Mac App
Store — so Apple's App Store payment rules (Guideline 3.1.1 / IAP-only) do **not** apply.
Notarization is an automated malware/signing scan, not a content review: the code-unlock
inputs and purchase flows stay exactly as they are. (3.1.1 would only apply if you later
chose to publish on the Mac App Store.)

> macOS signing + notarization use `codesign` / `notarytool`, which are **macOS-only**.
> The Windows dev machine can't produce a signed Mac build, so it runs on a **macOS
> GitHub Actions runner** (`.github/workflows/release-mac.yml`) — manual trigger.

## One-time setup

### 1. Apple side (you already pay the $99/yr membership)
1. **Developer ID Application certificate** — developer.apple.com → Certificates → **+** →
   *Developer ID Application*. Create it, download the `.cer`, open it in Keychain Access,
   then export the cert **+ its private key** as a `.p12` (set an export password).
2. **App-specific password** — appleid.apple.com → *Sign-In & Security* → App-Specific
   Passwords → generate one (used by `notarytool`).
3. **Team ID** — developer.apple.com → *Membership* (10-char string).

### 2. GitHub repo secrets (Settings → Secrets and variables → Actions)
| Secret | Value |
|--------|-------|
| `MAC_CSC_LINK` | base64 of the `.p12` → `base64 -i cert.p12 \| pbcopy` (mac) or `certutil -encode` (win) |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 2 |
| `APPLE_TEAM_ID` | your 10-char Team ID |
| `GCP_SA_KEY` | JSON key of a GCP service account with write access to `gs://mockstream-desktop-releases` |
| `RUNNER_REPO_TOKEN` | PAT (repo read) to check out `mockstream-runner` — omit if that repo is public |

### 3. Release
Bump `version` in `package.json`, push, then **Actions → Release (macOS) → Run workflow**.
It builds a **universal** (Intel + Apple-Silicon) `.dmg` + `.zip`, notarizes them, and
publishes `latest-mac.yml` + the artifacts to the bucket. Installed Mac apps auto-update on
next launch (electron-updater), exactly like Windows.

## Verifying a signed/notarized build (on a Mac)
```bash
codesign -dv --verbose=4 "Mock Stream.app"      # shows the Developer ID authority
spctl -a -vvv -t install "Mock Stream.app"      # should say "accepted / Notarized Developer ID"
xcrun stapler validate "MockStream-Setup-<ver>.dmg"
```

## Status (macOS)
- ✅ `electron-builder.yml` mac block is notarization-ready (hardened runtime + entitlements + `notarize: true`).
- ✅ CI workflow `.github/workflows/release-mac.yml` builds/signs/notarizes/publishes.
- ⛔ Needs the 7 secrets above (Developer ID cert + Apple creds + GCP SA) before the first run.
