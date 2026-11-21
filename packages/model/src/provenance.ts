import { z } from 'zod';

/**
 * Origin of an engineering value. The UI shows it next to every value so that
 * user-defined, imported and calculated numbers are always distinguishable.
 */
export const SourceSchema = z.enum(['user', 'imported', 'calculated', 'default']);
export type Source = z.infer<typeof SourceSchema>;

/** A numeric value in SI units with its provenance. */
export const QuantitySchema = z.object({
  v: z.number(),
  src: SourceSchema,
  /** Optional reference: import file name, calculation id, or criteria row. */
  ref: z.string().optional(),
});
export type Quantity = z.infer<typeof QuantitySchema>;

export const q = (v: number, src: Source = 'user', ref?: string): Quantity =>
  ref === undefined ? { v, src } : { v, src, ref };

export const SOURCE_LABEL: Record<Source, string> = {
  user: 'User-defined',
  imported: 'Imported',
  calculated: 'Calculated',
  default: 'Default',
};

export const SOURCE_TAG: Record<Source, string> = {
  user: 'U',
  imported: 'I',
  calculated: 'C',
  default: 'D',
};
