// Release guard: the desktop app bundles ../mockstream-runner as checked out.
// Refuse to build unless that checkout carries the mock-content release
// (runner plan-2-apps-bundle, commit REQUIRED or a descendant) and carries no
// unreleased web-prototype work: speaking-web-proto was merged into
// plan-2-apps-bundle at RELEASED_TIPS for desktop 1.1.11; anything newer on that
// branch inside HEAD is refused.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = '365fdde'; // runner: apps bundle (desktop 1.1.11)
const FORBIDDEN_BRANCHES = ['speaking-web-proto'];
// Branch tips already released in the app (merged on purpose, 1.1.11).
const RELEASED_TIPS = { 'speaking-web-proto': '57fee5b' };
const runner = resolve(process.env.RUNNER_DIR || '../mockstream-runner');
const fail = (m) => { console.error(`[check-runner] ${m}\n  runner: ${runner}`); process.exit(1); };
const git = (...a) => execFileSync('git', ['-C', runner, ...a], { encoding: 'utf8' }).trim();

const mc = resolve(runner, 'src/lib/mockContent.ts');
if (!existsSync(mc) || !readFileSync(mc, 'utf8').includes('RefusedError')) {
  fail('runner has no src/lib/mockContent.ts with RefusedError: wrong branch? check out plan-2-apps-bundle');
}
try {
  execFileSync('git', ['-C', runner, 'merge-base', '--is-ancestor', REQUIRED, 'HEAD']);
} catch {
  fail(`runner HEAD does not contain ${REQUIRED} (check out plan-2-apps-bundle; CI needs fetch-depth: 0)`);
}
for (const b of FORBIDDEN_BRANCHES) {
  let tip = '';
  try { tip = git('rev-parse', '--verify', '--quiet', b); } catch { continue; }
  let inHead = false;
  try { execFileSync('git', ['-C', runner, 'merge-base', '--is-ancestor', tip, 'HEAD']); inHead = true; } catch {}
  const released = RELEASED_TIPS[b] ? git('rev-parse', RELEASED_TIPS[b]) : ''
  if (inHead && tip !== git('rev-parse', REQUIRED) && tip !== released) fail(`runner HEAD contains unreleased branch ${b}`);
}
console.log(`[check-runner] ok: ${git('rev-parse', '--short', 'HEAD')} (${(() => { try { return git('rev-parse', '--abbrev-ref', 'HEAD'); } catch { return '?'; } })()})`);
