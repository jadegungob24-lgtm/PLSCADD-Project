/**
 * Cable stress-strain and creep coefficients from test data (PLS-CADD manual
 * App. G.1, Eqs. 9-1, 9-3, 9-8).
 *
 * The manual states that the program "runs regressions between the pairs of
 * tension-initial and tension-creep data points" for a cable treated as one
 * homogeneous material, but not the regression details. This implementation:
 *  - converts tension to stress by dividing by the total area AT;
 *  - fits all five coefficients of σ = c0 + c1 ε + … + c4 ε⁴ (ε in percent)
 *    by ordinary least squares (Householder QR), unweighted;
 *  - for creep, takes the total elongation after creep as the initial
 *    elongation at that stress (from the fitted initial curve) plus the given
 *    creep elongation, since the manual defines the creep elongation as the
 *    elongation "beyond the initial elongation" (App. G.1, §9.1.2).
 * These choices are reported with the result.
 */

/** Least-squares polynomial fit y ≈ Σ c_k x^k, k = 0..degree. Returns null if the system is rank deficient. */
export function polyfit(x: readonly number[], y: readonly number[], degree: number): number[] | null {
  const m = x.length, n = degree + 1;
  if (m < n || y.length !== m) return null;
  // Scale x to [-1, 1] range magnitude for conditioning, then undo the scaling on the coefficients.
  const s = Math.max(...x.map(Math.abs)) || 1;
  const A = x.map((xi) => Array.from({ length: n }, (_, k) => Math.pow(xi / s, k)));
  const b = [...y];
  // Householder QR.
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += A[i]![k]! ** 2;
    norm = Math.sqrt(norm);
    if (norm < 1e-14) return null;
    const alpha = A[k]![k]! > 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = A[i]![k]!;
    v[k]! -= alpha;
    const vv = v.reduce((acc, vi) => acc + vi * vi, 0);
    if (vv < 1e-300) continue;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += v[i]! * A[i]![j]!;
      const f = (2 * dot) / vv;
      for (let i = k; i < m; i++) A[i]![j]! -= f * v[i]!;
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += v[i]! * b[i]!;
    const f = (2 * dot) / vv;
    for (let i = k; i < m; i++) b[i]! -= f * v[i]!;
  }
  const c = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    let sum = b[k]!;
    for (let j = k + 1; j < n; j++) sum -= A[k]![j]! * c[j]!;
    if (Math.abs(A[k]![k]!) < 1e-14) return null;
    c[k] = sum / A[k]![k]!;
  }
  return c.map((ck, k) => ck / Math.pow(s, k));
}

export const polyval = (c: readonly number[], x: number) => c.reduce((acc, ck, k) => acc + ck * Math.pow(x, k), 0);

/**
 * Strain (percent) at which an increasing polynomial reaches `stress`, searched
 * on [0, maxStrain]; null when the curve does not reach that stress there.
 */
export function strainAtStress(c: readonly number[], stress: number, maxStrain: number): number | null {
  let lo = 0, hi = maxStrain;
  const f = (e: number) => polyval(c, e) - stress;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface CableTestData {
  /** Total cross-section area AT (m²). */
  area: number;
  /** Pairs [tension (N), initial elongation (%)]. */
  initial: readonly [number, number][];
  /** Pairs [tension (N), creep elongation beyond initial (%)]. */
  creep: readonly [number, number][];
}

export interface CableFit {
  /** Initial curve coefficients a0..a4 (Pa, ε in %). */
  initial: number[];
  /** Creep curve coefficients c0..c4 (Pa, ε in %). */
  creep: number[];
  /** Root-mean-square stress residual of each fit (Pa). */
  rmsInitial: number;
  rmsCreep: number;
  /** Total elongation after creep used for the creep fit (%), in input order. */
  creepTotalStrain: number[];
  /** Initial curve slope at the origin (a1), the manual's guide value for the final modulus. */
  slopeAtOrigin: number;
  warnings: string[];
}

export type CableFitResult = { ok: true; fit: CableFit } | { ok: false; message: string };

export function fitCableTestData(t: CableTestData): CableFitResult {
  if (!(t.area > 0)) return { ok: false, message: 'The cross-section area must be greater than zero.' };
  if (t.initial.length < 5) return { ok: false, message: 'At least 5 initial (tension, elongation) points are needed to fit a 4th-degree polynomial.' };
  if (t.creep.length < 5) return { ok: false, message: 'At least 5 creep (tension, elongation) points are needed to fit a 4th-degree polynomial.' };
  const bad = [...t.initial, ...t.creep].find(([T, e]) => !Number.isFinite(T) || !Number.isFinite(e) || T < 0 || e < 0);
  if (bad) return { ok: false, message: 'Tensions and elongations must be non-negative numbers.' };

  const warnings: string[] = [];
  const ei = t.initial.map(([, e]) => e);
  const si = t.initial.map(([T]) => T / t.area);
  const a = polyfit(ei, si, 4);
  if (!a) return { ok: false, message: 'The initial data do not determine a 4th-degree polynomial (repeated elongations?).' };
  const maxE = Math.max(...ei);
  // The manual asks for a non-zero first point near zero to tie the curve near the origin.
  if (Math.min(...ei) > 0.01) warnings.push('No initial point near zero elongation; the fitted curve near the origin is unconstrained (App. G.1 recommends a small non-zero first point).');
  for (let k = 0; k < 50; k++) {
    const e0 = (maxE * k) / 49, e1 = (maxE * (k + 1)) / 49;
    if (polyval(a, e1) < polyval(a, e0) - 1e-6 * Math.max(...si)) {
      warnings.push('The fitted initial curve decreases somewhere within the test range; check the data.');
      break;
    }
  }

  const ec: number[] = [];
  for (const [T, creepE] of t.creep) {
    const e = strainAtStress(a, T / t.area, maxE * 1.5);
    if (e === null) return { ok: false, message: `A creep tension of ${T.toFixed(0)} N is outside the fitted initial curve, so its initial elongation is unknown.` };
    ec.push(e + creepE);
  }
  const sc = t.creep.map(([T]) => T / t.area);
  const c = polyfit(ec, sc, 4);
  if (!c) return { ok: false, message: 'The creep data do not determine a 4th-degree polynomial.' };

  const rms = (coef: number[], xs: number[], ys: number[]) => Math.sqrt(xs.reduce((acc, x, i) => acc + (polyval(coef, x) - ys[i]!) ** 2, 0) / xs.length);
  return {
    ok: true,
    fit: {
      initial: a, creep: c, rmsInitial: rms(a, ei, si), rmsCreep: rms(c, ec, sc), creepTotalStrain: ec,
      slopeAtOrigin: a[1]!, warnings,
    },
  };
}
