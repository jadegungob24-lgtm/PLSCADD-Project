import { AttachmentFileSchema, DraftingSchema, MaterialsSchema, defaultSheetSettings } from './drafting';
import { z } from 'zod';
import { QuantitySchema, SourceSchema } from './provenance';
import { CableSchema, PlacedStructureSchema, SectionSchema, StructureTypeSchema } from './library';
import { CriteriaSchema } from './criteria';

/**
 * Project data model, schema version 1.
 *
 * All lengths/coordinates are metres, forces newtons, temperatures °C (SI),
 * regardless of the display unit system. Collections that later phases fill in
 * (cables, structures, sections, …) are declared now so that saved projects
 * keep a stable shape; their item schemas are extended phase by phase and the
 * schema version is bumped with a migration when a breaking change is needed.
 */

export const SCHEMA_VERSION = 1;

export const UnitSystemSchema = z.enum(['US', 'SI_N', 'SI_daN']);

export const CrsSchema = z.object({
  /** Display name, e.g. "WGS 84 / UTM zone 18S". */
  name: z.string(),
  /** EPSG code if known. */
  epsg: z.number().int().optional(),
  /** PROJ string or WKT definition (manual §6.2.1 allows a PRJ/WKT or PROJ string). */
  definition: z.string(),
});
export type Crs = z.infer<typeof CrsSchema>;

export const ProjectMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  client: z.string().default(''),
  lineName: z.string().default(''),
  /** Nominal line voltage (kV) — informational; clearances use per-section voltages. */
  nominalVoltageKV: QuantitySchema.nullable().default(null),
  engineer: z.string().default(''),
  createdAt: z.string(),
  modifiedAt: z.string(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

/** Side profile definition (manual §6.10.1). */
export const SideProfileSchema = z.object({
  /** Offset from the centerline, positive to the right. */
  offset: z.number(),
  tolerance: z.number().positive(),
  maxSeparation: z.number().positive(),
});
export type SideProfileDef = z.infer<typeof SideProfileSchema>;

/** Manual defaults: MOPV 50 ft, MOCGP 10 ft (§6.3.2), stored in metres. */
export const DEFAULT_MOPV = 50 * 0.3048;
export const DEFAULT_MOCGP = 10 * 0.3048;

/**
 * Gap between alignments in the virtual profile. The manual gives no default;
 * 300 ft is the value implied by its example (Fig. 6.3-8: 1707.11 + gap + 500 = 2507.11).
 */
export const DEFAULT_ALIGNMENT_GAP = 300 * 0.3048;

export const StationEquationSchema = z.object({
  trueStation: z.number(),
  equationStation: z.number(),
  direction: z.enum(['ahead', 'back']),
});

export const TerrainSettingsSchema = z.object({
  /** Maximum Offset for Profile View (§6.3.2). */
  mopv: z.number().positive(),
  /** Maximum Offset for Centerline Ground Profile (§6.3.2). */
  mocgp: z.number().positive(),
  sideProfiles: z.array(SideProfileSchema),
  /** Use a TIN of the ground points for display and for the TIN-cut ground profile (§6.4). */
  tinEnabled: z.boolean(),
  /** Triangles with a side longer than this are removed; null = no limit (§6.4.2). */
  tinMaxEdge: z.number().positive().nullable(),
  /** Contour line interval of the TIN display; null = no contours (§6.4.3). */
  contourInterval: z.number().positive().nullable().default(null),
  /** Station gap inserted between alignments in the virtual profile (§6.3.1.2). */
  alignmentGap: z.number().positive().default(DEFAULT_ALIGNMENT_GAP),
  /** Station equations (§6.11). */
  stationEquations: z.array(StationEquationSchema).default([]),
});
export type TerrainSettings = z.infer<typeof TerrainSettingsSchema>;

export const defaultTerrainSettings = (): TerrainSettings => ({
  mopv: DEFAULT_MOPV, mocgp: DEFAULT_MOCGP, sideProfiles: [], tinEnabled: false, tinMaxEdge: null,
  contourInterval: null, alignmentGap: DEFAULT_ALIGNMENT_GAP, stationEquations: [],
});

/** Break line segment (manual §6.5, App. D.6). */
export const BreakLineSchema = z.object({
  id: z.string(),
  ax: z.number(), ay: z.number(), az: z.number(),
  bx: z.number(), by: z.number(), bz: z.number(),
  src: SourceSchema,
});
export type BreakLine = z.infer<typeof BreakLineSchema>;

export const ProjectSettingsSchema = z.object({
  unitSystem: UnitSystemSchema,
  crs: CrsSchema.nullable(),
  /** Stations shown as true or equation stations (manual §6.11). */
  stationDisplay: z.enum(['true', 'equation']),
  /** Sag sections by horizontal tension or by catenary constant (manual §10.3.2.1). */
  sagBy: z.enum(['tension', 'catenary']),
  /** Profile view vertical exaggeration (aspect ratio). */
  profileAspectRatio: z.number().positive(),
  /** Added in Phase 2; projects saved earlier receive the defaults. */
  terrain: TerrainSettingsSchema.default(defaultTerrainSettings),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** Required clearances of a feature code for one voltage (manual §6.1). */
export const ClearanceSchema = z.object({
  /** Required vertical clearance; null = not specified. */
  rv: z.number().nonnegative().nullable(),
  /** Required horizontal clearance; null or 0 = not defined (§6.1.1). */
  rh: z.number().nonnegative().nullable(),
});

/** Feature code (manual §6.1). */
export const FeatureCodeSchema = z.object({
  code: z.number().int(),
  description: z.string(),
  /** "Point is on Ground": used for ground profiles and the TIN. */
  onGround: z.boolean(),
  /** "Aerial Obstacle": wires may pass above or below. */
  aerial: z.boolean(),
  /** Display colour (CSS). */
  color: z.string(),
  /** Required clearances keyed by voltage in kV (text key of the number). */
  clearances: z.record(z.string(), ClearanceSchema),
  src: SourceSchema,
});
export type FeatureCode = z.infer<typeof FeatureCodeSchema>;

export const PiSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  desc: z.string(),
  src: SourceSchema,
});
export type Pi = z.infer<typeof PiSchema>;

/** Alignment: a chain of PIs (manual §6.3). */
export const AlignmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** True station of the first PI (§6.11). */
  startStation: z.number(),
  pis: z.array(PiSchema),
});
export type Alignment = z.infer<typeof AlignmentSchema>;

/** Terrain point (manual App. D.1 record). */
export const TerrainPointSchema = z.object({
  id: z.string(),
  desc: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  code: z.number().int(),
  /** Obstacle height above ground point (0 if none). */
  h: z.number(),
  profNote: z.string(),
  planNote: z.string(),
  active: z.boolean(),
  src: SourceSchema,
});
export type TerrainPoint = z.infer<typeof TerrainPointSchema>;

/** Placeholder item schema for collections populated in later phases. */
const Pending = z.record(z.string(), z.unknown());

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  meta: ProjectMetaSchema,
  settings: ProjectSettingsSchema,
  terrain: z.object({
    points: z.array(TerrainPointSchema),
    featureCodes: z.array(FeatureCodeSchema),
    /** Voltages (kV) for which required clearances are tabulated; at most 20 (§6.1). */
    voltages: z.array(z.number().positive()).max(20).default([]),
    breakLines: z.array(BreakLineSchema),
  }),
  alignments: z.array(AlignmentSchema),
  criteria: CriteriaSchema,
  cableLibrary: z.array(CableSchema),
  structureLibrary: z.array(StructureTypeSchema),
  structures: z.array(PlacedStructureSchema),
  sections: z.array(SectionSchema),
  constraints: z.array(Pending),
  drawings: z.array(Pending),
  /** Phase 6: plan & profile sheets and annotation (§13), materials (§8.5), attachments (§6.6). */
  drafting: DraftingSchema.default(() => ({ sheets: defaultSheetSettings(), annotations: [] })),
  materials: MaterialsSchema.default(() => ({ parts: [], assemblies: [], line: [] })),
  attachments: z.array(AttachmentFileSchema).default([]),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface NewProjectOptions {
  name: string;
  description?: string;
  client?: string;
  lineName?: string;
  engineer?: string;
  unitSystem?: z.infer<typeof UnitSystemSchema>;
  nominalVoltageKV?: number | null;
}

export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function createProject(opts: NewProjectOptions, now = new Date()): Project {
  const ts = now.toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId(),
    meta: {
      name: opts.name,
      description: opts.description ?? '',
      client: opts.client ?? '',
      lineName: opts.lineName ?? '',
      nominalVoltageKV:
        opts.nominalVoltageKV === undefined || opts.nominalVoltageKV === null
          ? null
          : { v: opts.nominalVoltageKV, src: 'user' },
      engineer: opts.engineer ?? '',
      createdAt: ts,
      modifiedAt: ts,
    },
    settings: {
      unitSystem: opts.unitSystem ?? 'SI_N',
      crs: null,
      stationDisplay: 'true',
      sagBy: 'tension',
      profileAspectRatio: 10,
      terrain: defaultTerrainSettings(),
    },
    terrain: { points: [], featureCodes: [], voltages: [], breakLines: [] },
    alignments: [],
    criteria: CriteriaSchema.parse({ notes: '', weatherCases: [] }),
    drafting: { sheets: defaultSheetSettings(), annotations: [] },
    materials: { parts: [], assemblies: [], line: [] },
    attachments: [],
    cableLibrary: [],
    structureLibrary: [],
    structures: [],
    sections: [],
    constraints: [],
    drawings: [],
  };
}

export type ValidationOutcome =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] };

/** Validate untrusted data (opened file, archive) against the project schema. */
export function validateProject(data: unknown): ValidationOutcome {
  const r = ProjectSchema.safeParse(data);
  if (r.success) return { ok: true, project: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Counts shown in the project explorer and revision summaries. */
export function projectStats(p: Project) {
  return {
    terrainPoints: p.terrain.points.length,
    featureCodes: p.terrain.featureCodes.length,
    alignments: p.alignments.length,
    weatherCases: p.criteria.weatherCases.length,
    cables: p.cableLibrary.length,
    structureTypes: p.structureLibrary.length,
    structures: p.structures.length,
    sections: p.sections.length,
    drawings: p.drawings.length,
  };
}
