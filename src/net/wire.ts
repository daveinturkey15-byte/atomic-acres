/**
 * Nuketown 2025 — netcode console. The ONE call main.ts makes for this lane.
 *
 * The lobby itself is a MENU now (`ui/lobby.ts` over `net/lobby-session.ts`,
 * reached through `game/session.ts:LocalMatch.lobby`); this file no longer
 * mounts a panel. It exposes the headless loopback proof and the room classes
 * on `window.__NTNET` so Playwright or a console can drive host-plus-client
 * without touching the QA surface the orchestrator owns.
 */
import { formatProofReport, runLoopbackProof, type ProofOptions, type ProofReport } from './proof';
import { GuestClient, HostRoom, liveRoomCount } from './room';
import { createRtcTransport, rtcAvailable } from './rtc';
import { CLEAN_LINK, NORMAL_LINK, createLocalTransport, createLoopbackPair } from './transport';

export interface NetcodePlayer {
  state: {
    pos: { x: number; y: number; z: number };
    yaw: number;
  };
}

export interface NetcodeHandle {
  dispose(): void;
}

export interface NetConsole {
  proof: (opts?: ProofOptions) => ProofReport;
  format: (r: ProofReport) => string;
  HostRoom: typeof HostRoom;
  GuestClient: typeof GuestClient;
  createLoopbackPair: typeof createLoopbackPair;
  createLocalTransport: typeof createLocalTransport;
  createRtcTransport: typeof createRtcTransport;
  rtcAvailable: typeof rtcAvailable;
  liveRoomCount: typeof liveRoomCount;
  NORMAL_LINK: typeof NORMAL_LINK;
  CLEAN_LINK: typeof CLEAN_LINK;
}

export function wireNetcode(deps: { player: NetcodePlayer }): NetcodeHandle {
  void deps;
  const w = window as unknown as { __NTNET?: NetConsole };
  w.__NTNET = {
    proof: (opts?: ProofOptions) => runLoopbackProof(opts),
    format: (r: ProofReport) => formatProofReport(r),
    HostRoom,
    GuestClient,
    createLoopbackPair,
    createLocalTransport,
    createRtcTransport,
    rtcAvailable,
    liveRoomCount,
    NORMAL_LINK,
    CLEAN_LINK,
  };
  return {
    dispose(): void {
      if (w.__NTNET) delete w.__NTNET;
    },
  };
}
