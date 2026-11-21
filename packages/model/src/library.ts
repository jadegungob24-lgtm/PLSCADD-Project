import { MaterialItemSchema } from './drafting';
import { z } from 'zod';
import { SourceSchema } from './provenance';
import { SaggingSchema } from './criteria';

/**
 * Conductor, structure and line-model data (PLS-CADD manual §8, §9.2, §10.2,
 * §10.3, App. F, App. G). All values SI: m, m², N, N/m, Pa, °C; strain in
 * percent for the cable polynomials (σ in Pa, ε in %, as the manual's model).
 */

// ------------------------------------------------------------------ Cables

/** Five polynomial coefficients k0..k4 of σ(ε), σ in Pa, ε in percent (Eq. 9-1). */
export const PolySchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]);
export const ZERO_POLY: [number, number, number, number, number] = [0, 0, 0, 0, 0];

/** One material of a cable: "outer" strands, or "core" strands of a bimetallic cable (§9.2). */
export const CableMaterialSchema = z.object({
  /** Final modulus of elasticity, already multiplied by the area ratio (Eqs. 9-5, 9-6); Pa per % strain. */
  finalModulus: z.number().nonnegative(),
  /** Thermal expansion coefficient (strain per °C, Eq. 9-12). */
  thermalCoeff: z.number(),
  /** Stress-strain polynomial a0..a4 (outer, Eq. 9-3) or b0..b4 (core, Eq. 9-4). */
  initial: PolySchema,
  /** Creep polynomial c0..c4 (outer, Eq. 9-8) or d0..d4 (core, Eq. 9-9). */
  creep: PolySchema,
});
export type CableMaterial = z.infer<typeof CableMaterialSchema>;

export const CableSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  stockNumber: z.string(),
  /**
   * 'nonlinear': polynomial model with creep (§9.1, the preferred model);
   * 'linear': simplified linear model, creep given as a temperature increase (App. G.2).
   * The improved linear model (App. G.3) is defined in a technote not in the reference set.
   */
  model: z.enum(['nonlinear', 'linear']),
  /** Total cross-section area AT. */
  area: z.number().positive(),
  /** Outside diameter D used for wind and ice. */
  diameter: z.number().positive(),
  /** Unit weight UW of the bare cable. */
  unitWeight: z.number().positive(),
  /** Rated ultimate tension ULT. */
  ultimateTension: z.number().positive(),
  /** Number of independent cables supported by a messenger (§9.2.1). */
  independentCables: z.number().int().min(1),
  gapType: z.boolean(),
  /** Temperature at which the test data (polynomials) were obtained. */
  testTemperature: z.number(),
  outer: CableMaterialSchema,
  /** Core strands; null for a homogeneous cable. */
  core: CableMaterialSchema.nullable(),
  /** Linear model only: creep expressed as an equivalent temperature increase (°C). */
  creepTemperatureShift: z.number().nonnegative(),
  /** Behaviour of the outer strands in compression at high temperature (§7.3.5, §9.3.2). */
  outerCompression: z.object({
    mode: z.enum(['criteria', 'none', 'limited']),
    /** Maximum compression (virtual) stress for 'limited', Pa. */
    limit: z.number().nonnegative(),
  }),
  color: z.string(),
  /** Test points the polynomials were fitted to, kept for traceability (App. G.1). */
  testData: z.object({
    initial: z.array(z.tuple([z.number(), z.number()])),
    creep: z.array(z.tuple([z.number(), z.number()])),
  }).nullable(),
  src: SourceSchema,
});
export type Cable = z.infer<typeof CableSchema>;

// ------------------------------------------------------------------ Structure types

export const InsulatorTypeSchema = z.enum(['clamp', 'strain', 'suspension', 'post', '2part']);
export type InsulatorType = z.infer<typeof InsulatorTypeSchema>;
export const INSULATOR_LABEL: Record<InsulatorType, string> = {
  clamp: 'Clamp', strain: 'Strain', suspension: 'Suspension', post: 'Post', '2part': '2-Part',
};

/** Local structure coordinates: x transverse, y down from TOP, z longitudinal (§8.2.1). */
const LocalPoint = { x: z.number(), y: z.number(), z: z.number() };

/** One attachment row of the structure data editor (App. F.1.1–F.1.3). */
export const AttachmentSchema = z.object({
  set: z.number().int().min(1),
  phase: z.number().int().min(1).max(3),
  deadEnd: z.boolean(),
  setDescription: z.string(),
  insulator: InsulatorTypeSchema,
  /** Insulator weight (side 1 for 2-part). */
  weight: z.number().nonnegative(),
  /** Insulator wind area (side 1 for 2-part). */
  windArea: z.number().nonnegative(),
  /** Insulator length (side 1 for 2-part); not used for clamps and posts. */
  length: z.number().nonnegative(),
  /** Attachment point: structure attachment for strain/suspension/2-part side 1, clamp location, or post tip. */
  ...LocalPoint,
  /** Minimum required vertical load (positive down): no uplift, no limit, or a value. */
  minVertical: z.object({ kind: z.enum(['noUplift', 'noLimit', 'value']), value: z.number() }),
  /** Allowable swing (suspension) or load angle (2-part) [min, max] in degrees for the four swing conditions. */
  swing: z.array(z.tuple([z.number(), z.number()])).length(4).nullable(),
  /** Side 2 of a 2-part insulator. */
  part2: z.object({
    weight: z.number().nonnegative(),
    windArea: z.number().nonnegative(),
    length: z.number().positive(),
    ...LocalPoint,
    /** Take the lower (or, for vertical AB, the right) of the two solutions for point C. */
    bottomOrRight: z.boolean(),
    tensionOnly1: z.boolean(),
    tensionOnly2: z.boolean(),
  }).nullable(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/** One line-angle row of a Method 1 allowable spans table (App. F.1.4.1). */
export const AllowableSpanRowSchema = z.object({
  lineAngle: z.number().min(0).max(180),
  maxWindSpan: z.number().nonnegative(),
  /** Maximum weight spans for weight-span conditions 1, 2 and 3 (§7.3.10). */
  maxWeightSpan: z.tuple([z.number(), z.number(), z.number()]),
  /** Minimum weight span for all conditions; negative if uplift is permitted. */
  minWeightSpan: z.number(),
});
export type AllowableSpanRow = z.infer<typeof AllowableSpanRowSchema>;

export const StructureTypeSchema = z.object({
  id: z.string(),
  /** Structure file name, e.g. "DA+3". */
  name: z.string().min(1),
  description: z.string(),
  /** Height HT from ground to TOP. */
  height: z.number().positive(),
  /** Embedment length (reporting only, App. F.1). */
  embedment: z.number().nonnegative().nullable(),
  attachments: z.array(AttachmentSchema),
  strength: z.object({
    method: z.enum(['none', 'method1', 'method2']),
    /** "Description of limits of validity" of the allowable spans (App. F.1.4.1). */
    validity: z.string(),
    rows: z.array(AllowableSpanRowSchema),
    /**
     * Method 2 (App. F.1.4.2): angle ranges in ascending order, each with one allowable
     * interaction diagram per row of the criteria's interaction conditions, as
     * (wind span, weight span) points of a closed polygon.
     */
    ranges: z.array(z.object({ maxAngle: z.number().min(0).max(180), diagrams: z.array(z.array(z.tuple([z.number(), z.number()]))) })).default([]),
  }),
  /** Auto-spot minimum line angle (§14.1.5). */
  autoSpotMinAngle: z.number().min(0),
  /** Cost for optimization (§14.1.5); null if not given. */
  cost: z.number().nonnegative().nullable(),
  /** Structure file material list: parts and assemblies by stock number (§8.5, App. F). */
  material: z.array(MaterialItemSchema).default([]),
  src: SourceSchema,
});
export type StructureType = z.infer<typeof StructureTypeSchema>;

// ------------------------------------------------------------------ Line model

/** A structure spotted on an alignment (Structure Modify box, §10.2.2). */
export const PlacedStructureSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  alignmentId: z.string(),
  /**
   * Distance along the alignment from its first P.I. The displayed station adds
   * the alignment's start station in the virtual profile, so structures keep
   * their place on their own alignment when another alignment changes length.
   */
  station: z.number(),
  /** Offset adjustment from the centerline, positive to the right. */
  offset: z.number(),
  /** Height adjustment of the base above (or below) the ground. */
  heightAdjust: z.number(),
  /** Orientation SO, degrees, positive clockwise (§7.3.12.1). */
  orientation: z.number(),
  /** User structure number or name shown with the structure; blank = automatic number. */
  label: z.string(),
  /** Counterweight per set number, N (§10.2.2 item 7). */
  counterweights: z.record(z.string(), z.number().nonnegative()),
  comment: z.string(),
  /** Structure-specific material at this site (§8.5.4.1). */
  material: z.array(MaterialItemSchema).default([]),
  src: SourceSchema,
});
export type PlacedStructure = z.infer<typeof PlacedStructureSchema>;

/** One structure along a tension section: the set it is attached to, or null when bypassed. */
export const SectionStepSchema = z.object({
  structureId: z.string(),
  set: z.number().int().min(1).nullable(),
  /** Phase order, e.g. "321": wire phase 1 to attachment phase 3 (§10.3.1). */
  transposition: z.string(),
});
export type SectionStep = z.infer<typeof SectionStepSchema>;

/** A strung tension section (§8.2.3, §10.3). Sagging data arrive with the sag-tension engine. */
export const SectionSchema = z.object({
  id: z.string(),
  cableId: z.string(),
  /** Circuit voltage (kV), used for required clearances. */
  voltageKV: z.number().positive(),
  conductorsPerPhase: z.number().int().min(1),
  steps: z.array(SectionStepSchema).min(2),
  sagging: SaggingSchema.default({ condition: 'initial', temperature: 15, H: null, rulingSpanOverride: null, src: 'default' }),
  src: SourceSchema,
});
export type Section = z.infer<typeof SectionSchema>;

// ------------------------------------------------------------------ Factories

export function newMaterial(): CableMaterial {
  return { finalModulus: 0, thermalCoeff: 0, initial: [...ZERO_POLY], creep: [...ZERO_POLY] };
}

export function newAttachment(set: number, phase: number): Attachment {
  return {
    set, phase, deadEnd: false, setDescription: '', insulator: 'clamp', weight: 0, windArea: 0, length: 0,
    x: 0, y: 0, z: 0, minVertical: { kind: 'noLimit', value: 0 }, swing: null, part2: null,
  };
}

/** Problems that make a structure type unusable for stringing; empty when it is consistent. */
export function checkStructureType(t: StructureType): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  const bySet = new Map<number, Attachment[]>();
  for (const a of t.attachments) {
    const k = `${a.set}:${a.phase}`;
    if (seen.has(k)) errs.push(`Set ${a.set} phase ${a.phase} is defined twice.`);
    seen.add(k);
    if (!bySet.has(a.set)) bySet.set(a.set, []);
    bySet.get(a.set)!.push(a);
    // Fixed relations between insulator type and section end (App. F.1.1).
    if (a.insulator === 'strain' && !a.deadEnd) errs.push(`Set ${a.set} phase ${a.phase}: a strain insulator is always a dead end.`);
    if ((a.insulator === 'suspension' || a.insulator === '2part') && a.deadEnd) errs.push(`Set ${a.set} phase ${a.phase}: a ${a.insulator === '2part' ? '2-part' : 'suspension'} insulator is never a dead end.`);
    if ((a.insulator === 'strain' || a.insulator === 'suspension' || a.insulator === '2part') && !(a.length > 0)) {
      errs.push(`Set ${a.set} phase ${a.phase}: the insulator length must be greater than zero.`);
    }
    if (a.insulator === '2part' && !a.part2) errs.push(`Set ${a.set} phase ${a.phase}: side 2 of the 2-part insulator is missing.`);
    if (a.y < 0 || a.y > t.height) errs.push(`Set ${a.set} phase ${a.phase}: the attachment is outside the structure height (distance below top ${a.y}).`);
  }
  for (const [set, rows] of bySet) {
    if (rows.length > 3) errs.push(`Set ${set} has more than three phases.`);
    if (new Set(rows.map((r) => r.deadEnd)).size > 1) errs.push(`Set ${set}: all phases of a set must be either dead ends or not.`);
    const phases = rows.map((r) => r.phase).sort();
    if (phases.some((p, i) => p !== i + 1)) errs.push(`Set ${set}: phases must be numbered 1, 2, 3 without gaps.`);
  }
  if (t.strength.method === 'method1' && t.strength.rows.length === 0) errs.push('Method 1 strength is selected but the allowable spans table is empty.');
  if (t.strength.method === 'method2' && t.strength.ranges.length === 0) errs.push('Method 2 strength is selected but no angle range is defined.');
  return errs;
}

/** Sets of a structure type: number, dead end, phase count, description. */
export function structureSets(t: StructureType): { number: number; deadEnd: boolean; phaseCount: number; description: string }[] {
  const m = new Map<number, Attachment[]>();
  for (const a of t.attachments) {
    if (!m.has(a.set)) m.set(a.set, []);
    m.get(a.set)!.push(a);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([number, rows]) => ({
    number, deadEnd: rows[0]!.deadEnd, phaseCount: rows.length, description: rows.find((r) => r.setDescription)?.setDescription ?? '',
  }));
}
