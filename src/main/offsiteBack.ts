// ============================================================================
// offsiteBack — a way back into the app from a sign-in page.
// ----------------------------------------------------------------------------
// "Continue with Google" (and the Telegram bridge) navigate the MAIN window away
// from the runner: to Supabase → accounts.google.com, or to <site>/tg-login.html.
// The shell has no menu and no browser toolbar, so a student who changes their
// mind on Google's account picker had no way back short of quitting from the
// tray.
//
// While the main frame is on any page outside the runner's own origin, this
// draws a small "← Orqaga" button in the top-left corner and makes Esc /
// Alt+← do the same. Going back always loads the runner base URL (not
// history.back): the OAuth hop passes through redirects, so the previous
// history entry is not reliably the app.
//
// Exams never trigger it — every exam route lives on the runner origin.
// ============================================================================
import type { BrowserWindow } from 'electron'

/** True when `url` is an http(s) page outside the runner at `base`. The
 *  offline fallback (file://, no base) and the runner itself are never
 *  "offsite". Pure, unit-tested. */
export function isOffsite(url: string, base: string | null): boolean {
  if (!base || !url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return u.origin !== new URL(base).origin
  } catch {
    return false
  }
}

/** The script injected into an offsite page. The button sits in a closed
 *  shadow root on <html>, so the page's own CSS cannot restyle it and a page
 *  that rebuilds <body> (Google's account picker does) cannot remove it. */
export function backButtonScript(base: string, label: string): string {
  return `(() => {
  const ID = '__ms_offsite_back__';
  const base = ${JSON.stringify(base)};
  const mount = () => {
    if (document.getElementById(ID)) return;
    const host = document.createElement('div');
    host.id = ID;
    host.style.cssText = 'all:initial;position:fixed;top:14px;left:14px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ${JSON.stringify(label)};
    b.setAttribute('aria-label', ${JSON.stringify(label)});
    b.style.cssText = [
      'font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif',
      'color:#0f172a','background:#fff','border:1px solid #cbd5e1',
      'border-radius:999px','padding:9px 16px','cursor:pointer',
      'box-shadow:0 2px 10px rgba(15,23,42,.18)'
    ].join(';');
    b.onmouseenter = () => { b.style.background = '#f1f5f9'; };
    b.onmouseleave = () => { b.style.background = '#fff'; };
    b.onclick = () => { location.href = base; };
    root.appendChild(b);
    document.documentElement.appendChild(host);
  };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });
})();`
}

export const BACK_LABEL = '← Orqaga'

/** Wire the back affordance onto the main window. `getBase` returns the runner
 *  base URL currently served (null when on the offline fallback). */
export function attachOffsiteBack(win: BrowserWindow, getBase: () => string | null): void {
  const wc = win.webContents

  const goBack = (): void => {
    const base = getBase()
    if (base) void win.loadURL(base)
  }

  // dom-ready fires for every main-frame document, including each page of the
  // OAuth hop, so the button is back on every step.
  wc.on('dom-ready', () => {
    const base = getBase()
    const url = wc.getURL()
    if (!base || !isOffsite(url, base)) return
    wc.executeJavaScript(backButtonScript(base, BACK_LABEL)).catch(() => {})
  })

  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const back =
      (input.key === 'Escape' && !win.isFullScreen()) ||
      (input.key === 'ArrowLeft' && input.alt)
    if (!back || !isOffsite(wc.getURL(), getBase())) return
    e.preventDefault()
    goBack()
  })
}
