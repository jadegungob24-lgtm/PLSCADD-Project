/**
 * Alignment geometry (PLS-CADD manual §6.3, §6.7, §6.11).
 *
 * An alignment is a chain of straight segments between PI points. Conventions
 * follow the manual: travelling in the direction of increasing stations,
 * positive offsets are to the right and positive line angles are clockwise.
 * X is east, Y is north; azimuths are clockwise from north (the Y axis).
 */

export interface XY {
  x: number;
  y: number;
}

export interface AlignmentSegment {
  /** Index of the PI at the start of the segment. */
  index: number;
  ax: number;
  ay: number;
  /** Unit direction (east, north). */
  dx: number;
  dy: number;
  length: number;
  /** Azimuth in degrees, clockwise from north, 0 ≤ az < 360. */
  azimuth: number;
  /** True station at the start of the segment. */
  startStation: number;
}

export interface AlignmentGeometry {
  pis: XY[];
  segments: AlignmentSegment[];
  /** True station of each PI. */
  stations: number[];
  /** Line angle at each PI in degrees, positive clockwise; 0 at the first and last PI. */
  lineAngles: number[];
  startStation: number;
  totalLength: number;
}

export interface StationOffset {
  station: number;
  /** Positive to the right of the line when travelling up-station. */
  offset: number;
  segment: number;
}

const DEG = 180 / Math.PI;

/** Normalise an angle in degrees to the interval (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/**
 * Build alignment geometry from PI coordinates. Consecutive duplicate PIs are
 * rejected by returning null (a zero-length segment has no direction).
 */
export function buildAlignment(pis: XY[], startStation = 0): AlignmentGeometry | null {
  if (pis.length < 2) return null;
  const segments: AlignmentSegment[] = [];
  const stations: number[] = [startStation];
  let sta = startStation;
  for (let i = 0; i < pis.length - 1; i++) {
    const a = pis[i]!;
    const b = pis[i + 1]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length = Math.hypot(ex, ey);
    if (!(length > 0)) return null;
    let azimuth = Math.atan2(ex, ey) * DEG;
    if (azimuth < 0) azimuth += 360;
    segments.push({ index: i, ax: a.x, ay: a.y, dx: ex / length, dy: ey / length, length, azimuth, startStation: sta });
    sta += length;
    stations.push(sta);
  }
  const lineAngles = pis.map((_, i) =>
    i === 0 || i === pis.length - 1 ? 0 : normalizeAngle(segments[i]!.azimuth - segments[i - 1]!.azimuth),
  );
  return { pis, segments, stations, lineAngles, startStation, totalLength: sta - startStation };
}

/** How far the first and last segments are extended beyond the end PIs when projecting points. */
export interface EndExtension {
  before: number;
  after: number;
}
const NO_LIMIT: EndExtension = { before: Infinity, after: Infinity };

/**
 * Virtual alignment (manual §6.3.1.2): with several alignments, their profiles
 * are displayed one after the other as a single virtual alignment, separated
 * by the "station gap to insert between alignments". Stations therefore run
 * continuously: each alignment starts at the end station of the previous one
 * plus the gap. (Fig. 6.3-8: main line 1707.11 long, gap, branch 5-8 of 500,
 * point 8 at station 2507.11.) Alignments with fewer than two PIs have no
 * geometry (null) and take no station range.
 */
export function buildVirtualAlignment(lists: XY[][], startStation: number, gap: number): (AlignmentGeometry | null)[] {
  let next = startStation;
  return lists.map((pis) => {
    const g = buildAlignment(pis, next);
    if (g) next = g.startStation + g.totalLength + gap;
    return g;
  });
}

/** Station equation (manual §6.11): from `trueStation` on, displayed stations count from `equationStation`, forward or backward. */
export interface StationEquation {
  trueStation: number;
  equationStation: number;
  direction: 'ahead' | 'back';
}

/**
 * Equation station of a true station. The equation with the largest true
 * station not exceeding the given station applies; before the first equation
 * the equation station equals the true station.
 */
export function toEquationStation(trueStation: number, equations: readonly StationEquation[]): number {
  let cur: StationEquation | null = null;
  for (const e of equations) {
    if (e.trueStation <= trueStation && (!cur || e.trueStation > cur.trueStation)) cur = e;
  }
  if (!cur) return trueStation;
  const d = trueStation - cur.trueStation;
  return cur.direction === 'ahead' ? cur.equationStation + d : cur.equationStation - d;
}

/**
 * Remove interior PIs whose line angle is not larger than `maxAngleDeg`
 * (manual §6.3.1.1 "Delete Small Angle PI"). Angles are re-evaluated after
 * each removal, smallest first, so that several small angles in a row are not
 * removed blindly. Returns the indices of the PIs kept.
 */
export function withoutSmallAngles(pis: XY[], maxAngleDeg: number): number[] {
  const keep = pis.map((_, i) => i);
  for (;;) {
    const g = buildAlignment(keep.map((i) => pis[i]!));
    if (!g || keep.length <= 2) return keep;
    let worst = -1;
    let worstAngle = Infinity;
    for (let k = 1; k < keep.length - 1; k++) {
      const a = Math.abs(g.lineAngles[k]!);
      if (a <= maxAngleDeg && a < worstAngle) { worstAngle = a; worst = k; }
    }
    if (worst < 0) return keep;
    keep.splice(worst, 1);
  }
}

/**
 * Station and offset of a point.
 *
 * A point projects onto a segment when the foot of the perpendicular lies on
 * it; the first and last segments are extended indefinitely, since profiles
 * extend beyond the end alignment points (§6.3.1.2). Points in the wedge on the
 * outside of a line angle have no perpendicular projection and return null —
 * the manual states such points "cannot be projected" (§6.3.2). On the inside
 * of a line angle a point projects onto both adjacent segments; the manual does
 * not state which is used, so the segment with the smaller |offset| is taken.
 */
export function projectPoint(g: AlignmentGeometry, x: number, y: number, ext: EndExtension = NO_LIMIT): StationOffset | null {
  let best: StationOffset | null = null;
  const last = g.segments.length - 1;
  // Tolerance so that points exactly at a PI are never lost to rounding.
  const eps = 1e-9 * Math.max(1, g.totalLength);
  for (let i = 0; i <= last; i++) {
    const s = g.segments[i]!;
    const px = x - s.ax;
    const py = y - s.ay;
    const t = px * s.dx + py * s.dy;
    if (t < -eps && (i !== 0 || t < -ext.before)) continue;
    if (t > s.length + eps && (i !== last || t > s.length + ext.after)) continue;
    const offset = px * s.dy - py * s.dx;
    if (!best || Math.abs(offset) < Math.abs(best.offset)) {
      best = { station: s.startStation + t, offset, segment: i };
    }
  }
  return best;
}

/** Segment containing a station (end segments cover stations beyond the alignment ends). */
export function segmentAtStation(g: AlignmentGeometry, station: number): AlignmentSegment {
  const segs = g.segments;
  for (let i = segs.length - 1; i > 0; i--) {
    if (station >= segs[i]!.startStation) return segs[i]!;
  }
  return segs[0]!;
}

/** Plan coordinates of a station / offset pair. */
export function stationToXY(g: AlignmentGeometry, station: number, offset = 0): XY {
  const s = segmentAtStation(g, station);
  const t = station - s.startStation;
  return { x: s.ax + s.dx * t + s.dy * offset, y: s.ay + s.dy * t - s.dx * offset };
}

/** Degrees → degrees, minutes, seconds text, e.g. 108°26'06". */
export function formatDMS(deg: number): string {
  const sign = deg < 0 ? '-' : '';
  let total = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(total / 3600);
  total -= d * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${sign}${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}
