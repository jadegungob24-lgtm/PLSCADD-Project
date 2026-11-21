import { makeTransformer, WGS84_GEOGRAPHIC } from '@tlcad/engine';
import { buildKml, buildKmz, type KmlPlacemark } from '@tlcad/io';
import type { Project } from '@tlcad/model';
import type { DerivedView } from '../store/derived';

/**
 * Google Earth export: alignments, structures and wires (at the display
 * condition) as KML placemarks in a KMZ. Coordinates are converted from the
 * project coordinate system to WGS 84; elevations are written as given
 * ("absolute" altitude), so they are only correct in Google Earth when the
 * project elevations are above mean sea level.
 */
export function buildLineKmz(p: Project, d: DerivedView): { ok: true; bytes: Uint8Array; count: number } | { ok: false; message: string } {
  if (!p.settings.crs) return { ok: false, message: 'Define the project coordinate system first (Project ▸ Coordinate System).' };
  let t;
  try { t = makeTransformer(p.settings.crs.definition, WGS84_GEOGRAPHIC); } catch (e) { return { ok: false, message: `Coordinate system error: ${e instanceof Error ? e.message : String(e)}` }; }
  const ll = (x: number, y: number, z: number): [number, number, number] => { const [lon, lat] = t.forward(x, y); return [lon, lat, z]; };
  const pm: KmlPlacemark[] = [];
  try {
    for (const l of d.lines) {
      if (l.alignment.pis.length < 2) continue;
      pm.push({ name: l.alignment.name, folder: 'Alignments', line: l.alignment.pis.map((q) => ll(q.x, q.y, 0)), color: '#f2d14b', width: 2, clamp: true });
    }
    for (const sd of d.model.structures) {
      if (!sd.frame) continue;
      pm.push({
        name: sd.s.label || `Str ${sd.number}`, folder: 'Structures', point: ll(sd.frame.baseX, sd.frame.baseY, sd.topZ ?? sd.ground ?? 0),
        description: `${sd.type?.name ?? ''} — station ${sd.station.toFixed(2)} m`,
      });
    }
    for (const sec of d.model.sections) {
      const shape = d.analysis.sections.get(sec.section.id)?.shape;
      (shape?.plan ?? sec.wires).forEach((ph, k) => {
        pm.push({ name: `Section ${sec.from}–${sec.to} phase ${k + 1}`, folder: 'Wires', line: ph.map((q) => ll(q.x, q.y, q.z)), color: sec.cable?.color ?? '#e05d4f', width: 2 });
      });
    }
  } catch (e) {
    return { ok: false, message: `A coordinate could not be converted: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Alignment lines have no elevation and are draped on the ground.
  const kml = buildKml(p.meta.name, pm);
  return { ok: true, bytes: buildKmz(kml), count: pm.length };
}
