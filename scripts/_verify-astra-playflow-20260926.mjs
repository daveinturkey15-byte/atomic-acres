/** CPU proof of menu -> chosen kit and actual controller slot behavior.
 * No renderer/browser, source modules bundled once in the owned temp directory. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'aa-astra-playflow-'));
const output = join(scratch, 'proof.mjs');
await build({ stdin: { resolveDir: root, contents: `
  export { buildSoloSetupPanel } from './src/ui/solo-setup';
  export { buildStreakLoadoutSection, STREAK_LOADOUT_STORAGE_KEY } from './src/ui/streak-loadout-panel';
  export * from './src/game/loadout';
  export { WEAPONS } from './src/weapons/catalog';
  export { WeaponsController } from './src/weapons/controller';
  export * as THREE from 'three';
` }, outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning' });

function element(tag) {
  const node = {
    tagName: tag.toUpperCase(), children: [], listeners: {}, attrs: {}, style: {}, dataset: {},
    textContent: '', disabled: false, value: '',
    append(...nodes) { this.children.push(...nodes); },
    appendChild(child) { this.append(child); return child; },
    setAttribute(key, value) { this.attrs[key] = value; },
    getAttribute(key) { return this.attrs[key]; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    dispatch(type) { for (const fn of this.listeners[type] ?? []) fn({ stopPropagation() {}, target: this }); },
    click() { if (!this.disabled) this.dispatch('click'); },
  };
  const classes = new Set();
  node.classList = {
    add(...names) { names.forEach((name) => classes.add(name)); },
    contains(name) { return classes.has(name); },
    toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; },
  };
  Object.defineProperty(node, 'className', { get: () => [...classes].join(' '), set: (value) => {
    classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
  } });
  Object.defineProperty(node, 'options', { get: () => node.children.filter((child) => child.tagName === 'OPTION') });
  return node;
}
globalThis.document = { createElement: element, createElementNS: (_ns, tag) => element(tag) };
const storage = new Map();
let blocked = false;
globalThis.localStorage = {
  getItem(key) { return storage.get(key) ?? null; },
  setItem(key, value) { if (blocked) throw Error('blocked'); storage.set(key, value); },
};
const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const byClass = (node, name) => flatten(node).filter((item) => item.classList.contains(name));
const findPrimary = (panel, name) => byClass(panel.root, 'aa-prim').find((item) =>
  item.children.some((child) => child.classList.contains('aa-prim-name') && child.textContent === name));

try {
  const api = await import(pathToFileURL(output).href);
  let changed = null;
  let deployed = null;
  const panel = api.buildSoloSetupPanel({
    onChange() {}, onBack() {}, onDeploy() { deployed = api.resolveLoadout(panel.loadout()); },
    onLoadoutChange(value) { changed = api.resolveLoadout(value); },
  });
  const primary = api.WEAPONS.find((w) => w.id === 'mp5');
  findPrimary(panel, primary.name).click();
  assert.equal(changed.primary, 'mp5', 'real primary button updates the deployment callback');
  const smoke = byClass(panel.root, 'aa-tac').find((item) => item.children.some((child) => /smoke/i.test(child.textContent)));
  smoke.click();
  assert.equal(api.resolveLoadout(panel.loadout()).grenade, 'smoke');
  const sidearms = byClass(panel.root, 'aa-sidearm');
  assert.equal(sidearms.length, api.SIDEARM_IDS.length, 'all three authored sidearms are selectable');
  sidearms.find((item) => item.attrs['aria-label'] === api.WEAPONS.find((w) => w.id === 'magnum').name).click();
  assert.equal(api.loadLoadout().custom.filter(Boolean).length, 1, 'editing an active custom class preserves its slot');
  byClass(panel.root, 'aa-primary').find((item) => item.textContent === 'Deploy').click();
  assert.deepEqual(deployed, { primary: 'mp5', sidearm: 'magnum', grenade: 'smoke' });
  assert.equal(byClass(panel.root, 'aa-kit').filter((item) => item.attrs['aria-pressed'] === 'true').length, 0,
    'custom class does not pretend its preset kit is selected');
  panel.setMode('loadout');
  assert.ok(byClass(panel.root, 'aa-solo-setup')[0].classList.contains('aa-hidden'), 'prejoin class editor hides host rules');
  panel.setLoadoutEditable(false);
  assert.equal(byClass(panel.root, 'aa-solo-loadout')[0].disabled, true, 'room admission freezes the class fieldset');
  panel.setLoadoutEditable(true);

  blocked = true;
  findPrimary(panel, api.WEAPONS.find((w) => w.id === 'm14-ebr').name).click();
  assert.equal(api.resolveLoadout(panel.loadout()).primary, 'm14-ebr', 'storage refusal retains session class');
  panel.refresh();
  assert.equal(api.resolveLoadout(panel.loadout()).grenade, 'smoke', 'storage refusal retains full tactical pair');
  assert.equal(api.resolveLoadout(panel.loadout()).sidearm, 'magnum', 'primary edit preserves selected sidearm');
  assert.match(byClass(panel.root, 'aa-loadnote')[0].textContent, /NOT SAVED/, 'storage refusal stays visible');
  assert.equal(api.resolveLoadout(api.loadLoadout()).primary, 'mp5', 'failed persistence does not invent a saved class');

  let streakChoice = null;
  const streak = api.buildStreakLoadoutSection({ onChange(value) { streakChoice = value; } });
  const selectors = byClass(streak.root, 'aa-streak-select');
  assert.equal(selectors.length, 4, 'all four gameplay slots are offered');
  const selector = selectors.find((select) => select.children.some((option) => !option.disabled && option.value !== select.value));
  assert.ok(selector, 'at least one wired alternative exists');
  const next = selector.children.find((option) => !option.disabled && option.value !== selector.value).value;
  selector.value = next;
  selector.dispatch('change');
  assert.ok(streakChoice.includes(next), 'streak callback carries the chosen id despite blocked persistence');
  streak.refresh();
  assert.deepEqual(streak.read(), streakChoice, 'streak readout and deployment agree');
  assert.ok(streak.read().includes(next));

  delete globalThis.document; // Real Three.js graph only; no renderer/canvas.
  const { THREE, WeaponsController } = api;
  const material = new Proxy(function () {}, {
    get: (_t, key) => key === 'then' ? undefined : material,
    apply: () => new THREE.MeshStandardMaterial(),
  });
  const claims = [];
  const controller = new WeaponsController({
    camera: new THREE.PerspectiveCamera(72, 16 / 9, .05, 200), scene: new THREE.Scene(),
    mat: material, targets: [], onHud() {}, onShot: (claim) => claims.push(claim),
    localLoadout: () => deployed, carbineCanary: false, heroesCanary: false,
  });
  const issued = api.WEAPONS.find((w) => w.id === 'mp5');
  controller.onSelfSpawn('mp5', issued.magSize + issued.startReserve, 'magnum');
  assert.deepEqual(controller.command('loadout'), { primary: 'mp5', sidearm: 'magnum' });
  controller.keyDown('Digit2');
  assert.equal(controller.command('state').id, 'magnum', '2 selects issued sidearm');
  controller.keyDown('Digit1');
  assert.equal(controller.command('state').id, 'mp5', '1 selects chosen primary');
  for (let i = 0; i < 30; i++) {
    controller.wheel(i % 2 ? -1 : 1);
    assert.ok(['mp5', 'magnum'].includes(controller.command('state').id), 'wheel never grants a catalog weapon');
  }
  assert.equal(controller.keyDown('Digit3'), false, '3 stays reserved for killstreaks');
  assert.equal(controller.command('switch', 'coachman'), true, 'explicit QA inspection seam still works');
  controller.wheel(1);
  assert.equal(controller.command('state').id, 'mp5', 'normal input returns QA inspection to carried kit');
  controller.adoptWeapon('rattler', 45);
  assert.equal(controller.command('loadout').sidearm, 'magnum', 'pickup preserves admitted backup');
  controller.keyDown('Digit2'); controller.keyDown('Digit1');
  assert.equal(controller.command('state').id, 'rattler', 'admitted pickup replaces primary slot');
  controller.adoptWeapon('mp5', 20, 'magnum', 3);
  controller.keyDown('Digit2');
  assert.equal(controller.command('state').mag + controller.command('state').reserve, 3, 'rejoin restores host sidearm ammo');
  controller.onSelfSpawn('mp5', 20, 'magnum', 0);
  controller.keyDown('Digit2');
  assert.equal(controller.command('state').mag + controller.command('state').reserve, 0, 'authoritative empty backup stays empty');
  controller.onSelfSpawn('mp5', issued.magSize + issued.startReserve, 'magnum');
  const move = { speed: 0, sprinting: false, grounded: true };
  controller.update(.016, 10, move);
  controller.pointerDown(0);
  for (let i = 1; i <= 40; i++) controller.update(.05, 10 + i * .05, move);
  controller.pointerUp(0);
  assert.ok(claims.length > 10, 'real automatic fire produces a useful cadence sample');
  for (let i = 1; i < claims.length; i++) {
    assert.ok(claims[i].time - claims[i - 1].time >= issued.interval * 1000 - 1,
      `automatic claims preserve scheduled cadence: ${claims[i].time - claims[i - 1].time}ms`);
  }
  const presentation = { rays: 0, tracers: 0, impacts: 0, impactSounds: 0, flashes: 0, shots: 0 };
  controller.raycaster.intersectObjects = () => {
    presentation.rays++;
    return [{ distance: 10, point: new THREE.Vector3(0, 0, -10),
      face: { normal: new THREE.Vector3(0, 0, 1) }, object: { matrixWorld: new THREE.Matrix4() } }];
  };
  controller.effects.tracer = () => { presentation.tracers++; };
  controller.effects.impact = () => { presentation.impacts++; };
  controller.effects.flashAt = (position) => {
    assert.ok(position.toArray().every(Number.isFinite), 'muzzle presentation uses a valid position');
    presentation.flashes++;
  };
  controller.audioSvc.impact = () => { presentation.impactSounds++; };
  controller.playShot = () => { presentation.shots++; };
  let presentationTime = 20;
  for (const id of ['m4a1', 'railgun', 'explosive-crossbow', 'flare-gun', 'flamethrower']) {
    const def = api.WEAPONS.find((w) => w.id === id);
    assert.ok(def, `presentation test catalog row exists: ${id}`);
    controller.onSelfSpawn(id, def.magSize + def.startReserve, 'magnum');
    controller.update(.05, presentationTime++, move);
    for (const key of Object.keys(presentation)) presentation[key] = 0;
    const claimCount = claims.length;
    const recoilCount = controller.recoilTotal;
    assert.equal(controller.command('fire'), true, `${id} actually fires`);
    assert.equal(claims.length, claimCount + 1, `${id} sends its authoritative claim`);
    assert.equal(controller.recoilTotal, recoilCount + 1, `${id} retains recoil`);
    assert.equal(presentation.flashes, 1, `${id} retains muzzle flash`);
    assert.equal(presentation.shots, 1, `${id} retains its shot voice`);
    const bullet = id === 'm4a1' || id === 'railgun';
    for (const key of ['rays', 'tracers', 'impacts', 'impactSounds']) {
      assert.equal(presentation[key], bullet ? 1 : 0,
        `${id} ${bullet ? 'keeps' : 'does not invent'} immediate bullet ${key}`);
    }
    if (!bullet) assert.equal(controller.lastDamage, 0, `${id} does not predict immediate damage`);
  }
  controller.dispose();
  console.log(JSON.stringify({ ok: true, checks: ['menu selection', 'saved class retention', 'prejoin editing', 'room class lock',
    'storage refusal continuity', 'four streak choices', 'primary and sidearm keys', 'bounded weapon wheel',
    'pickup slot replacement', 'automatic fire cadence', 'authoritative special weapon presentation'], claims: claims.length }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
