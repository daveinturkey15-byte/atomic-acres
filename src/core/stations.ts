/**
 * Fixed camera stations for the capture harness.
 *
 * DISCIPLINE: every station names the reference frame it is to be judged against.
 * A render with no paired reference is not evidence of anything. A station whose
 * `ref` is `null` is a gameplay/diagnostic view, not a fidelity view, and must never
 * be used to claim the map "looks right".
 *
 * Stations are OUTSIDE collision on purpose for the overview shots - a camera placed
 * inside geometry flatters every aggregate you measure from it.
 */
import { SPAWN_A, SPAWN_B, EYE_HEIGHT, HEAD_CENTER_X, BACK_FENCE } from './layout';

export interface Station {
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  fov?: number;
  /** reference image id this render must be compared against, or null */
  ref: string | null;
  note: string;
}

const D = Math.PI / 180;

export const STATIONS: Record<string, Station> = {
  // ---- fidelity stations, each paired to a BO2-2025 reference frame
  aerial: {
    pos: [-6, 78, 44],
    yaw: 12 * D,
    pitch: -58 * D,
    fov: 60,
    ref: 'NT02 Nuketown_2025_Aerial_View_BOII.jpg',
    note: 'Whole-map plan read. Check: turning head is a CIRCLE at +x, third house '
      + 'beyond it, mow-stripe lawns, two houses of different architecture.',
  },
  yardOrange: {
    pos: [4.5, 4.2, -(BACK_FENCE - 4)],
    yaw: 168 * D,
    pitch: -7 * D,
    fov: 66,
    ref: 'NT03 Nuketown_2025_BOII.jpg',
    note: 'THE owner viewpoint. Elevated in the orange back yard looking at the orange '
      + 'house. Check: butterfly roof sweep, terracotta upper over cream lower, '
      + 'exterior stair LEFT, barrel-vault garage RIGHT.',
  },
  streetElevation: {
    pos: [-2.0, EYE_HEIGHT, -8.4],
    yaw: 186 * D,
    pitch: 2 * D,
    fov: 70,
    ref: 'NT04 Nuketown_2025_Sniper_BOII.jpg',
    note: 'Eye level on the pavement facing the orange house street face. Check: tall '
      + 'narrow window band with vertical mullions, red appliance bank on the lawn, '
      + 'chain-and-post edging, paving slab scale, deep cantilevered eave.',
  },
  plaza: {
    pos: [-40, 2.6, 1.5],
    yaw: 92 * D,
    pitch: 1 * D,
    fov: 72,
    ref: 'NT05 Nuketown_2025_Load_Screen_BOII.png',
    note: 'Down the road stem from the open -x end, looking back into the map. Check: '
      + 'Nuketown pylon sign with atom motif, coach, classic car, saucer house, dome, '
      + 'tower, flags, hazy skyline.',
  },
  turningHead: {
    pos: [HEAD_CENTER_X - 20, 3.0, -1.0],
    yaw: 84 * D,
    pitch: -2 * D,
    fov: 70,
    ref: 'NT02 Nuketown_2025_Aerial_View_BOII.jpg',
    note: 'Along the street toward the cul-de-sac. Check: circular kerbed head, coach '
      + 'on the -z side, box truck + dark saloon on the +z side, boundary fence and '
      + 'the third house with its red car beyond.',
  },

  // ---- gameplay stations. NOT fidelity evidence.
  spawnA: {
    pos: [SPAWN_A.x, EYE_HEIGHT, SPAWN_A.z],
    yaw: SPAWN_A.yaw,
    pitch: 0,
    ref: null,
    note: 'Orange team spawn eye view. Garage must fall on the RIGHT.',
  },
  spawnB: {
    pos: [SPAWN_B.x, EYE_HEIGHT, SPAWN_B.z],
    yaw: SPAWN_B.yaw,
    pitch: 0,
    ref: null,
    note: 'White team spawn eye view. Garage must fall on the RIGHT.',
  },
  midStreet: {
    pos: [0, EYE_HEIGHT, 0],
    yaw: 0,
    pitch: 0,
    ref: null,
    note: 'Standing in the middle of the road looking at the white house.',
  },
  interiorOrange: {
    pos: [0, EYE_HEIGHT, -17],
    yaw: 0,
    pitch: 0,
    ref: null,
    note: 'Inside the orange house ground floor looking toward the street. Checks the '
      + 'interior is actually open and lit, not a sealed box.',
  },
};

export const FIDELITY_STATIONS = Object.keys(STATIONS)
  .filter((k) => STATIONS[k].ref !== null);
