/**
 * Stringing rules for a tension section (PLS-CADD manual §8.2.3, §10.3.1).
 *
 * A section starts at a dead-end attachment set, may pass intermediate
 * structures attached to non-dead-end sets or bypass them, and ends at the
 * next dead-end set. Stringing always proceeds toward higher structure numbers
 * (the order of the virtual profile, §6.3.1.2). All sets of a section carry
 * the same number of phases (1 to 3); a transposition such as "321" connects
 * wire phase 1 to attachment phase 3, and so on.
 */

export interface StringingStep {
  /** Structure number in the virtual profile (1-based). */
  structureNumber: number;
  /** Attached set at this structure, or null when the section bypasses the structure. */
  set: { number: number; deadEnd: boolean; phaseCount: number } | null;
  transposition: string;
}

export function isPermutation(t: string, n: number): boolean {
  if (t.length !== n) return false;
  const digits = t.split('').map(Number);
  return digits.every((d) => Number.isInteger(d) && d >= 1 && d <= n) && new Set(digits).size === n;
}

/** All transpositions of n phases, identity first. */
export function transpositions(n: number): string[] {
  const out: string[] = [];
  const rec = (pre: string, rest: string[]) => {
    if (rest.length === 0) { out.push(pre); return; }
    rest.forEach((d, i) => rec(pre + d, [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  rec('', Array.from({ length: n }, (_, i) => String(i + 1)));
  return out;
}

/** Returns the list of rule violations; empty when the section is valid. */
export function checkStringing(steps: readonly StringingStep[]): string[] {
  const errors: string[] = [];
  const attached = steps.filter((s) => s.set !== null);
  if (attached.length < 2) return ['A section needs at least two attached structures.'];
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]!.structureNumber <= steps[i - 1]!.structureNumber) {
      errors.push('Structures must be strung in increasing order along the profile.');
      break;
    }
  }
  if (steps[0]!.set === null || steps[steps.length - 1]!.set === null) {
    errors.push('A section must start and end at an attached structure.');
  }
  const first = attached[0]!, last = attached[attached.length - 1]!;
  if (!first.set!.deadEnd) errors.push(`Structure ${first.structureNumber}: a section must start at a dead-end set.`);
  if (!last.set!.deadEnd) errors.push(`Structure ${last.structureNumber}: a section must end at a dead-end set.`);
  for (const s of attached.slice(1, -1)) {
    if (s.set!.deadEnd) errors.push(`Structure ${s.structureNumber}: set ${s.set!.number} is a dead end, so the section must end there.`);
  }
  const n = first.set!.phaseCount;
  for (const s of attached) {
    if (s.set!.phaseCount !== n) {
      errors.push(`Structure ${s.structureNumber}: set ${s.set!.number} has ${s.set!.phaseCount} phase(s), the section has ${n}.`);
    }
    if (!isPermutation(s.transposition, s.set!.phaseCount)) {
      errors.push(`Structure ${s.structureNumber}: "${s.transposition}" is not a valid phase order.`);
    }
  }
  return errors;
}
