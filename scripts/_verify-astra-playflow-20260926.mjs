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
  export { PilotControlView, controlledPilotView } from './src/core/pilot-controls';
  export { projectStreakStrip } from './src/ui/streak-presentation';
  export { OrdnanceScene } from './src/weapons/ordnance-scene';
  export { GameClient } from './src/game/client';
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
    remove() { this.removed = true; },
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
  const drone = { kind: 'aircraft', variant: 'piloted-drone', instanceId: 12, actorId: 'you', team: 0,
    streakId: 'piloted-drone', x: 40, y: 10, z: -2, yaw: 0, pitch: 0, health: 100, controlled: true, remainingMs: 10000 };
  assert.equal(api.controlledPilotView([drone], 'other', true, 1000, 1000), null, 'cannot possess another actor platform');
  assert.equal(api.controlledPilotView([drone], 'you', false, 1000, 1000), null, 'dead actor cannot retain pilot view');
  assert.equal(api.controlledPilotView([drone], 'you', true, 1000, 1751), null, 'stale link releases pilot view');
  assert.equal(api.controlledPilotView([{ ...drone, remainingMs: 400 }], 'you', true, 1000, 1400), null, 'expired aircraft releases camera');
  const eventBus = new EventTarget();
  const documentBus = new EventTarget();
  const canvas = element('canvas');
  globalThis.addEventListener = eventBus.addEventListener.bind(eventBus);
  globalThis.removeEventListener = eventBus.removeEventListener.bind(eventBus);
  globalThis.document = { createElement: element, pointerLockElement: canvas,
    addEventListener: documentBus.addEventListener.bind(documentBus), removeEventListener: documentBus.removeEventListener.bind(documentBus) };
  const inputs = [], transitions = [], slots = [];
  let exits = 0;
  const pilotCamera = new THREE.PerspectiveCamera(80);
  const pilot = new api.PilotControlView({ camera: pilotCamera, canvas, hud: element('div'),
    send: input => inputs.push(input), exit: () => exits++, streak: slot => slots.push(slot),
    transition: active => transitions.push(active), lookSettings: () => ({ sensitivity: 2, invertY: true }) });
  const dispatch = (type, fields) => {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value });
    eventBus.dispatchEvent(event);
  };
  pilot.sync([drone], 'you', true, 1000, 1000);
  dispatch('keydown', { code: 'KeyW' }); dispatch('keydown', { code: 'KeyE' });
  dispatch('mousemove', { movementX: 10, movementY: 5 });
  dispatch('mousedown', { target: canvas, button: 0 });
  pilot.update(1000); pilot.update(1025); pilot.update(1050);
  assert.equal(inputs.length, 2, 'pilot input is bounded to 20Hz');
  assert.equal(inputs[0].forward, 1); assert.equal(inputs[0].ascend, 1); assert.equal(inputs[0].fire, true);
  assert(Math.abs(inputs[0].yaw + .044) < 1e-8 && Math.abs(inputs[0].pitch - .022) < 1e-8, 'pilot look honors sensitivity/inversion');
  assert.equal(pilotCamera.position.y, 10.22, 'camera derives from authoritative aircraft position');
  dispatch('keydown', { code: 'Digit7', repeat: false });
  assert.deepEqual(slots, [5], 'conditional crate slot remains callable during possession');
  dispatch('keydown', { code: 'Escape' }); dispatch('keydown', { code: 'Escape' });
  assert.equal(exits, 1, 'escape sends one exit request, not repeated toggles');
  pilot.update(1100);
  assert.equal(inputs.at(-1).forward, 0); assert.equal(inputs.at(-1).ascend, 0); assert.equal(inputs.at(-1).fire, false);
  pilot.sync([{ ...drone, controlled: false }], 'you', true, 1150, 1150);
  assert.equal(pilot.active(), false); assert.equal(pilotCamera.fov, 80, 'camera projection restores after authority releases control');
  assert.deepEqual(transitions, [true, false], 'player/weapon input has one suspend and one restore');
  pilot.sync([drone], 'you', true, 1200, 1200);
  pilot.sync([drone], 'you', true, 1200, 2000);
  assert.equal(pilot.active(), false, 'stale snapshot also restores body controls');
  pilot.dispose();
  const chosenCards = ['recon-sweep', 'piloted-drone', 'blast-mortar', 'strike-relay'].map(id => ({ id, charges: 0 }));
  assert.equal(api.projectStreakStrip(chosenCards, 0).length, 4, 'no invented fifth chosen class slot');
  const withReward = api.projectStreakStrip([...chosenCards, { id: 'adrenaline', charges: 1 }], 0);
  assert.equal(withReward[4].key, '7'); assert.equal(withReward[4].state, 'ready');
  assert.match(withReward[4].stateText, /CRATE REWARD/, 'host banked bonus is visibly distinguished');
  // Exercise the real inventory consumer with inert presentation pools. A
  // reward changes the held primary without manufacturing a pickup event.
  const inventoryClient = new api.GameClient('you');
  const adopted = [], spawned = [];
  const inventoryScene = Object.assign(Object.create(api.OrdnanceScene.prototype), {
    client: inventoryClient, localLoadout: () => deployed, volumetricSmoke: () => false,
    adoptedPrimaryId: 'mp5', lastSpawnSeq: 0, lastPickupSeq: 0,
    grenades: { update() {} }, drops: { update() {} }, mortarFx: { update() {} }, boltFx: { update() {} },
    weapons: { adoptWeapon: (...args) => adopted.push(args), onSelfSpawn: (...args) => spawned.push(args), setOrdnance() {} },
    hud: { setGrenades() {}, setFlash() {}, setPrompt() {} },
  });
  Object.assign(inventoryClient.ordnance.self, { primaryId: 'crimson-flamethrower', rounds: 150,
    sidearmId: 'magnum', sidearmRounds: 3, tacticalId: 'smoke' });
  inventoryScene.update(.05, 1000, 0, 0, 0);
  assert.deepEqual(adopted, [['crimson-flamethrower', 150, 'magnum', 3]], 'host reward inventory equips actual temporary gun');
  inventoryClient.ordnance.self.rounds = 149;
  inventoryScene.update(.05, 1050, 0, 0, 0);
  assert.equal(adopted.length, 1, 'recurring inventory cannot refill the local magazine');
  Object.assign(inventoryClient.ordnance.self, { primaryId: 'mp5', rounds: 20 });
  inventoryScene.update(.05, 1100, 0, 0, 0);
  assert.deepEqual(adopted[1], ['mp5', 20, 'magnum', 3], 'host expiry restores previous gun and remaining rounds');
  Object.assign(inventoryClient.ordnance.self, { primaryId: 'rattler', rounds: 15, pickupSeq: 1,
    lastPickupKind: 'swap', lastPickupWeaponId: 'rattler', lastPickupRounds: 15 });
  inventoryScene.update(.05, 1150, 0, 0, 0);
  assert.equal(adopted.length, 3, 'one pickup with inventory and event equips only once');
  console.log(JSON.stringify({ ok: true, checks: ['menu selection', 'saved class retention', 'prejoin editing', 'room class lock',
    'storage refusal continuity', 'four streak choices', 'primary and sidearm keys', 'bounded weapon wheel',
    'pickup slot replacement', 'automatic fire cadence', 'authoritative special weapon presentation',
    'pilot ownership and freshness', 'pilot controls and restoration', 'conditional crate reward',
    'reward grant and expiry inventory'], claims: claims.length }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}
