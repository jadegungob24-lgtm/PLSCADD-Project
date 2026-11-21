import { z } from 'zod';
import { SourceSchema } from './provenance';

/**
 * Design criteria (PLS-CADD manual §7.3). Values in SI. No defaults are given
 * for any engineering value: every weather case and limit is entered by the
 * user from the applicable code or specification.
 */

export const CableConditionSchema = z.enum(['initial', 'creep', 'load']);
export type CableConditionValue = z.infer<typeof CableConditionSchema>;

/** Weather case (§7.3.2, Fig. 7.3-2). */
export const WeatherCaseSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Air density factor Q, Pa per (m/s)² (Eq. 7-1). */
  airDensity: z.number().positive(),
  /** Reference wind pressure, Pa; the velocity is derived with Q (Eq. 7-1). */
  windPressure: z.number().nonnegative(),
  iceThickness: z.number().nonnegative(),
  /** Ice density as weight per volume, N/m³. */
  iceDensity: z.number().nonnegative(),
  /** Ice load per unit length WICE, N/m. */
  iceLoad: z.number().nonnegative(),
  temperature: z.number(),
  weatherLoadFactor: z.number().positive(),
  /** NESC constant K, N/m (District case only). */
  nescK: z.number().nonnegative(),
  /** Wire gust response factor, including any drag coefficient other than 1 (§7.2.1.2). */
  gustFactor: z.number().positive(),
  src: SourceSchema,
});
export type WeatherCase = z.infer<typeof WeatherCaseSchema>;

/** Cable tension limit (§7.3.6) or automatic sagging limit (§7.3.7). */
export const TensionLimitSchema = z.object({
  id: z.string(),
  weatherId: z.string(),
  condition: CableConditionSchema,
  maxPercentUltimate: z.number().positive().nullable(),
  maxTension: z.number().positive().nullable(),
  /** Maximum catenary constant H / UW (m). */
  maxCatenary: z.number().positive().nullable(),
  /** Cables the limit applies to; empty = all cables. */
  cableIds: z.array(z.string()),
});
export type TensionLimit = z.infer<typeof TensionLimitSchema>;

/** A weather case and cable condition pair, as used by several criteria tables. */
export const ConditionRefSchema = z.object({ weatherId: z.string().nullable(), condition: CableConditionSchema });
export type ConditionRef = z.infer<typeof ConditionRefSchema>;
const ref = (): ConditionRef => ({ weatherId: null, condition: 'initial' });

/** One side (source or target) of a wire clearance check (§11.2.3.2.2). */
export const WireClearanceSideSchema = z.object({
  /** Voltage of the wires considered (kV); null = all wires. */
  voltageKV: z.number().nullable(),
  weatherId: z.string().nullable(),
  condition: CableConditionSchema,
  wind: z.enum(['left', 'right']),
  /** "Straight Line Wire": chords between attachment points instead of a weather case. */
  straight: z.boolean(),
  /** Ice jumping (source only): reflection of the iced shape about the un-iced shape. */
  iceJump: z.boolean(),
});
export type WireClearanceSide = z.infer<typeof WireClearanceSideSchema>;
const side = (): WireClearanceSide => ({ voltageKV: null, weatherId: null, condition: 'initial', wind: 'right', straight: false, iceJump: false });

/** Wind direction options of a load case (§7.3.12.2); MAX is not available. */
export const WIND_DIRECTIONS = ['NA+', 'NA-', 'BI+', 'BI-', 'NL+', 'NL-', 'NR+', 'NR-', 'GLB'] as const;

/** Structure load case (§7.3.12.8): weather, cable condition, wind direction and load factors. */
export const LoadCaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  weatherId: z.string().nullable(),
  condition: CableConditionSchema,
  windDirection: z.enum(WIND_DIRECTIONS),
  /** Bisector wind angle WB (BI±) or azimuth from north (GLB), degrees. */
  wb: z.number(),
  lfv: z.number().nonnegative(),
  lfw: z.number().nonnegative(),
  lft: z.number().nonnegative(),
  lfs: z.number().nonnegative(),
});
export type LoadCase = z.infer<typeof LoadCaseSchema>;

export const CriteriaSchema = z.object({
  notes: z.string(),
  weatherCases: z.array(WeatherCaseSchema),
  /** Weather case for final after creep and for final after load (§7.3.4, Fig. 7.3-3). */
  creepWeatherId: z.string().nullable().default(null),
  loadWeatherId: z.string().nullable().default(null),
  /** Bimetallic conductor model (§7.3.5): outer strands in compression. */
  outerCompression: z.object({ mode: z.enum(['none', 'limited', 'unlimited']), limit: z.number().nonnegative() })
    .default({ mode: 'none', limit: 0 }),
  tensionLimits: z.array(TensionLimitSchema).default([]),
  autosagLimits: z.array(TensionLimitSchema).default([]),
  /** Maximum tension reported: ruling-span support tension or the actual span ends (§7.3.8). */
  maxTension: z.enum(['rulingSpan', 'actual']).default('rulingSpan'),
  /** Weight span model (§7.3.9, App. I.3). */
  weightSpanModel: z.enum(['arcLength', 'exact']).default('exact'),
  /** The three weight-span conditions of Method 1 structures (§7.3.10). */
  weightSpanConditions: z.array(ConditionRefSchema).length(3).default(() => [ref(), ref(), ref()]),
  /** The four insulator swing conditions (§7.3.16). */
  swingConditions: z.array(ConditionRefSchema).length(4).default(() => [ref(), ref(), ref(), ref()]),
  /** How sections are displayed: a weather case (null = their sagging condition), cable condition and wind side. */
  display: z.object({
    weatherId: z.string().nullable(),
    condition: CableConditionSchema,
    wind: z.enum(['left', 'right']),
  }).default({ weatherId: null, condition: 'initial', wind: 'right' }),
  /** Survey point clearance conditions (§7.3.13) and check options (§11.2.3.1). */
  surveyClearance: z.object({
    conditions: z.array(ConditionRefSchema),
    /** Rectangular zone (RV/RH, Fig. 6.1-3) or radial (3-D distance against RV). */
    type: z.enum(['rectangular', 'radial']),
    /** Only points within this horizontal distance of a wire are checked; null = no limit. */
    maxHorizontal: z.number().positive().nullable(),
  }).default({ conditions: [], type: 'rectangular', maxHorizontal: null }),
  /** Clearances between cables (§7.3.14, §11.2.3.2.2). */
  wireClearance: z.object({
    source: WireClearanceSideSchema.default(side),
    target: WireClearanceSideSchema.default(side),
    measure: z.enum(['3d', 'horizontal']),
    /** Required separations between voltages (user values). */
    required: z.array(z.object({ sourceKV: z.number(), targetKV: z.number(), distance: z.number().nonnegative() })),
  }).default({ source: side(), target: side(), measure: '3d', required: [] }),
  /** Galloping ellipses (§7.3.15). */
  galloping: z.object({
    method: z.enum(['reaSingle', 'reaDouble', 'cigreSingle', 'cigreBundle']),
    /** Weather / cable condition for the span sag. */
    sag: ConditionRefSchema,
    /** Weather / cable condition for the span swing angle SSW. */
    swing: ConditionRefSchema,
    /** Galloping safety factor GSF multiplying MAJOR; 1 = none. */
    gsf: z.number().positive(),
    eswZero: z.boolean(),
  }).default({ method: 'reaSingle', sag: ref(), swing: ref(), gsf: 1, eswZero: false }),
  /** Structure load cases (§7.3.12.8), wire loads only. */
  loadCases: z.array(LoadCaseSchema).default([]),
  /** Interaction diagram conditions for Method 2 structures (§7.3.11), one row per diagram load case. */
  interactionConditions: z.array(ConditionRefSchema).default([]),
  /** Ground clearance line in the profile view (§6.10.2). */
  clearanceLine: z.object({ voltageKV: z.number().nullable(), groundCode: z.number().int().nullable() })
    .default({ voltageKV: null, groundCode: null }),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

/** Sagging data of a tension section (Section Modify, §10.3.2). */
export const SaggingSchema = z.object({
  condition: CableConditionSchema,
  temperature: z.number(),
  /** Horizontal tension at the sagging condition; null = not sagged yet. */
  H: z.number().positive().nullable(),
  /** User ruling span (§10.3.2 "Override calculated ruling span"); null = calculated. */
  rulingSpanOverride: z.number().positive().nullable(),
  /** How H was obtained. */
  src: SourceSchema,
});
export type Sagging = z.infer<typeof SaggingSchema>;

/** Imperial Q (psf per mph²) ↔ SI Q (Pa per (m/s)²): Q_SI = Q_US × (psf in Pa) / (mph in m/s)². */
export const Q_US_TO_SI = 47.88025898033584 / (0.44704 * 0.44704);
