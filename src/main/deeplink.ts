// ============================================================================
// deeplink — parse the Telegram bridge return that arrives via the
// `mockstream://` custom protocol.
// ----------------------------------------------------------------------------
// The tg-login.html bridge bounces back to `mockstream://tg-auth` with the
// signed Telegram user payload appended as `#tgAuthResult=<base64url(JSON)>`
// (or, defensively, `?tgAuthResult=`). On Windows the OS hands the whole URL to
// the app as a command-line argument; macOS delivers it via the `open-url`
// event. These pure helpers keep the parsing unit-testable.
// ============================================================================

/** Extract the raw (still URL-encoded) tgAuthResult payload from a
 *  mockstream:// deep-link URL, or null when the URL carries no payload. */
export function extractTgAuthPayload(url: string): string | null {
  if (!url) return null
  const m = url.match(/[#&?]tgAuthResult=([^&#]+)/)
  return m ? m[1] : null
}

/** Find the first `mockstream://` URL in a process argv array (Windows delivers
 *  the deep link as a launch argument). Returns null when none is present. */
export function deepLinkArg(argv: readonly string[]): string | null {
  for (const a of argv) {
    if (typeof a === 'string' && a.startsWith('mockstream://')) return a
  }
  return null
}
