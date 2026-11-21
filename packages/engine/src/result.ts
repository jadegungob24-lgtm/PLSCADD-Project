/**
 * Calculation result envelope.
 *
 * Every engine calculation returns either a computed value with a trace
 * (inputs, equation references, intermediate values, method, assumptions),
 * or a typed "not implemented" outcome. Engine functions never return a
 * placeholder number for an unimplemented method.
 */

export interface CalcStep {
  /** Human-readable description of the step. */
  label: string;
  /** Equation reference, e.g. "PLS-CADD manual Eq. J-3". */
  ref?: string;
  /** Intermediate value(s) in SI units. */
  values?: Record<string, number | string>;
}

export interface CalcTrace {
  method: string;
  /** Source of the method: a manual reference, or a declared standard method when the manual is silent. */
  basis: string;
  inputs: Record<string, number | string>;
  steps: CalcStep[];
  assumptions: string[];
  warnings: string[];
}

export type CalcResult<T> =
  | { ok: true; value: T; trace: CalcTrace }
  | { ok: false; reason: 'not-implemented' | 'invalid-input' | 'no-convergence'; message: string; trace?: CalcTrace };

export function notImplemented<T>(what: string): CalcResult<T> {
  return { ok: false, reason: 'not-implemented', message: `${what} is not implemented yet.` };
}

export function invalidInput<T>(message: string): CalcResult<T> {
  return { ok: false, reason: 'invalid-input', message };
}
