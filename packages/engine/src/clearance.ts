import type { Vec3 } from './structures';
import type { Tin } from './terrain';

/**
 * Clearance geometry (PLS-CADD manual §6.1.1, §7.3.13–7.3.15, §11.2.3, §8.3.2).
 * Pure geometry: wire shapes come from the catenary module and required
 * clearances from the user's feature-code table; nothing here supplies a
 * code value.
 */

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3, t = 1): Vec3 => ({ x: a.x + b.x * t, y: a.y + b.y * t, z: a.z + b.z * t });
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

// ------------------------------------------------------------------ Survey point clearances (§6.1.1)

/**
 * Points where a wire polyline pierces the vertical plane through `origin`
 * whose horizontal normal is `dir` (the alignment direction at the survey
 * point, so that the plane is perpendicular to the alignment, Fig. 6.1-3).
 */
export function piercePlane(poly: readonly Vec3[], origin: { x: number; y: number }, dir: { x: number; y: number }): Vec3[] {
  const out: Vec3[] = [];
  const f = (p: Vec3) => (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!, b = poly[i]!;
    const fa = f(a), fb = f(b);
    if (fa === 0 && fb === 0) continue;
    if ((fa <= 0 && fb > 0) || (fa >= 0 && fb < 0) || (fa > 0 && fb === 0 && i === poly.length - 1) || (fa < 0 && fb === 0 && i === poly.length - 1)) {
      const t = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

export interface SurveyPointZone {
  /** Plan position and the elevation of the top of the point (survey elevation + obstacle height). */
  x: number;
  y: number;
  top: number;
  /** Ground elevation under the point (the surveyed elevation). */
  ground: number;
  aerial: boolean;
  /** Required vertical clearance RV. */
  rv: number;
  /** Required horizontal clearance RH; 0 = band check (§6.1.1). */
  rh: number;
}

export interface ZoneCheck {
  kind: 'rectangle' | 'band';
  /** Horizontal distance from the point to the wire within the plane (positive to the right of `dir`). */
  lateral: number;
  /** Wire elevation minus the top of the point. */
  vertical: number;
  /**
   * Signed clearance to the edge of the zone: positive = the wire is outside
   * by that distance, negative = inside (violation for a rectangle,
   * questionable for a band).
   */
  margin: number;
  inside: boolean;
}

/**
 * Rectangular (RH > 0) or band (RH = 0) zone of Fig. 6.1-3: the upper edge is
 * RV above the point; the lower edge is the ground under a ground point, or RV
 * below an aerial obstacle.
 */
export function zoneCheck(z: SurveyPointZone, wire: Vec3, dir: { x: number; y: number }): ZoneCheck {
  const lateral = (wire.x - z.x) * dir.y - (wire.y - z.y) * dir.x;
  const vertical = wire.z - z.top;
  const upper = z.top + z.rv;
  // Fig. 6.1-3 puts the lower edge on the ground under a ground point. A wire found below the ground (only possible when
  // the terrain data put it there) is reported as inside the zone rather than passing: the zone is extended downward.
  const lower = z.aerial ? z.top - z.rv : -Infinity;
  const outV = Math.max(wire.z - upper, lower - wire.z);
  if (z.rh > 0) {
    const outH = Math.abs(lateral) - z.rh;
    // Outside a corner the distance to the zone is Euclidean; otherwise it is the larger axis distance (negative inside).
    const margin = outV > 0 && outH > 0 ? Math.hypot(outV, outH) : Math.max(outV, outH);
    return { kind: 'rectangle', lateral, vertical, margin, inside: outV < 0 && outH < 0 };
  }
  return { kind: 'band', lateral, vertical, margin: outV, inside: outV < 0 };
}

// ------------------------------------------------------------------ 3-D distances

/** Closest points of segments [a0,a1] and [b0,b1] (standard clamped solution). */
export function segmentDistance(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3): { d: number; pa: Vec3; pb: Vec3 } {
  const u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0);
  const a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w);
  const D = a * c - b * b;
  let s: number, t: number;
  if (a < 1e-18 && c < 1e-18) { s = 0; t = 0; }
  else if (a < 1e-18) { s = 0; t = clamp01(e / c); }
  else if (c < 1e-18) { t = 0; s = clamp01(-d / a); }
  else {
    s = D > 1e-18 ? clamp01((b * e - c * d) / D) : 0;
    t = (b * s + e) / c;
    if (t < 0) { t = 0; s = clamp01(-d / a); } else if (t > 1) { t = 1; s = clamp01((b - d) / a); }
  }
  const pa = add(a0, u, s), pb = add(b0, v, t);
  return { d: Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z), pa, pb };
}

/** Horizontal-only version: distance measured in the horizontal plane (§11.2.3.2.2). */
export function segmentDistanceHorizontal(a0: Vec3, a1: Vec3, b0: Vec3, b1: Vec3) {
  const flat = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: 0 });
  const r = segmentDistance(flat(a0), flat(a1), flat(b0), flat(b1));
  return r;
}

/** Shortest distance between a point and a polyline. */
export function pointPolylineDistance(p: Vec3, poly: readonly Vec3[]): { d: number; at: Vec3 } {
  let best = { d: Infinity, at: poly[0]! };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!, b = poly[i]!;
    const ab = sub(b, a);
    const L = dot(ab, ab);
    const t = L > 0 ? clamp01(dot(sub(p, a), ab) / L) : 0;
    const q = add(a, ab, t);
    const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
    if (d < best.d) best = { d, at: q };
  }
  return best;
}

interface Box { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
const boxOf = (pts: readonly Vec3[]): Box => {
  const b = { x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity };
  for (const p of pts) {
    if (p.x < b.x0) b.x0 = p.x; if (p.x > b.x1) b.x1 = p.x;
    if (p.y < b.y0) b.y0 = p.y; if (p.y > b.y1) b.y1 = p.y;
    if (p.z < b.z0) b.z0 = p.z; if (p.z > b.z1) b.z1 = p.z;
  }
  return b;
};
const boxGap = (a: Box, b: Box, horizontal: boolean) => {
  const gx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), gy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  const gz = horizontal ? 0 : Math.max(0, a.z0 - b.z1, b.z0 - a.z1);
  return Math.hypot(gx, gy, gz);
};

/**
 * Shortest distance between two wire polylines, 3-D or horizontal. `limit`
 * skips pairs whose bounding boxes are farther apart than the best found
 * so far (or than `limit`).
 */
export function polylineDistance(A: readonly Vec3[], B: readonly Vec3[], horizontal = false, limit = Infinity): { d: number; pa: Vec3; pb: Vec3 } | null {
  if (A.length < 2 || B.length < 2) return null;
  if (boxGap(boxOf(A), boxOf(B), horizontal) > limit) return null;
  let best: { d: number; pa: Vec3; pb: Vec3 } | null = null;
  const segBoxes = (P: readonly Vec3[]) => P.slice(1).map((q, i) => boxOf([P[i]!, q]));
  const bA = segBoxes(A), bB = segBoxes(B);
  for (let i = 0; i < bA.length; i++) {
    for (let j = 0; j < bB.length; j++) {
      if (best && boxGap(bA[i]!, bB[j]!, horizontal) >= best.d) continue;
      const r = horizontal
        ? segmentDistanceHorizontal(A[i]!, A[i + 1]!, B[j]!, B[j + 1]!)
        : segmentDistance(A[i]!, A[i + 1]!, B[j]!, B[j + 1]!);
      if (!best || r.d < best.d) {
        // Report the 3-D points even for the horizontal measure.
        best = horizontal ? { d: r.d, pa: interp(A[i]!, A[i + 1]!, r.pa), pb: interp(B[j]!, B[j + 1]!, r.pb) } : r;
      }
    }
  }
  return best;
}
/** Lift a plan point found on the flattened segment back onto the 3-D segment. */
function interp(a: Vec3, b: Vec3, flat: Vec3): Vec3 {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const t = L > 0 ? Math.hypot(flat.x - a.x, flat.y - a.y) / L : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Ice jump envelope (§11.2.3.2.2): each point of the jumped wire is the
 * reflection of its iced position about its un-iced position at the same
 * temperature. Both polylines must be sampled at the same chord stations.
 */
export function iceJump(iced: readonly Vec3[], unIced: readonly Vec3[]): Vec3[] {
  return iced.map((p, i) => {
    const q = unIced[i]!;
    return { x: 2 * q.x - p.x, y: 2 * q.y - p.y, z: 2 * q.z - p.z };
  });
}

// ------------------------------------------------------------------ Clearance to TIN (§11.2.3.4)

/** Closest point of triangle abc to p (Ericson, Real-Time Collision Detection, §5.1.5). */
export function pointTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return add(add(a, ab, vb * den), ac, vc * den);
}

/** Uniform plan grid over TIN triangles for nearest-surface queries. */
export interface TinIndex { tin: Tin; cell: number; x0: number; y0: number; nx: number; ny: number; cells: Map<number, number[]> }

export function indexTin(tin: Tin, cell: number): TinIndex {
  const v = tin.vertices, tr = tin.triangles;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < v.length; i += 3) { x0 = Math.min(x0, v[i]!); x1 = Math.max(x1, v[i]!); y0 = Math.min(y0, v[i + 1]!); y1 = Math.max(y1, v[i + 1]!); }
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  const cells = new Map<number, number[]>();
  for (let t = 0; t < tr.length; t += 3) {
    const xs = [v[tr[t]! * 3]!, v[tr[t + 1]! * 3]!, v[tr[t + 2]! * 3]!], ys = [v[tr[t]! * 3 + 1]!, v[tr[t + 1]! * 3 + 1]!, v[tr[t + 2]! * 3 + 1]!];
    const i0 = Math.floor((Math.min(...xs) - x0) / cell), i1 = Math.floor((Math.max(...xs) - x0) / cell);
    const j0 = Math.floor((Math.min(...ys) - y0) / cell), j1 = Math.floor((Math.max(...ys) - y0) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = j * (nx + 1) + i;
      let a = cells.get(k);
      if (!a) cells.set(k, (a = []));
      a.push(t / 3);
    }
  }
  return { tin, cell, x0, y0, nx, ny, cells };
}

/** Elevation of the TIN surface at a plan point, using the grid index (null outside the surface). */
export function elevationOnTin(ix: TinIndex, x: number, y: number): number | null {
  const v = ix.tin.vertices, tr = ix.tin.triangles;
  const i = Math.floor((x - ix.x0) / ix.cell), j = Math.floor((y - ix.y0) / ix.cell);
  if (i < 0 || j < 0 || i > ix.nx || j > ix.ny) return null;
  for (const t of ix.cells.get(j * (ix.nx + 1) + i) ?? []) {
    const a = tr[t * 3]! * 3, b = tr[t * 3 + 1]! * 3, c = tr[t * 3 + 2]! * 3;
    const x1 = v[a]!, y1 = v[a + 1]!, x2 = v[b]!, y2 = v[b + 1]!, x3 = v[c]!, y3 = v[c + 1]!;
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (det === 0) continue;
    const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
    const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-12 && l2 >= -1e-12 && l3 >= -1e-12) return l1 * v[a + 2]! + l2 * v[b + 2]! + l3 * v[c + 2]!;
  }
  return null;
}

/**
 * Shortest 3-D distance from p to the TIN surface, searching triangles within
 * `reach` in plan. Null when no triangle is within reach.
 */
export function distanceToTin(ix: TinIndex, p: Vec3, reach: number): { d: number; at: Vec3 } | null {
  const v = ix.tin.vertices, tr = ix.tin.triangles;
  const i0 = Math.floor((p.x - reach - ix.x0) / ix.cell), i1 = Math.floor((p.x + reach - ix.x0) / ix.cell);
  const j0 = Math.floor((p.y - reach - ix.y0) / ix.cell), j1 = Math.floor((p.y + reach - ix.y0) / ix.cell);
  const seen = new Set<number>();
  let best: { d: number; at: Vec3 } | null = null;
  const P = (k: number): Vec3 => ({ x: v[k * 3]!, y: v[k * 3 + 1]!, z: v[k * 3 + 2]! });
  for (let i = Math.max(0, i0); i <= Math.min(ix.nx, i1); i++) for (let j = Math.max(0, j0); j <= Math.min(ix.ny, j1); j++) {
    for (const t of ix.cells.get(j * (ix.nx + 1) + i) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      const q = pointTriangle(p, P(tr[t * 3]!), P(tr[t * 3 + 1]!), P(tr[t * 3 + 2]!));
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (!best || d < best.d) best = { d, at: q };
    }
  }
  return best;
}

// ------------------------------------------------------------------ Galloping ellipses (§7.3.15)

export type GallopingMethod = 'reaSingle' | 'reaDouble' | 'cigreSingle' | 'cigreBundle';

export interface GallopingParams { major: number; minor: number; b: number; esw: number }

/**
 * Ellipse parameters, Eqs. 7-22 to 7-36 (lengths in metres, angles in degrees).
 * `sag` from the galloping sag condition, `ssw` the span swing angle from the
 * galloping swing condition, `span` the span length (double loop), `dia` the
 * (sub)conductor diameter (CIGRE). GSF multiplies MAJOR; ESW may be set to 0.
 */
export function gallopingEllipse(method: GallopingMethod, p: { sag: number; ssw: number; span: number; dia: number; gsf: number; eswZero: boolean }):
  { ok: true; value: GallopingParams } | { ok: false; message: string } {
  let major: number, minor: number, b: number, esw: number;
  if (method === 'reaSingle') {
    esw = p.ssw / 2;                                     // 7-22
    major = 1.25 * p.sag + 0.3048;                       // 7-23
    minor = 0.4 * major;                                 // 7-24
    b = 0.25 * p.sag;                                    // 7-25
  } else if (method === 'reaDouble') {
    const L = p.span, A = Math.sqrt((L / 2) ** 2 + p.sag ** 2);
    const r = (3 * A / 8) * (L + (8 * p.sag * p.sag) / (3 * L) - 2 * A);
    if (!(r >= 0)) return { ok: false, message: 'Eq. 7-26 has no real value for this span and sag.' };
    major = Math.sqrt(r) + 0.3048;                       // 7-26
    minor = 1.104 * Math.sqrt(major - 0.3048);           // 7-27
    b = 0.2 * major;                                     // 7-28
    esw = p.ssw / 2;                                     // 7-22 applies to the REA method
  } else {
    const k = method === 'cigreSingle' ? 80 : 170, den = method === 'cigreSingle' ? 50 : 500;
    const arg = (8 * p.sag) / (den * p.dia);
    if (!(arg > 1)) return { ok: false, message: `The CIGRE equation (${method === 'cigreSingle' ? '7-29' : '7-33'}) gives no positive major axis: 8·SAG/(${den}·DIA) ≤ 1.` };
    major = p.dia * k * Math.log(arg);                   // 7-29 / 7-33
    minor = 0.4 * major;                                 // 7-30 / 7-34
    b = 0.3 * major;                                     // 7-31 / 7-35
    esw = 0;                                             // 7-32 / 7-36
  }
  // GSF multiplies MAJOR (§7.3.15); MINOR and B are then taken from the factored MAJOR where their equations use it.
  if (p.gsf !== 1) {
    major *= p.gsf;
    if (method === 'reaSingle') minor = 0.4 * major;
    else if (method === 'reaDouble') { minor = 1.104 * Math.sqrt(Math.max(0, major - 0.3048)); b = 0.2 * major; }
    else { minor = 0.4 * major; b = 0.3 * major; }
  }
  if (p.eswZero) esw = 0;
  return { ok: true, value: { major, minor, b, esw } };
}

/**
 * Ellipse outline in a cross-section plane: `centre` given by the caller,
 * major axis inclined `incl` degrees from vertical toward +u (horizontal
 * direction in the plane). Returns points (u, z) offsets from the origin.
 */
export function ellipseOutline(cu: number, cz: number, major: number, minor: number, inclDeg: number, n = 72): { u: number; z: number }[] {
  const t = (inclDeg * Math.PI) / 180, s = Math.sin(t), c = Math.cos(t);
  const out: { u: number; z: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const x = (minor / 2) * Math.cos(a), y = (major / 2) * Math.sin(a); // x across, y along the major axis
    out.push({ u: cu + x * c + y * s, z: cz - x * s + y * c });
  }
  return out;
}

/** Shortest distance between two closed outlines in a plane, 0 if they overlap (edges cross or one contains the other). */
export function outlineDistance(a: { u: number; z: number }[], b: { u: number; z: number }[]): number {
  const P = (q: { u: number; z: number }): Vec3 => ({ x: q.u, y: q.z, z: 0 });
  const inside = (p: { u: number; z: number }, poly: { u: number; z: number }[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const pi = poly[i]!, pj = poly[j]!;
      if ((pi.z > p.z) !== (pj.z > p.z) && p.u < ((pj.u - pi.u) * (p.z - pi.z)) / (pj.z - pi.z) + pi.u) c = !c;
    }
    return c;
  };
  if (inside(a[0]!, b) || inside(b[0]!, a)) return 0;
  return polylineDistance(a.map(P), b.map(P))?.d ?? Infinity;
}

// ------------------------------------------------------------------ Method 2 interaction diagrams (§8.3.2)

/**
 * Whether the actual (wind span, weight span) point lies inside the allowable
 * interaction diagram, a polygon in the (HS, VS) plane (Fig. 8.3-2), and the
 * usage: the ratio of the distance to the point to the distance to the
 * diagram boundary along the ray from the origin, in percent.
 */
export function interactionUsage(diagram: readonly [number, number][], hs: number, vs: number): { inside: boolean; usage: number } {
  const poly = diagram;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > vs) !== (yj > vs) && hs < ((xj - xi) * (vs - yi)) / (yj - yi) + xi) inside = !inside;
  }
  // Ray from the origin through (hs, vs): nearest boundary crossing beyond the origin.
  const r = Math.hypot(hs, vs);
  let tMin = Infinity;
  if (r > 0) {
    const dx = hs / r, dy = vs / r;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[j]!, [x2, y2] = poly[i]!;
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = (x1 * ey - y1 * ex) / den;      // distance along the ray
      const s = (x1 * dy - y1 * dx) / den;      // parameter along the edge
      if (t > 1e-12 && s >= -1e-12 && s <= 1 + 1e-12) tMin = Math.min(tMin, t);
    }
  }
  const usage = r === 0 ? 0 : Number.isFinite(tMin) ? (100 * r) / tMin : Infinity;
  return { inside, usage };
}
