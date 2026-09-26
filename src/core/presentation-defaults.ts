/** September20's accepted 4238 dressing plus the 4248 baked room. The rejected
 * operator anatomy experiment, optional FX experiments and unaccepted terrain
 * are deliberately absent. Explicit per-feature comparisons always win. */
export const AUTHORED_PRESENTATION_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  lighting: 'authored', glazing: 'canary', motion: 'canary', architecture: 'canary',
  'facade-kit': 'canary', foliage: 'canary', hands: 'rifle-canary',
  'street-lamps': 'canary', coach: 'canary', 'weapon-finish': 'canary',
  operator: 'authored', lawn: 'canary', audiobank: '2', 'fence-art': 'canary',
  room: 'authored', 'room-light': 'baked',
});

/** Pure boot transformation. `art=baseline` retains the original no-flag path. */
export function authoredPresentationSearch(search: string): string {
  const params = new URLSearchParams(search);
  const mode = params.get('art')?.toLowerCase();
  if (mode === 'baseline' || mode === 'legacy' || mode === 'off') return search;
  for (const [key, value] of Object.entries(AUTHORED_PRESENTATION_DEFAULTS)) {
    if (!params.has(key)) params.set(key, value);
  }
  return `?${params.toString()}`;
}

/** Call before world/material/BUILDERS construction; history replacement does
 * not navigate or restart a network lobby and preserves hash/room parameters. */
export function installPresentationDefaults(): void {
  if (typeof window === 'undefined') return;
  const search = authoredPresentationSearch(window.location.search);
  if (search === window.location.search) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
}
