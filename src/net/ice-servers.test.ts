/**
 * Nuketown 2025 — WAN ICE proof. Same dependency-free rules as the gun and
 * killstreak proofs: bundle with the repo's esbuild, run the bundle, a
 * thrown check is the failure. See docs/HANDOFF-PARITY.md for the command.
 *
 * What this pins: the default list is STUN-only (the effective list while
 * TURN is empty, so LAN/tabs behave as today); TURN assembles with and
 * without auth; an empty turnUrl yields no TURN entry; the sanitiser strips
 * evil URLs to '' and caps lengths; every entry is a structural RTCIceServer.
 */

import { DEFAULT_SETTINGS, DEFAULT_STUN_URL, iceServersFor, qualityOf, sanitizeSettings } from '../ui/settings';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`ice servers proof failed: ${name}`);
  passed += 1;
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- defaults: STUN-only, the effective list while TURN is empty -----------
check('STUN default is the documented host', DEFAULT_STUN_URL === 'stun:stun.l.google.com:19302');
check('TURN defaults to empty', DEFAULT_SETTINGS.turnUrl === '' && DEFAULT_SETTINGS.turnUsername === '' && DEFAULT_SETTINGS.turnCredential === '');
check('default list is STUN-only', eq(iceServersFor(DEFAULT_SETTINGS), [{ urls: ['stun:stun.l.google.com:19302'] }]));
check('sanitised-empty list is STUN-only', eq(iceServersFor(sanitizeSettings({})), [{ urls: ['stun:stun.l.google.com:19302'] }]));
check('ICE is not a graphics knob', qualityOf(DEFAULT_SETTINGS) === 'high');

// ---- TURN assembles, with and without auth ---------------------------------
const withAuth = sanitizeSettings({ turnUrl: 'turn:relay.example.com:3478', turnUsername: 'owner', turnCredential: 's3cret' });
const withAuthList = iceServersFor(withAuth);
check('TURN adds exactly one entry', withAuthList.length === 2);
check('STUN entry keeps the head', eq(withAuthList[0], { urls: ['stun:stun.l.google.com:19302'] }));
check('TURN entry carries urls', eq(withAuthList[1].urls, ['turn:relay.example.com:3478']));
check('TURN entry carries auth', withAuthList[1].username === 'owner' && withAuthList[1].credential === 's3cret');

const noAuth = sanitizeSettings({ turnUrl: 'turns:relay.example.com:5349' });
const noAuthList = iceServersFor(noAuth);
check('TURN without auth still assembles', noAuthList.length === 2 && eq(noAuthList[1].urls, ['turns:relay.example.com:5349']));
check('missing auth stays undefined', noAuthList[1].username === undefined && noAuthList[1].credential === undefined);

check('empty turnUrl yields no TURN entry', iceServersFor(sanitizeSettings({ turnUsername: 'owner', turnCredential: 's3cret' })).length === 1);

// ---- sanitiser: evil stripped, lengths capped -------------------------------
check('javascript: turnUrl strips to empty', sanitizeSettings({ turnUrl: 'javascript:alert(1)' }).turnUrl === '');
check('garbage turnUrl strips to empty', sanitizeSettings({ turnUrl: '::::' }).turnUrl === '');
check('http turnUrl folds to origin', sanitizeSettings({ turnUrl: 'https://relay.example.com:8443/path?x=1' }).turnUrl === 'https://relay.example.com:8443');
check('long TURN URI caps at 256', sanitizeSettings({ turnUrl: 'turn:' + 'r'.repeat(300) }).turnUrl.length === 256);
check('username trims and caps at 64', sanitizeSettings({ turnUsername: '  ' + 'u'.repeat(100) + '  ' }).turnUsername.length === 64);
check('credential caps at 256', sanitizeSettings({ turnCredential: 'p'.repeat(300) }).turnCredential.length === 256);
check('non-string TURN fields reset to empty', (() => {
  const s = sanitizeSettings({ turnUrl: 7, turnUsername: null, turnCredential: {} } as unknown as Record<string, unknown>);
  return s.turnUrl === '' && s.turnUsername === '' && s.turnCredential === '';
})());

// ---- structural RTCIceServer shape ------------------------------------------
function shapeOk(list: readonly RTCIceServer[]): boolean {
  for (const e of list) {
    const urls = Array.isArray(e.urls) ? e.urls as unknown[] : [e.urls];
    if (!urls.every((u) => typeof u === 'string' && u.length > 0)) return false;
    if (e.username !== undefined && typeof e.username !== 'string') return false;
    if (e.credential !== undefined && typeof e.credential !== 'string') return false;
  }
  return true;
}
check('default shape passes', shapeOk(iceServersFor(DEFAULT_SETTINGS)));
check('TURN shapes pass with and without auth', shapeOk(withAuthList) && shapeOk(noAuthList));

console.log(`ice servers proof: ${passed} checks passed`);
