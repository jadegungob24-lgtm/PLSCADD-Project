import { z } from 'zod';

/**
 * Drafting (manual §13), materials (§8.5) and attachments (§6.6). Page
 * dimensions are millimetres; scales are metres of line per centimetre of
 * paper (§13.2.3 "actual distances corresponding to one cm on paper").
 * Defaults here are drawing-layout choices, not engineering values.
 */

/** An area of the sheet as percentages of the sheet height (top to bottom) and width (left to right) (§13.2.2). */
const Area = z.object({ xmin: z.number().min(0).max(100), xmax: z.number().min(0).max(100), ymin: z.number().min(0).max(100), ymax: z.number().min(0).max(100) });
export type SheetArea = z.infer<typeof Area>;

export const SheetSettingsSchema = z.object({
  page: z.object({ width: z.number().positive(), height: z.number().positive() }),
  /** Sheet rectangle inside the page: margins in mm. */
  margins: z.object({ left: z.number().min(0), right: z.number().min(0), top: z.number().min(0), bottom: z.number().min(0) }),
  areas: z.object({ plan: Area, profile: Area, stations: Area, title: Area }),
  /** Horizontal and vertical scales, metres per centimetre of paper. */
  hScale: z.number().positive(),
  vScale: z.number().positive(),
  stationLabelInterval: z.number().positive(),
  elevationLabelInterval: z.number().positive(),
  stationGrid: z.number().positive(),
  elevationGrid: z.number().positive(),
  planTickInterval: z.number().positive(),
  /** Allowable overlap for a common structure from one sheet to the next (m, §13.2.3). */
  commonOverlap: z.number().min(0),
  /** Margin below the lowest ground in the profile (m). */
  profileBottomMargin: z.number().min(0),
  /** What is drawn. */
  show: z.object({
    surveyPoints: z.boolean(), sideProfiles: z.boolean(), clearanceLine: z.boolean(), wires: z.boolean(),
    structureLabels: z.boolean(), sheetRectanglesInPlan: z.boolean(), attachments: z.boolean(),
  }),
  /** Title block lines; codes %p %q %n %d %t %L %s1 %s2 %s3 %s4 are substituted (§13.3.2). */
  title: z.array(z.string()),
});
export type SheetSettings = z.infer<typeof SheetSettingsSchema>;

export const defaultSheetSettings = (): SheetSettings => ({
  page: { width: 420, height: 297 },
  margins: { left: 20, right: 10, top: 10, bottom: 10 },
  areas: {
    plan: { xmin: 0, xmax: 100, ymin: 0, ymax: 28 },
    profile: { xmin: 0, xmax: 100, ymin: 30, ymax: 82 },
    stations: { xmin: 0, xmax: 100, ymin: 82, ymax: 88 },
    title: { xmin: 55, xmax: 100, ymin: 88, ymax: 100 },
  },
  hScale: 10, vScale: 5,
  stationLabelInterval: 100, elevationLabelInterval: 10, stationGrid: 50, elevationGrid: 5, planTickInterval: 50,
  commonOverlap: 100, profileBottomMargin: 5,
  show: { surveyPoints: true, sideProfiles: true, clearanceLine: true, wires: true, structureLabels: true, sheetRectanglesInPlan: false, attachments: true },
  title: ['%n', '%L — Plan and Profile', 'Structures %s3 to %s4   Stations %s1 to %s2', 'Sheet %p of %q   %d'],
});

/** Lines and annotation (§13.3): coordinates per target — sheet: fractions of the page from left/top; plan: global X, Y; profile: station, elevation. */
export const AnnotationSchema = z.object({
  id: z.string(),
  target: z.enum(['allSheets', 'sheet', 'plan', 'profile']),
  /** Sheet number for target "sheet". */
  sheet: z.number().int().positive().nullable(),
  kind: z.enum(['text', 'line', 'arrow', 'polygon']),
  pts: z.array(z.tuple([z.number(), z.number()])).min(1),
  text: z.string(),
  /** Text height on paper, mm. */
  height: z.number().positive(),
  /** Text angle, degrees counter-clockwise. */
  angle: z.number(),
  color: z.string(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

export const DraftingSchema = z.object({
  sheets: SheetSettingsSchema,
  annotations: z.array(AnnotationSchema),
});
export type Drafting = z.infer<typeof DraftingSchema>;

// ------------------------------------------------------------------ Materials (§8.5)

export const PartSchema = z.object({
  stock: z.string().min(1),
  description: z.string(),
  unit: z.string(),
  materialCost: z.number().min(0),
  laborCost: z.number().min(0),
});
export type Part = z.infer<typeof PartSchema>;

export const MaterialItemSchema = z.object({ stock: z.string().min(1), qty: z.number() });
export type MaterialItem = z.infer<typeof MaterialItemSchema>;

export const AssemblySchema = z.object({
  stock: z.string().min(1),
  description: z.string(),
  unit: z.string(),
  items: z.array(MaterialItemSchema),
});
export type Assembly = z.infer<typeof AssemblySchema>;

export const MaterialsSchema = z.object({
  parts: z.array(PartSchema),
  assemblies: z.array(AssemblySchema),
  /** Line-specific material (§8.5.4.2). */
  line: z.array(MaterialItemSchema),
});
export type Materials = z.infer<typeof MaterialsSchema>;

// ------------------------------------------------------------------ Attachments (§6.6)

const Vertex = z.tuple([z.number(), z.number(), z.number()]);
export const CadEntitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polyline'), pts: z.array(Vertex), closed: z.boolean(), layer: z.string() }),
  z.object({ kind: z.literal('text'), x: z.number(), y: z.number(), z: z.number(), text: z.string(), height: z.number(), angle: z.number(), layer: z.string() }),
  z.object({ kind: z.literal('point'), x: z.number(), y: z.number(), z: z.number(), layer: z.string() }),
]);

export const AttachmentFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['dxf', 'shp', 'image']),
  /** View the attachment is overlaid on (§6.6.1): plan (X, Y), profile (station, elevation) or sheets (page mm, y up). */
  view: z.enum(['plan', 'profile', 'sheets']),
  visible: z.boolean(),
  color: z.string(),
  /** Metres per drawing unit (e.g. 0.3048 for a DXF in feet). */
  unitScale: z.number().positive(),
  /** Translation applied after scaling (Drafting/ Attachments/ Move). */
  dx: z.number(),
  dy: z.number(),
  hiddenLayers: z.array(z.string()),
  entities: z.array(CadEntitySchema),
  /** Raster images: data URL, upper-left corner, size in metres and rotation (degrees, counter-clockwise) (§6.6.2). */
  image: z.object({ href: z.string(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive(), rotation: z.number() }).nullable(),
});
export type AttachmentFile = z.infer<typeof AttachmentFileSchema>;
