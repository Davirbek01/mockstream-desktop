# Mock Stream Desktop

Electron desktop client (Windows + macOS) for the Mock Stream exam platform.
Third client alongside the web app and the React Native mobile app.

- v1 goal: secure exam mode (lockdown + cheat-detection) — see docs/.
- Backend is SHARED with web/mobile (Supabase + GCS). This repo is app code only.

## Develop
npm install
npm run dev

## Test
npm test         # unit (vitest)
npm run test:e2e # smoke (playwright)
