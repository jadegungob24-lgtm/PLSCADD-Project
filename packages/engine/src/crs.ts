import proj4 from 'proj4';

/**
 * Coordinate reference systems (manual §6.2.1).
 *
 * A CRS is described by a PROJ string or a WKT definition, as the manual
 * allows ("referencing a PRJ file containing a WKT or PROJ string"). No EPSG
 * database is bundled: UTM zones on WGS 84 can be generated here, and any
 * other system is entered by the user as PROJ or WKT text. Transformations
 * are performed by the proj4 library; grid-shift files are not supported.
 */

export const WGS84_GEOGRAPHIC = '+proj=longlat +datum=WGS84 +no_defs';

/** PROJ definition and EPSG code of a WGS 84 / UTM zone. */
export function utmDefinition(zone: number, south: boolean): { name: string; epsg: number; definition: string } {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) throw new Error('UTM zone must be a whole number from 1 to 60.');
  return {
    name: `WGS 84 / UTM zone ${zone}${south ? 'S' : 'N'}`,
    epsg: (south ? 32700 : 32600) + zone,
    definition: `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`,
  };
}

/** UTM zone containing a longitude (standard 6° zones; the Norway/Svalbard exceptions are not applied). */
export function utmZoneForLongitude(lonDeg: number): number {
  return Math.min(60, Math.max(1, Math.floor((lonDeg + 180) / 6) + 1));
}

/** Returns null when the definition is usable, otherwise the reason it is not. */
export function validateCrsDefinition(definition: string): string | null {
  const d = definition.trim();
  if (d === '') return 'The definition is empty.';
  try {
    const p = proj4(d, WGS84_GEOGRAPHIC);
    const r = p.forward([0, 0]);
    if (!Array.isArray(r)) return 'The definition could not be used for a transformation.';
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export interface Transformer {
  forward(x: number, y: number): [number, number];
  inverse(x: number, y: number): [number, number];
}

/**
 * Transformation between two CRS definitions. Projected coordinates are in the
 * units of the definition (metres for the systems generated here); geographic
 * coordinates are longitude, latitude in degrees.
 */
export function makeTransformer(fromDefinition: string, toDefinition: string): Transformer {
  const p = proj4(fromDefinition.trim(), toDefinition.trim());
  const check = (r: number[]): [number, number] => {
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1])) throw new Error('Coordinate is outside the valid area of the coordinate system.');
    return [r[0]!, r[1]!];
  };
  return {
    forward: (x, y) => check(p.forward([x, y])),
    inverse: (x, y) => check(p.inverse([x, y])),
  };
}

/** True when the definition is geographic (longitude/latitude), not projected. */
export function isGeographic(definition: string): boolean {
  return /\+proj=longlat/.test(definition) || /^\s*GEOGCS|^\s*GEOGCRS/i.test(definition);
}
