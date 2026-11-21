import type { Vec3 } from './structures';

/**
 * Catenary geometry and span end reactions (PLS-CADD manual App. J, App. I).
 *
 * A span lies in the plane through its chord and the direction of the
 * resultant load per unit length UR (J.1.1). In that plane the catenary has
 * constant C = H / UR, where H is the tension component perpendicular to UR;
 * without wind this is the horizontal tension.
 */

/** Arc length of a level span (2C·sinh(S/2C)); Infinity when the cable would be impossibly slack. */
export function levelArcLength(S: number, C: number): number {
  const x = S / (2 * C);
  return x > 700 ? Infinity : 2 * C * Math.sinh(x);
}

/** Mid-span sag of a level span. */
export const levelSag = (S: number, C: number) => C * (Math.cosh(S / (2 * C)) - 1);

/**
 * Average tension along the arc of a level span:
 * T̄ = H (S + C sinh(S/C)) / (2 L), from ∫T ds / L with T = H cosh(x/C).
 */
export function levelAverageTension(S: number, H: number, C: number): number {
  const L = levelArcLength(S, C);
  if (!Number.isFinite(L)) return H;
  return (H * (S + C * Math.sinh(S / C))) / (2 * L);
}

/** Catenary between two points in its own plane (J.1.1): h = horizontal, v = rise of the far end. */
export interface PlaneCatenary {
  /** Distance from the near end to the low point (J-7); may lie outside the span. */
  a: number;
  /** Mid-span sag measured from the chord (J-3). */
  sag: number;
  arc: number;
  /** Tension components along −UR at the near end and at the far end divided by H (sinh of the end slopes). */
  slopeNear: number;
  slopeFar: number;
}

export function planeCatenary(h: number, v: number, C: number): PlaneCatenary {
  const sh = Math.sinh(h / (2 * C));
  const a = h / 2 - C * Math.asinh(v / (2 * C * sh));
  const sag = C * (Math.cosh(h / (2 * C)) - 1) * Math.sqrt(1 + (v / (2 * C * sh)) ** 2);
  const arc = Math.sqrt(v * v + (2 * C * sh) ** 2);
  return { a, sag, arc, slopeNear: Math.sinh(a / C), slopeFar: Math.sinh((h - a) / C) };
}

/** Height of the catenary above the near end at distance x along the plane's horizontal axis. */
export const catenaryRise = (a: number, C: number, x: number) => C * (Math.cosh((x - a) / C) - Math.cosh(a / C));

export interface LoadPerLength {
  /** Horizontal wind load per unit length, applied perpendicular to the span (N/m). */
  uh: number;
  /** Vertical load per unit length: weight plus ice (N/m). */
  uv: number;
}

export interface SpanSolution {
  /** Swing angle of the span plane from vertical (rad), positive toward the wind. */
  beta: number;
  C: number;
  sag: number;
  arc: number;
  /** Forces exerted BY the cable ON the supports at the near (O) and far (E) ends, global x, y, z (z up). */
  forceO: Vec3;
  forceE: Vec3;
  /** Maximum tension (at the higher end). */
  tmax: number;
  /** Tension at each end. */
  tensionO: number;
  tensionE: number;
  /** Points along the wire for drawing. */
  points: Vec3[];
}

/**
 * Equilibrium shape and end forces of a cable span between O and E (J.1).
 * `windSign` +1 blows the span toward the right of the direction O→E, −1 to
 * the left, 0 for no wind. The forces are the cable's pull on each support:
 * the total equals UR × arc in the load direction, as statics requires.
 */
export function solveSpan(O: Vec3, E: Vec3, H: number, load: LoadPerLength, windSign: -1 | 0 | 1, samples = 24): SpanSolution {
  const c = { x: E.x - O.x, y: E.y - O.y, z: E.z - O.z };
  const hl = Math.hypot(c.x, c.y);
  // Unit horizontal right-hand normal of the span (direction the wind pushes when windSign = +1).
  const n = hl > 0 ? { x: c.y / hl, y: -c.x / hl, z: 0 } : { x: 1, y: 0, z: 0 };
  const uh = windSign === 0 ? 0 : load.uh;
  const ur = Math.hypot(uh, load.uv);
  // Unit load direction: down, swung by the wind.
  const u = { x: (n.x * uh * windSign) / ur, y: (n.y * uh * windSign) / ur, z: -load.uv / ur };
  const beta = Math.atan2(uh, load.uv) * (windSign || 1);
  const C = H / ur;
  // Plane coordinates: "down" along u, "horizontal" = chord minus its component along u.
  const cu = c.x * u.x + c.y * u.y + c.z * u.z;
  const hv = { x: c.x - cu * u.x, y: c.y - cu * u.y, z: c.z - cu * u.z };
  const h = Math.hypot(hv.x, hv.y, hv.z);
  const d = h > 0 ? { x: hv.x / h, y: hv.y / h, z: hv.z / h } : { x: 1, y: 0, z: 0 };
  const v = -cu; // rise of E against the load direction
  const pc = planeCatenary(h, v, C);
  // Tangent tension at each end, as force on the support: toward the span along d, and along u by the slope.
  const fO = { x: H * d.x + H * pc.slopeNear * u.x, y: H * d.y + H * pc.slopeNear * u.y, z: H * d.z + H * pc.slopeNear * u.z };
  const fE = { x: -H * d.x + H * pc.slopeFar * u.x, y: -H * d.y + H * pc.slopeFar * u.y, z: -H * d.z + H * pc.slopeFar * u.z };
  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = (h * i) / samples;
    const rise = catenaryRise(pc.a, C, x);
    points.push({ x: O.x + d.x * x - u.x * rise, y: O.y + d.y * x - u.y * rise, z: O.z + d.z * x - u.z * rise });
  }
  const tO = H * Math.sqrt(1 + pc.slopeNear ** 2), tE = H * Math.sqrt(1 + pc.slopeFar ** 2);
  return { beta, C, sag: pc.sag, arc: pc.arc, forceO: fO, forceE: fE, tmax: Math.max(tO, tE), tensionO: tO, tensionE: tE, points };
}

/**
 * Ruling span (App. I, Eq. I-1): RS = √(Σ Sᵢ⁴/Cᵢ / Σ Cᵢ), Sᵢ horizontal span lengths,
 * Cᵢ chord lengths. For a single inclined span this is S²/C.
 */
export function rulingSpan(spans: readonly { horizontal: number; chord: number }[]): number {
  let num = 0, den = 0;
  for (const s of spans) { num += s.horizontal ** 4 / s.chord; den += s.chord; }
  return den > 0 ? Math.sqrt(num / den) : NaN;
}

/**
 * Weight span by the "arc length" model (App. I.3): the cable is assumed to lie
 * in the vertical plane with C = H / UR; the weight span contribution of one
 * span at its near end is the arc length from the support to the low point,
 * positive when the low point is inside the span side away from the support.
 * Returns the contributions at the near (O) and far (E) ends.
 */
export function arcLengthWeightSpans(horizontal: number, rise: number, C: number): { atNear: number; atFar: number } {
  const pc = planeCatenary(horizontal, rise, C);
  // Signed arc length from x = 0 to the low point x = a, and from the low point to x = h.
  const s = (x: number) => C * Math.sinh((x - pc.a) / C);
  return { atNear: s(pc.a) - s(0), atFar: s(horizontal) - s(pc.a) };
}

/** Suspension insulator swing angle (Eq. 7-37), degrees, positive toward +T. */
export const suspensionSwing = (T: number, V: number, windOnInsulator: number, insulatorWeight: number, counterweight: number) =>
  (Math.atan2(T + windOnInsulator / 2, V + counterweight + insulatorWeight / 2) * 180) / Math.PI;

/** 2-part insulator load angle (Eq. 7-38), degrees. */
export const twoPartLoadAngle = (T: number, V: number, windOnInsulator: number, insulatorWeight: number, counterweight: number) =>
  (Math.atan2(T + windOnInsulator, V + counterweight + insulatorWeight) * 180) / Math.PI;
