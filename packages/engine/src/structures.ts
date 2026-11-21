import { type AlignmentGeometry } from './alignment';
import type { ProfileVertex } from './terrain';

/**
 * Structure geometry (PLS-CADD manual §8.2, §7.3.12.1, App. F.1).
 *
 * Top geometry is described in the structure local system (x, y, z): origin at
 * the point TOP on the structure's vertical axis, a height HT above the base
 * point BS; x along the transverse axis TS, y vertical and pointing DOWN, z
 * along the longitudinal axis LS. LS is TS rotated 90° clockwise seen from
 * above (§7.3.12.1).
 *
 * Placement: with orientation SO = 0 the transverse axis points to positive
 * offsets — perpendicular to the line on a tangent, along the bisector of the
 * line angle at a P.I. SO is positive clockwise seen from above.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Horizontal unit vector (east, north). */
export interface Dir2 {
  e: number;
  n: number;
}

export interface StructureFrame {
  /** Plan position of the base point BS. */
  baseX: number;
  baseY: number;
  ts: Dir2;
  ls: Dir2;
  /** Line angle at the structure (degrees, positive clockwise); 0 when not at a P.I. */
  lineAngle: number;
  /** Index of the P.I. the structure stands on, or null. */
  piIndex: number | null;
}

const RAD = Math.PI / 180;
const fromAzimuth = (azDeg: number): Dir2 => ({ e: Math.sin(azDeg * RAD), n: Math.cos(azDeg * RAD) });
const azimuthOf = (d: Dir2) => Math.atan2(d.e, d.n) / RAD;

/**
 * Frame of a structure placed at a station and offset of an alignment.
 *
 * A structure whose station is within `piTolerance` of an interior P.I. is at
 * that line angle: its reference transverse direction is the bisector, and its
 * offset is measured along the bisector from the P.I. (the manual does not say
 * how an offset is measured at a P.I.; the bisector is the axis it gives for
 * the structure). Elsewhere the reference is the right-hand perpendicular of
 * the alignment leg.
 */
export function structureFrame(
  g: AlignmentGeometry,
  station: number,
  offset: number,
  orientationDeg: number,
  piTolerance = 0.01,
): StructureFrame {
  let piIndex: number | null = null;
  for (let i = 1; i < g.pis.length - 1; i++) {
    if (Math.abs(g.stations[i]! - station) <= piTolerance) { piIndex = i; break; }
  }
  let ref: Dir2;
  let baseX: number;
  let baseY: number;
  if (piIndex !== null) {
    const a = g.segments[piIndex - 1]!, b = g.segments[piIndex]!;
    // Right-hand normals of the back and ahead legs; their sum points along the bisector on the positive-offset side.
    const e = a.dy + b.dy, n = -a.dx - b.dx;
    const len = Math.hypot(e, n);
    ref = len > 1e-12 ? { e: e / len, n: n / len } : { e: b.dy, n: -b.dx };
    baseX = g.pis[piIndex]!.x + ref.e * offset;
    baseY = g.pis[piIndex]!.y + ref.n * offset;
  } else {
    let seg = g.segments[0]!;
    for (const s of g.segments) if (station >= s.startStation) seg = s;
    ref = { e: seg.dy, n: -seg.dx };
    const t = station - seg.startStation;
    baseX = seg.ax + seg.dx * t + ref.e * offset;
    baseY = seg.ay + seg.dy * t + ref.n * offset;
  }
  const az = azimuthOf(ref) + orientationDeg;
  return {
    baseX, baseY,
    ts: fromAzimuth(az),
    ls: fromAzimuth(az + 90),
    lineAngle: piIndex !== null ? g.lineAngles[piIndex]! : 0,
    piIndex,
  };
}

/** Global coordinates of a point given in the structure local system (y down from TOP). */
export function localToGlobal(f: StructureFrame, topZ: number, p: Vec3): Vec3 {
  return {
    x: f.baseX + p.x * f.ts.e + p.z * f.ls.e,
    y: f.baseY + p.x * f.ts.n + p.z * f.ls.n,
    z: topZ - p.y,
  };
}

/**
 * Point C of a 2-part insulator (V-string), App. F.1.3: the conductor point at
 * distance `aLen` from attachment A and `bLen` from attachment B, in local
 * coordinates. Of the two mathematical solutions, `bottomOrRight` selects the
 * lower one — or, when AB is vertical, the one toward +x (right).
 *
 * The solution is taken in the vertical plane through A and B; when AB is
 * vertical, in the plane through AB and the transverse axis. Returns null when
 * the two parts cannot meet (|AL − BL| > AB or AL + BL < AB).
 */
export function twoPartPoint(a: Vec3, aLen: number, b: Vec3, bLen: number, bottomOrRight: boolean): Vec3 | null {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const d = Math.hypot(ux, uy, uz);
  if (!(d > 0) || aLen + bLen < d - 1e-9 || Math.abs(aLen - bLen) > d + 1e-9) return null;
  const u = { x: ux / d, y: uy / d, z: uz / d };
  const along = (aLen * aLen - bLen * bLen + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, aLen * aLen - along * along));
  // Reference direction in the solution plane: vertical (local +y is down) or, for vertical AB, transverse +x.
  const vertical = Math.abs(u.y) > 1 - 1e-9;
  const r = vertical ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const dot = r.x * u.x + r.y * u.y + r.z * u.z;
  let w = { x: r.x - dot * u.x, y: r.y - dot * u.y, z: r.z - dot * u.z };
  const wl = Math.hypot(w.x, w.y, w.z);
  w = { x: w.x / wl, y: w.y / wl, z: w.z / wl };
  // w points down (or right), so +h is the lower (or right) solution.
  const s = bottomOrRight ? h : -h;
  return {
    x: a.x + u.x * along + w.x * s,
    y: a.y + u.y * along + w.y * s,
    z: a.z + u.z * along + w.z * s,
  };
}

/** Elevation of a ground profile at a station by linear interpolation, or null outside it. */
export function profileElevation(profile: readonly ProfileVertex[], station: number): number | null {
  if (profile.length === 0) return null;
  const first = profile[0]!, last = profile[profile.length - 1]!;
  const tol = 1e-6;
  if (station < first.station - tol || station > last.station + tol) return null;
  if (profile.length === 1) return first.z;
  let lo = 0, hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid]!.station <= station) lo = mid; else hi = mid;
  }
  const p = profile[lo]!, q = profile[hi]!;
  if (q.station === p.station) return p.z;
  const t = Math.min(1, Math.max(0, (station - p.station) / (q.station - p.station)));
  return p.z + (q.z - p.z) * t;
}

/** Stations of `n` equally spaced structures from `from` to `to`, both ends included (N-paste, §10.2.3.2). */
export function equalSpacing(from: number, to: number, spans: number): number[] {
  if (!Number.isInteger(spans) || spans < 1) return [];
  return Array.from({ length: spans + 1 }, (_, i) => from + ((to - from) * i) / spans);
}

/**
 * Allowable spans of a Method 1 structure at a line angle (App. F.1.4.1): linear
 * interpolation between table rows; null beyond the largest angle in the table,
 * which is the largest line angle at which the structure may be used.
 */
export interface AllowableSpans {
  maxWindSpan: number;
  maxWeightSpan: [number, number, number];
  minWeightSpan: number;
}
export function allowableSpansAt(
  rows: readonly ({ lineAngle: number } & AllowableSpans)[],
  lineAngleDeg: number,
): AllowableSpans | null {
  const a = Math.abs(lineAngleDeg);
  const sorted = [...rows].sort((p, q) => p.lineAngle - q.lineAngle);
  if (sorted.length === 0 || a > sorted[sorted.length - 1]!.lineAngle + 1e-9) return null;
  const hi = sorted.findIndex((r) => r.lineAngle >= a - 1e-9);
  const q = sorted[hi]!;
  if (hi === 0 || Math.abs(q.lineAngle - a) < 1e-9) {
    return { maxWindSpan: q.maxWindSpan, maxWeightSpan: [...q.maxWeightSpan], minWeightSpan: q.minWeightSpan };
  }
  const p = sorted[hi - 1]!;
  const t = (a - p.lineAngle) / (q.lineAngle - p.lineAngle);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    maxWindSpan: lerp(p.maxWindSpan, q.maxWindSpan),
    maxWeightSpan: [0, 1, 2].map((k) => lerp(p.maxWeightSpan[k]!, q.maxWeightSpan[k]!)) as [number, number, number],
    minWeightSpan: lerp(p.minWeightSpan, q.minWeightSpan),
  };
}
