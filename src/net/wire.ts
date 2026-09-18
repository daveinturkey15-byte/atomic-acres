/**
 * Nuketown 2025 — netcode wiring. The ONE call main.ts makes for this lane.
 *
 * Mounts the lobby panel (which owns all room lifecycle) and exposes the
 * headless proof on window.__NTNET so Playwright or a console can drive
 * host-plus-client without touching the QA surface the orchestrator owns.
 */
import { initLobby } from '../ui/lobby';
import { formatProofReport, runLoopbackProof, type ProofOptions, type ProofReport } from './proof';
import { GuestClient, HostRoom, liveRoomCount } from './room';
import { CLEAN_LINK, NORMAL_LINK, createLoopbackPair } from './transport';

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
  liveRoomCount: typeof liveRoomCount;
  NORMAL_LINK: typeof NORMAL_LINK;
  CLEAN_LINK: typeof CLEAN_LINK;
}
export function wireNetcode(deps: { player: NetcodePlayer }): NetcodeHandle {
  const lobby = initLobby({
    sampleLocalPose: () => ({
      x: deps.player.state.pos.x,
      y: deps.player.state.pos.y,
      z: deps.player.state.pos.z,
      yaw: deps.player.state.yaw,
    }),
  });
  const w = window as unknown as { __NTNET?: NetConsole };
  w.__NTNET = {
    proof: (opts?: ProofOptions) => runLoopbackProof(opts),
    format: (r: ProofReport) => formatProofReport(r),
    HostRoom,
    GuestClient,
    createLoopbackPair,
    liveRoomCount,
    NORMAL_LINK,
    CLEAN_LINK,
  };
  return {
    dispose(): void {
      lobby.dispose();
      if (w.__NTNET) delete w.__NTNET;
    },
  };
}
