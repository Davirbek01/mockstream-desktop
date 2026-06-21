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

## Status
- ✅ Build pipeline is signing-ready (`electron-builder.yml` reads `CSC_LINK`/`CSC_KEY_PASSWORD`).
- ⛔ Not signed yet — provide a certificate as above.
