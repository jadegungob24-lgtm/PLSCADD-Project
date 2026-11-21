/**
 * Unit handling.
 *
 * All engineering values are stored and computed in SI base units
 * (m, N, N/m, Pa, °C, kg/m³ …), as PLS-CADD does internally (manual §6.2.1).
 * Conversion happens only at the UI and file I/O boundaries.
 *
 * Display systems mirror the PLS-CADD preference choices:
 *   - 'US'     : ft, lbs, lbs/ft, psf, °F
 *   - 'SI_N'   : m, N, N/m, Pa, °C
 *   - 'SI_daN' : m, daN, daN/m, Pa, °C
 */

export type UnitSystem = 'US' | 'SI_N' | 'SI_daN';

/** Physical dimensions handled by the application. */
export type Dimension =
  | 'length'        // coordinates, spans, sags, heights
  | 'smallLength'   // conductor diameter, ice thickness
  | 'area'          // cross-section area
  | 'force'         // tensions, loads
  | 'forcePerLength'// unit weight, unit wind load
  | 'pressure'      // wind pressure
  | 'stress'        // cable stress, modulus
  | 'temperature'
  | 'velocity'      // wind velocity
  | 'density'       // ice density (weight per unit volume)
  | 'angle'         // degrees everywhere
  | 'expansion'     // thermal expansion coefficient (strain per degree)
  | 'ratio';        // dimensionless

/** International foot (PLS-CADD uses the international foot for unit switching, §6.2.1). */
export const FT = 0.3048;
export const INCH = 0.0254;
/** Pound-force in newtons. */
export const LBF = 4.4482216152605;
export const MPH = 0.44704;

interface LinearUnit {
  label: string;
  /** SI value = display value * factor + offset */
  factor: number;
  offset?: number;
}

const TABLE: Record<UnitSystem, Record<Dimension, LinearUnit>> = {
  US: {
    length: { label: 'ft', factor: FT },
    smallLength: { label: 'in', factor: INCH },
    area: { label: 'in²', factor: INCH * INCH },
    force: { label: 'lbs', factor: LBF },
    forcePerLength: { label: 'lbs/ft', factor: LBF / FT },
    pressure: { label: 'psf', factor: LBF / (FT * FT) },
    stress: { label: 'psi', factor: LBF / (INCH * INCH) },
    temperature: { label: '°F', factor: 5 / 9, offset: -32 * (5 / 9) },
    velocity: { label: 'mph', factor: MPH },
    density: { label: 'lbs/ft³', factor: LBF / (FT * FT * FT) },
    angle: { label: '°', factor: 1 },
    expansion: { label: '×10⁻⁶/°F', factor: 1.8e-6 },
    ratio: { label: '', factor: 1 },
  },
  SI_N: {
    length: { label: 'm', factor: 1 },
    smallLength: { label: 'mm', factor: 1e-3 },
    area: { label: 'mm²', factor: 1e-6 },
    force: { label: 'N', factor: 1 },
    forcePerLength: { label: 'N/m', factor: 1 },
    pressure: { label: 'Pa', factor: 1 },
    stress: { label: 'MPa', factor: 1e6 },
    temperature: { label: '°C', factor: 1 },
    velocity: { label: 'm/s', factor: 1 },
    density: { label: 'N/m³', factor: 1 },
    angle: { label: '°', factor: 1 },
    expansion: { label: '×10⁻⁶/°C', factor: 1e-6 },
    ratio: { label: '', factor: 1 },
  },
  SI_daN: {
    length: { label: 'm', factor: 1 },
    smallLength: { label: 'mm', factor: 1e-3 },
    area: { label: 'mm²', factor: 1e-6 },
    force: { label: 'daN', factor: 10 },
    forcePerLength: { label: 'daN/m', factor: 10 },
    pressure: { label: 'Pa', factor: 1 },
    stress: { label: 'daN/mm²', factor: 1e7 },
    temperature: { label: '°C', factor: 1 },
    velocity: { label: 'km/h', factor: 1 / 3.6 },
    density: { label: 'daN/dm³', factor: 1e4 },
    angle: { label: '°', factor: 1 },
    expansion: { label: '×10⁻⁶/°C', factor: 1e-6 },
    ratio: { label: '', factor: 1 },
  },
};

/** SI base unit label for each dimension (internal storage). */
export const SI_LABEL: Record<Dimension, string> = {
  length: 'm',
  smallLength: 'm',
  area: 'm²',
  force: 'N',
  forcePerLength: 'N/m',
  pressure: 'Pa',
  stress: 'Pa',
  temperature: '°C',
  velocity: 'm/s',
  density: 'N/m³',
  angle: '°',
  expansion: '1/°C',
  ratio: '',
};

export function unitLabel(system: UnitSystem, dim: Dimension): string {
  return TABLE[system][dim].label;
}

/** Convert a value expressed in the display unit of `system` to SI. */
export function toSI(value: number, system: UnitSystem, dim: Dimension): number {
  const u = TABLE[system][dim];
  return value * u.factor + (u.offset ?? 0);
}

/** Convert an SI value to the display unit of `system`. */
export function fromSI(value: number, system: UnitSystem, dim: Dimension): number {
  const u = TABLE[system][dim];
  return (value - (u.offset ?? 0)) / u.factor;
}

export const UNIT_SYSTEM_LABEL: Record<UnitSystem, string> = {
  US: 'Imperial (US)',
  SI_N: 'S.I. (N force)',
  SI_daN: 'S.I. (daN force)',
};

/** Default number of decimals shown per dimension. */
export const DEFAULT_DECIMALS: Record<Dimension, number> = {
  length: 2,
  smallLength: 2,
  area: 1,
  force: 0,
  forcePerLength: 3,
  pressure: 1,
  stress: 1,
  temperature: 1,
  velocity: 1,
  density: 2,
  angle: 4,
  expansion: 2,
  ratio: 3,
};

export function formatQuantity(
  valueSI: number,
  system: UnitSystem,
  dim: Dimension,
  decimals = DEFAULT_DECIMALS[dim],
  withUnit = true,
): string {
  if (!Number.isFinite(valueSI)) return '—';
  const v = fromSI(valueSI, system, dim).toFixed(decimals);
  const label = unitLabel(system, dim);
  return withUnit && label ? `${v} ${label}` : v;
}

/** Format a station as 1+234.56 style (in display length units). */
export function formatStation(stationSI: number, system: UnitSystem, decimals = 2): string {
  if (!Number.isFinite(stationSI)) return '—';
  // Round to the displayed precision first: otherwise 4499.99999… would print as 44+100.00.
  const scale = Math.pow(10, decimals);
  const v = Math.round(fromSI(stationSI, system, 'length') * scale) / scale;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  // US practice: 100 ft stations; metric practice: 1000 m kilometre stations.
  const base = system === 'US' ? 100 : 1000;
  const major = Math.floor(a / base);
  const minor = a - major * base;
  const width = system === 'US' ? 2 : 3;
  const minorStr = minor.toFixed(decimals).padStart(width + (decimals > 0 ? decimals + 1 : 0), '0');
  return `${sign}${major}+${minorStr}`;
}
