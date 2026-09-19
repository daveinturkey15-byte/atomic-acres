/**
 * Browser adapter for the DOM-free combat-feedback leaf.
 *
 * This owns only presentation plumbing: the match supplies admitted events and
 * live actor records, while the leaf decides admission, dedupe, merge, styling
 * and its bounded animation loop. In particular, victimPosition deliberately
 * keeps dead records so a fatal event can still be placed at the victim.
 */

import * as THREE from 'three';
import type { GameEvent } from '../game/events';
import type { BotBody } from '../game/session-types';
import {
  createCombatFeedback,
  type CombatFeedback,
  type CombatFeedbackPorts,
  type FeedbackContainer,
  type FeedbackElement,
} from './combat-feedback';

export interface CombatFeedbackMatch {
  readonly localId: string;
  mode(): string;
  bots(): readonly BotBody[];
}

export interface CombatFeedbackAdapterOptions {
  readonly hud: HTMLElement;
  readonly camera: THREE.PerspectiveCamera;
  readonly match: () => CombatFeedbackMatch | null;
}

export interface CombatFeedbackAdapter {
  onEvent(event: GameEvent): void;
  reset(): void;
  dispose(): void;
  readonly feedback: CombatFeedback;
}

function containerFor(hud: HTMLElement): FeedbackContainer {
  return {
    ownerDocument: {
      // HTMLElement is the real FeedbackElement: same duck shape (className,
      // textContent, style, setAttribute, appendChild, remove) with a wider
      // appendChild signature, so the cast is narrowing-only, not a lie.
      createElement: (tag): FeedbackElement =>
        hud.ownerDocument.createElement(tag) as unknown as FeedbackElement,
    },
    appendChild: (child) => { hud.appendChild(child as unknown as Node); },
    removeChild: (child) => { hud.removeChild(child as unknown as Node); },
  };
}

export function createCombatFeedbackAdapter(options: CombatFeedbackAdapterOptions): CombatFeedbackAdapter {
  let sink: ((event: GameEvent) => void) | null = null;
  const projected = new THREE.Vector3();
  const ports: CombatFeedbackPorts = {
    subscribe(listener) {
      sink = listener;
      return () => {
        if (sink === listener) sink = null;
      };
    },
    localActorId() {
      const match = options.match();
      return match !== null && match.mode() !== 'idle' ? match.localId : null;
    },
    victimPosition(id) {
      const match = options.match();
      if (match === null) return null;
      const body = match.bots().find((candidate) => candidate.id === id);
      // Do not filter on `alive`: the admitted fatal event can arrive before a
      // later body snapshot marks the victim dead.
      return body === undefined ? null : { x: body.x, y: body.y, z: body.z };
    },
    project(x, y, z) {
      projected.set(x, y, z).applyMatrix4(options.camera.matrixWorldInverse);
      if (projected.z > -options.camera.near) return null;
      projected.applyMatrix4(options.camera.projectionMatrix);
      const xPx = (projected.x * 0.5 + 0.5) * innerWidth;
      const yPx = (-projected.y * 0.5 + 0.5) * innerHeight;
      const margin = 32;
      if (xPx < -margin || yPx < -margin || xPx > innerWidth + margin || yPx > innerHeight + margin) return null;
      return { x: xPx, y: yPx };
    },
    anchor: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
    now: () => performance.now(),
    schedule: (callback) => {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    },
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    container: containerFor(options.hud),
  };
  const feedback = createCombatFeedback(ports);
  return {
    feedback,
    onEvent(event) { sink?.(event); },
    reset: feedback.reset,
    dispose: feedback.dispose,
  };
}
