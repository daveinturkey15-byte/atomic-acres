/**
 * Fixed camera stations for the capture harness.
 *
 * DISCIPLINE: every station names the reference frame it is to be judged against.
 * A render with no paired reference is not evidence of anything. A station whose
 * `ref` is `null` is a gameplay/diagnostic view, not a fidelity view, and must never
 * be used to claim the map "looks right".
 *
 * YAW CONVENTION (get this wrong and you photograph the wrong building - it happened):
 *   the camera's forward is (-sin(yaw), 0, -cos(yaw)), so
 *     yaw =  0      faces -z      yaw =  PI     faces +z
 *     yaw = +PI/2   faces -x      yaw = -PI/2   faces +x
 * Overview stations sit OUTSIDE the play area on purpose - a camera inside geometry
 * flatters every aggregate measured from it.
 */
import { SPAWN_A, SPAWN_B, EYE_HEIGHT, BACK_FENCE } from './layout';

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
    pos: [-4, 82, 52],
    yaw: 8 * D,
    pitch: -57 * D,
    fov: 58,
    ref: 'NT02 Nuketown_2025_Aerial_View_BOII.jpg',
    note: 'Whole-map plan read. Check: turning head is a CIRCLE at the map centre, '
      + 'third house beyond it to the east, mow-stripe lawns, two houses of DIFFERENT '
      + 'architecture, and the town sitting in desert rather than on an endless concrete slab.',
  },
  yardOrange: {
    pos: [10, 8.5, -(BACK_FENCE + 1)],
    yaw: 149.5 * D,
    pitch: -14 * D,
    fov: 62,
    ref: 'NT03 Nuketown_2025_BOII.jpg',
    note: 'THE owner viewpoint - elevated over the orange back yard looking at the '
      + 'orange house. Check: butterfly roof sweep, terracotta upper over cream lower, '
      + 'exterior stair on the LEFT, barrel-vault garage on the RIGHT.',
  },
  yardWhite: {
    pos: [-10, 8.5, BACK_FENCE + 1],
    yaw: -30.5 * D,
    pitch: -14 * D,
    fov: 62,
    ref: 'NT02 Nuketown_2025_Aerial_View_BOII.jpg',
    note: 'The answering view over the white back yard. Check: rounded capsule volumes, '
      + 'blue-grey roof glazing, rooftop drum, garden pod / sand pit / shuffleboard, '
      + 'and the garage again on the RIGHT.',
  },
  streetElevation: {
    pos: [-3, EYE_HEIGHT, 4.0],
    yaw: 0,
    pitch: 4 * D,
    fov: 70,
    ref: 'NT04 Nuketown_2025_Sniper_BOII.jpg',
    note: 'Eye level in the road facing the ORANGE house street face. Check: tall '
      + 'narrow window band with vertical mullions, RED appliance bank on the lawn, '
      + 'chain-and-post edging, paving slab scale, deep cantilevered eave. Glazing '
      + 'must reflect sky, not read as black holes.',
  },
  plaza: {
    pos: [-14, 2.6, -1.0],
    yaw: 90 * D,
    pitch: -1 * D,
    fov: 72,
    ref: 'NT05 Nuketown_2025_Load_Screen_BOII.png',
    note: 'Down the road stem toward the open -x end. Check: Nuketown pylon sign with '
      + 'the atom motif, space-needle tower, hypar petal, flags, teal classic car, '
      + 'hazy blue-grey mountains behind.',
  },
  turningHead: {
    pos: [-14, 2.6, 1.0],
    yaw: -90 * D,
    pitch: -1 * D,
    fov: 72,
    ref: 'NT02 Nuketown_2025_Aerial_View_BOII.jpg',
    note: 'From the west stem looking +x at the CENTRAL circle. Check: circular kerbed '
      + 'head at the map centre, coach on the -z side, second bus / saloon on the +z '
      + 'side, driveway apron and boundary fence east with the third house and its '
      + 'red car beyond.',
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
    yaw: Math.PI,
    pitch: 0,
    ref: null,
    note: 'Standing in the middle of the road looking at the white house.',
  },
  interiorOrange: {
    pos: [0, EYE_HEIGHT, -18.5],
    yaw: Math.PI,
    pitch: 0,
    ref: null,
    note: 'Inside the orange house ground floor looking toward the street. Checks the '
      + 'interior is actually open and lit, not a sealed box.',
  },
};

export const FIDELITY_STATIONS = Object.keys(STATIONS)
  .filter((k) => STATIONS[k].ref !== null);
