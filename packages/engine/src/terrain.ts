import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { projectPoint, type AlignmentGeometry, type EndExtension } from './alignment';

/**
 * Terrain profiles and TIN (PLS-CADD manual §6.3.2, §6.4, §6.10.1).
 */

export interface SurveyPoint {
  x: number;
  y: number;
  /** Elevation of the surveyed point. */
  z: number;
  /** Obstacle height above the surveyed point (0 if none). */
  h: number;
  /** True when the feature code is flagged "Point is on Ground". */
  onGround: boolean;
}

export interface ProjectedPoint {
  /** Index into the source array. */
  i: number;
  station: number;
  offset: number;
}

export interface ProfileVertex {
  station: number;
  z: number;
}

/** Project survey points on an alignment; points that cannot be projected are counted. */
export function projectPoints(
  g: AlignmentGeometry,
  pts: readonly SurveyPoint[],
  ext?: EndExtension,
): { projected: ProjectedPoint[]; unprojectable: number } {
  const projected: ProjectedPoint[] = [];
  let unprojectable = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const so = projectPoint(g, p.x, p.y, ext);
    if (so) projected.push({ i, station: so.station, offset: so.offset });
    else unprojectable++;
  }
  return { projected, unprojectable };
}

/**
 * Centerline ground profile (§6.3.2): the line joining, in ascending order of
 * stations, all ground points within the Maximum Offset for Centerline Ground
 * Profile (MOCGP) of the centerline.
 */
export function centerlineProfile(pts: readonly SurveyPoint[], projected: readonly ProjectedPoint[], mocgp: number): ProfileVertex[] {
  return projected
    .filter((q) => pts[q.i]!.onGround && Math.abs(q.offset) <= mocgp)
    .map((q) => ({ station: q.station, z: pts[q.i]!.z }))
    .sort((a, b) => a.station - b.station);
}

/**
 * Side profile (§6.10.1): ground points within `tolerance` of the line at
 * `offset`, joined in order of increasing station; adjacent points farther
 * apart than `maxSeparation` are not connected, giving separate polylines.
 */
export function sideProfile(
  pts: readonly SurveyPoint[],
  projected: readonly ProjectedPoint[],
  offset: number,
  tolerance: number,
  maxSeparation: number,
): ProfileVertex[][] {
  const sel = projected
    .filter((q) => pts[q.i]!.onGround && Math.abs(q.offset - offset) <= tolerance)
    .map((q) => ({ station: q.station, z: pts[q.i]!.z }))
    .sort((a, b) => a.station - b.station);
  const lines: ProfileVertex[][] = [];
  let cur: ProfileVertex[] = [];
  for (const v of sel) {
    const prev = cur[cur.length - 1];
    if (prev && v.station - prev.station > maxSeparation) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
    }
    cur.push(v);
  }
  if (cur.length > 1) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- TIN

export interface Tin {
  /** Vertex coordinates [x0, y0, z0, x1, …]. */
  vertices: Float64Array;
  /** Vertex indices, three per triangle. */
  triangles: Uint32Array;
}

/** Break line segment with known end points in 3-D (§6.5, App. D.6). */
export interface BreakSegment {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
}

export interface TinOptions {
  /** Triangles with any side longer than this are deleted (§6.4.2 "maximum triangle edge width"). */
  maxEdge?: number;
  /** Break lines: triangle edges are forced to coincide with them (§6.5.1). */
  breakLines?: readonly BreakSegment[];
  /** Receives the number of break line segments that could not be enforced. */
  report?: { breakLinesSkipped: number };
}

/**
 * Delaunay TIN of the ground points (§6.4.1). Points with identical plan
 * coordinates are merged (the first is kept), since a surface cannot have two
 * elevations at one location.
 *
 * Break line end points become TIN vertices, and each segment is enforced as a
 * triangle edge (constrained Delaunay). A segment that crosses another break
 * line or passes through a third vertex cannot be enforced as a single edge;
 * it is skipped and counted in `report`.
 */
export function buildTin(pts: readonly SurveyPoint[], opts: TinOptions = {}): Tin | null {
  const index = new Map<string, number>();
  const xs: number[] = [];
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${x},${y}`;
    let i = index.get(key);
    if (i === undefined) {
      i = xs.length / 3;
      index.set(key, i);
      xs.push(x, y, z);
    }
    return i;
  };
  for (const p of pts) if (p.onGround) vertex(p.x, p.y, p.z);
  const constraints: [number, number][] = [];
  for (const b of opts.breakLines ?? []) {
    const i = vertex(b.ax, b.ay, b.az);
    const j = vertex(b.bx, b.by, b.bz);
    if (i !== j) constraints.push([i, j]);
  }
  const n = xs.length / 3;
  if (n < 3) return null;
  const coords = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    coords[2 * i] = xs[3 * i]!;
    coords[2 * i + 1] = xs[3 * i + 1]!;
  }
  const d = new Delaunator(coords);
  if (constraints.length > 0 && d.triangles.length > 0) {
    const con = new Constrainautor(d);
    let skipped = 0;
    for (const [i, j] of constraints) {
      try { con.constrainOne(i, j); } catch { skipped++; }
    }
    if (opts.report) opts.report.breakLinesSkipped = skipped;
  }
  const maxEdge = opts.maxEdge ?? Infinity;
  const keep: number[] = [];
  const len = (a: number, b: number) => Math.hypot(coords[2 * a]! - coords[2 * b]!, coords[2 * a + 1]! - coords[2 * b + 1]!);
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t]!, b = d.triangles[t + 1]!, c = d.triangles[t + 2]!;
    if (len(a, b) <= maxEdge && len(b, c) <= maxEdge && len(c, a) <= maxEdge) keep.push(a, b, c);
  }
  if (keep.length === 0) return null;
  return { vertices: Float64Array.from(xs), triangles: Uint32Array.from(keep) };
}

/** Elevation of the TIN surface at (x, y), or null outside the surface. */
export function tinElevation(tin: Tin, x: number, y: number): number | null {
  const v = tin.vertices;
  const tr = tin.triangles;
  for (let t = 0; t < tr.length; t += 3) {
    const a = tr[t]! * 3, b = tr[t + 1]! * 3, c = tr[t + 2]! * 3;
    const x1 = v[a]!, y1 = v[a + 1]!, x2 = v[b]!, y2 = v[b + 1]!, x3 = v[c]!, y3 = v[c + 1]!;
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (det === 0) continue;
    const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
    const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
    const l3 = 1 - l1 - l2;
    const e = -1e-12;
    if (l1 >= e && l2 >= e && l3 >= e) return l1 * v[a + 2]! + l2 * v[b + 2]! + l3 * v[c + 2]!;
  }
  return null;
}

/**
 * Ground profile cut through the TIN along the line at a constant offset from
 * the alignment: one vertex wherever that line crosses a triangle edge or
 * passes through a triangle vertex, plus the segment ends. Because the TIN is
 * piecewise planar, joining these vertices reproduces the surface exactly.
 * This is the basis of "interpolated points" (§6.4.4).
 */
export function tinProfile(tin: Tin, g: AlignmentGeometry, offset = 0, includeSegmentEnds = true): ProfileVertex[] {
  const v = tin.vertices;
  const tr = tin.triangles;
  // Unique edges.
  const edges = new Map<number, [number, number]>();
  const nv = v.length / 3;
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    edges.set(lo * nv + hi, [lo, hi]);
  };
  for (let t = 0; t < tr.length; t += 3) {
    add(tr[t]!, tr[t + 1]!); add(tr[t + 1]!, tr[t + 2]!); add(tr[t + 2]!, tr[t]!);
  }
  const out: ProfileVertex[] = [];
  for (const s of g.segments) {
    // Offset line of this segment: origin o, direction d, for 0 ≤ t ≤ length.
    const ox = s.ax + s.dy * offset;
    const oy = s.ay - s.dx * offset;
    const tol = 1e-9 * Math.max(1, s.length);
    for (const [a, b] of edges.values()) {
      const ax = v[a * 3]! - ox, ay = v[a * 3 + 1]! - oy;
      const bx = v[b * 3]! - ox, by = v[b * 3 + 1]! - oy;
      // Signed distances of the edge ends from the line (positive to the right).
      const da = ax * s.dy - ay * s.dx;
      const db = bx * s.dy - by * s.dx;
      if ((da > tol && db > tol) || (da < -tol && db < -tol)) continue;
      const denom = da - db;
      if (Math.abs(denom) <= tol) continue; // edge lies along the line: its end points are found through other edges
      const u = da / denom;
      const t = (ax + (bx - ax) * u) * s.dx + (ay + (by - ay) * u) * s.dy;
      if (t < -tol || t > s.length + tol) continue;
      out.push({ station: s.startStation + t, z: v[a * 3 + 2]! + (v[b * 3 + 2]! - v[a * 3 + 2]!) * u });
    }
    for (const t of includeSegmentEnds ? [0, s.length] : []) {
      const z = tinElevation(tin, ox + s.dx * t, oy + s.dy * t);
      if (z !== null) out.push({ station: s.startStation + t, z });
    }
  }
  out.sort((p, q) => p.station - q.station);
  // Remove duplicates produced by shared vertices and segment ends.
  const dedup: ProfileVertex[] = [];
  for (const p of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(prev.station - p.station) < 1e-7 && Math.abs(prev.z - p.z) < 1e-7) continue;
    dedup.push(p);
  }
  return dedup;
}

/** Contour line segment at a constant elevation: [x1, y1, x2, y2]. */
export interface ContourLevel {
  z: number;
  /** Flat array of segment end points: x1, y1, x2, y2, … */
  segments: number[];
}

/**
 * Contour lines of the TIN at multiples of `interval` (§6.4.3). Each triangle
 * is planar, so a contour crosses it in one straight segment between the two
 * edges that straddle the level. A vertex lying exactly on a level is treated
 * as just above it, which keeps contours continuous across triangles.
 */
export function tinContours(tin: Tin, interval: number): ContourLevel[] {
  if (!(interval > 0)) return [];
  const v = tin.vertices;
  const tr = tin.triangles;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 2; i < v.length; i += 3) { if (v[i]! < zMin) zMin = v[i]!; if (v[i]! > zMax) zMax = v[i]!; }
  const first = Math.ceil(zMin / interval);
  const last = Math.floor(zMax / interval);
  if (last - first > 5000) return []; // interval far too small for this surface
  const levels: ContourLevel[] = [];
  for (let k = first; k <= last; k++) levels.push({ z: k * interval, segments: [] });
  for (let t = 0; t < tr.length; t += 3) {
    const idx = [tr[t]! * 3, tr[t + 1]! * 3, tr[t + 2]! * 3] as const;
    const zs = [v[idx[0] + 2]!, v[idx[1] + 2]!, v[idx[2] + 2]!] as const;
    const lo = Math.min(zs[0], zs[1], zs[2]);
    const hi = Math.max(zs[0], zs[1], zs[2]);
    for (let k = Math.max(first, Math.ceil(lo / interval)); k <= Math.min(last, Math.floor(hi / interval)); k++) {
      const z = k * interval;
      const pts: number[] = [];
      for (let e = 0; e < 3; e++) {
        const a = idx[e]!, b = idx[(e + 1) % 3]!;
        const za = zs[e]!, zb = zs[(e + 1) % 3]!;
        if ((za >= z) === (zb >= z)) continue;
        const u = (z - za) / (zb - za);
        pts.push(v[a]! + (v[b]! - v[a]!) * u, v[a + 1]! + (v[b + 1]! - v[a + 1]!) * u);
      }
      // A level touching only a summit vertex gives a zero-length segment; it is not a contour line.
      if (pts.length === 4 && (pts[0] !== pts[2] || pts[1] !== pts[3])) levels[k - first]!.segments.push(pts[0]!, pts[1]!, pts[2]!, pts[3]!);
    }
  }
  return levels.filter((l) => l.segments.length > 0);
}
