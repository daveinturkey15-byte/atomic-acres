/**
 * CPU-only resume-loadout proof. Exercises the host kit readout, the welcome
 * wire validator, the real guest projection, and the real OrdnanceScene bind
 * seam that adopts a refreshed player's full kit without a spawn event.
 *
 * Run: node scripts/net/verify-resume-loadout.mjs
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(tmpdir(), `nuketown-resume-loadout-${process.pid}.mjs`);
const ENTRY = `
  import * as THREE from 'three';
  import { GameHost } from '../../src/game/host';
  import { rulesFor } from '../../src/game/rules';
  import { GameClient } from '../../src/game/client';
  import { GuestClient } from '../../src/net/room-guest';
  import { createGuestDriver } from '../../src/net/match-guest';
  import { isNetMessage } from '../../src/net/protocol';
  import { OrdnanceScene } from '../../src/weapons/ordnance-scene';
  import { createSessionLog } from '../../src/game/session-log';

  const need = (ok, message) => { if (!ok) throw new Error(message); };
  const world = { lineOfSight: () => true, groundY: () => 0, inBounds: () => true };
  const rules = rulesFor('ffa', null, null);
  const transportFor = () => {
    let receive = null;
    const sent = [];
    return {
      sent,
      transport: {
        send: (to, msg) => sent.push({ to, msg }),
        onMessage: (handler) => { receive = handler; return () => { receive = null; }; },
        close: () => undefined,
      },
      deliver: (msg) => receive('host', msg),
    };
  };
  const welcome = (primaryId, rounds, inventory) => ({
    type: 'welcome', weaponStateProtocol: 1, playerId: 'p1', hostNow: 0, roster: [], token: 'resume-token-123',
    resume: {
      phase: 'playing', startTick: 0, lastSeq: 8, life: 1, shotSeq: 3,
      primaryId, rounds, lethal: inventory.lethal, tactical: inventory.tactical, armed: inventory.armed,
    },
  });

  export function run() {
    const host = new GameHost({ world, rules, now: 0, seed: 19 });
    host.addActor('p1', 0, { primaryId: 'deadeye' });
    host.tick(5000);
    const facts = host.loadoutOf('p1');
    need(facts?.primaryId === 'deadeye', 'host resume readout lost authoritative Deadeye');
    need(Number.isSafeInteger(facts?.rounds) && facts.rounds > 0, 'host resume readout lost current rounds');
    need(Number.isSafeInteger(facts?.lethal) && facts.lethal >= 0, 'host resume readout lost lethal count');
    need(Number.isSafeInteger(facts?.tactical) && facts.tactical >= 0, 'host resume readout lost tactical count');
    need(facts?.armed === null || typeof facts?.armed === 'string', 'host resume readout lost armed state');

    // Mixed retained state: lethal was spent to zero, tactical remains, and no
    // grenade is currently armed. These are levels copied from the host kit;
    // rounds remains the existing total-rounds estimate, not mag/reserve data.
    const inventory = { lethal: 0, tactical: 2, armed: null };
    const w = welcome(facts.primaryId, facts.rounds, inventory);
    need(isNetMessage(w), 'resume welcome with primary/rounds/inventory was rejected at wire boundary');
    need(!isNetMessage({ ...w, resume: { ...w.resume, rounds: -1 } }), 'negative resume rounds crossed wire boundary');
    need(!isNetMessage({ ...w, resume: { ...w.resume, lethal: -1 } }), 'negative resume lethal crossed wire boundary');
    need(!isNetMessage({ ...w, resume: { ...w.resume, tactical: 1.5 } }), 'fractional resume tactical crossed wire boundary');
    need(!isNetMessage({ ...w, resume: { ...w.resume, armed: 42 } }), 'malformed resume armed crossed wire boundary');

    const link = transportFor();
    const guest = new GuestClient(link.transport, 'host', 'ABC123', 'guest', { now: () => 0, joinTimeoutMs: 3600000 });
    link.deliver(w);
    let bound = null;
    const ui = { bindClient: (client) => { bound = client; }, setNames: () => undefined };
    const driver = createGuestDriver(guest, { ui, instrument: createSessionLog('p1') });
    need(bound instanceof GameClient, 'guest driver did not bind a real GameClient');
    need(bound.ordnance.self.primaryId === 'deadeye', 'guest projection did not carry authoritative primary');
    need(bound.ordnance.self.rounds === facts.rounds, 'guest projection did not carry authoritative rounds');
    need(bound.ordnance.self.lethal === inventory.lethal, 'guest projection did not carry spent lethal count');
    need(bound.ordnance.self.tactical === inventory.tactical, 'guest projection did not carry remaining tactical count');
    need(bound.ordnance.self.armed === inventory.armed, 'guest projection did not carry armed state');
    need(driver.counters().lives === 1, 'resume life changed while restoring loadout');

    let adopted = null;
    let applied = null;
    const material = new THREE.MeshBasicMaterial();
    const mat = {
      glass: material, steel: material,
      painted: () => material, emissive: () => material,
    };
    const hud = { setPrompt: () => undefined, setFlash: () => undefined, setGrenades: () => undefined };
    const weapons = {
      adoptWeapon: (id, rounds) => { adopted = { id, rounds }; return true; },
      blastAt: () => undefined,
      setOrdnance: (lethal, tactical, tacticalId, armed) => { applied = { lethal, tactical, tacticalId, armed }; },
    };
    const scene = new OrdnanceScene({ scene: new THREE.Scene(), mat, colliders: [], hud, weapons });
    scene.bind(bound);
    need(adopted?.id === 'deadeye' && adopted.rounds === facts.rounds,
      'OrdnanceScene bind did not restore the controller weapon without a spawn');
    scene.update(0, 0, 0, 0, 0);
    need(applied?.lethal === inventory.lethal && applied?.tactical === inventory.tactical && applied?.armed === inventory.armed,
      'OrdnanceScene did not apply the resumed mixed grenade inventory to the controller');
    need(bound.ordnance.self.spawnSeq === 0, 'loadout restoration fabricated a spawn edge');

    scene.bind(null);
    driver.dispose(); guest.dispose(); material.dispose();
    return {
      primaryId: facts.primaryId, rounds: facts.rounds, life: driver.counters().lives,
      inventory, hostInventory: { lethal: facts.lethal, tactical: facts.tactical, armed: facts.armed },
      adopted, applied,
    };
  }
`;

await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'resume-loadout.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: OUT, logLevel: 'warning',
});
try {
  const proof = await import(pathToFileURL(OUT).href);
  console.log(JSON.stringify(proof.run()));
  console.log('[resume-loadout] PASS authoritative primary/rounds/full inventory survive reload and bind without spawn');
} finally {
  rmSync(OUT, { force: true });
}
