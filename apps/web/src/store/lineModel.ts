import {
  checkStringing, localToGlobal, profileElevation, projectPoint, structureFrame, tinElevation, twoPartPoint,
  type StructureFrame, type Vec3,
} from '@tlcad/engine';
import {
  structureSets, type Attachment, type Cable, type PlacedStructure, type Project, type Section, type StructureType,
} from '@tlcad/model';
import type { Derived } from './derived';

/**
 * Line model derived from the project: structure numbers, positions, ground
 * elevations and attachment points, and the wire attachment points of each
 * strung section.
 *
 * Sections are represented here by the chords between wire attachment points;
 * the sagged shapes are computed from them in analysis.ts. Strain
 * insulators are laid along the chord toward the adjacent attachment, and
 * suspension insulators hang plumb, which is their position with balanced
 * tensions and no wind.
 */

export interface AttachmentPoint {
  a: Attachment;
  /** Structure attachment point (top of insulator, clamp location, or post tip). */
  top: Vec3;
  /** Wire attachment point; for strain insulators it depends on the section and is filled per section. */
  wire: Vec3 | null;
}

export interface StructureDerived {
  s: PlacedStructure;
  type: StructureType | null;
  /** Structure number in the virtual profile (1-based), in station order. */
  number: number;
  /** Index of the structure's alignment, -1 if the alignment no longer exists. */
  line: number;
  /** Station in the virtual profile. */
  station: number;
  frame: StructureFrame | null;
  ground: number | null;
  groundSource: 'tin' | 'profile' | null;
  baseZ: number | null;
  topZ: number | null;
  points: AttachmentPoint[];
  problems: string[];
}

export interface SectionDerived {
  section: Section;
  cable: Cable | null;
  /** Wire points per phase, in structure order (chords between them). */
  wires: Vec3[][];
  /** The same points in profile coordinates (virtual station, elevation). */
  profile: { station: number; z: number }[][];
  /** Structure numbers of the attached structures, first and last. */
  from: number | null;
  to: number | null;
  problems: string[];
}

export interface LineModel {
  structures: StructureDerived[];
  byId: Map<string, StructureDerived>;
  sections: SectionDerived[];
}

const EMPTY: LineModel = { structures: [], byId: new Map(), sections: [] };
let lastKey: unknown[] = [];
let lastValue: LineModel = EMPTY;

const sub = (p: Vec3, q: Vec3) => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const norm = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

export function computeLineModel(p: Project | null, d: Derived): LineModel {
  if (!p) return EMPTY;
  const key = [d, p.structures, p.structureLibrary, p.sections, p.cableLibrary];
  if (key.every((k, i) => k === lastKey[i])) return lastValue;

  const types = new Map(p.structureLibrary.map((t) => [t.id, t]));
  const lineIndex = new Map(p.alignments.map((a, i) => [a.id, i]));

  const list: StructureDerived[] = p.structures.map((s) => {
    const problems: string[] = [];
    const type = types.get(s.typeId) ?? null;
    if (!type) problems.push('Its structure type is no longer in the library.');
    const line = lineIndex.get(s.alignmentId) ?? -1;
    const ld = line >= 0 ? d.lines[line] : undefined;
    const g = ld?.geom ?? null;
    const base: StructureDerived = {
      s, type, number: 0, line, station: NaN, frame: null, ground: null, groundSource: null, baseZ: null, topZ: null, points: [], problems,
    };
    if (!g) { problems.push(line < 0 ? 'Its alignment no longer exists.' : 'Its alignment has fewer than two P.I.s.'); return base; }
    base.station = g.startStation + s.station;
    if (s.station < -1e-6 || s.station > g.totalLength + 1e-6) problems.push('It lies beyond the end of its alignment.');
    const f = structureFrame(g, base.station, s.offset, s.orientation);
    base.frame = f;
    // Ground: the TIN surface under the base where available, else the centerline ground profile at the station.
    const zt = d.tin ? tinElevation(d.tin, f.baseX, f.baseY) : null;
    if (zt !== null) { base.ground = zt; base.groundSource = 'tin'; }
    else {
      const zp = profileElevation(ld!.centerline, base.station);
      if (zp !== null) { base.ground = zp; base.groundSource = 'profile'; }
      else problems.push('There is no ground elevation at its location (no TIN surface and no centerline profile there).');
    }
    if (base.ground === null || !type) return base;
    base.baseZ = base.ground + s.heightAdjust;
    base.topZ = base.baseZ + type.height;
    for (const a of type.attachments) {
      const top = localToGlobal(f, base.topZ, a);
      let wire: Vec3 | null = null;
      if (a.insulator === 'clamp' || a.insulator === 'post') wire = top;
      else if (a.insulator === 'suspension') wire = { ...top, z: top.z - a.length };
      else if (a.insulator === '2part' && a.part2) {
        const c = twoPartPoint(a, a.length, a.part2, a.part2.length, a.part2.bottomOrRight);
        if (c) wire = localToGlobal(f, base.topZ, c);
        else problems.push(`Set ${a.set} phase ${a.phase}: the two parts of the insulator cannot meet.`);
      }
      base.points.push({ a, top, wire });
    }
    return base;
  });

  // Number in the order of the virtual profile (alignment order, then station).
  const sorted = [...list].sort((a, b) => (a.line < 0 ? 1e9 : a.line) - (b.line < 0 ? 1e9 : b.line) || (a.station || 0) - (b.station || 0));
  sorted.forEach((x, i) => { x.number = i + 1; });
  const byId = new Map(sorted.map((x) => [x.s.id, x]));

  const cables = new Map(p.cableLibrary.map((c) => [c.id, c]));
  const sections: SectionDerived[] = p.sections.map((section) => {
    const problems: string[] = [];
    const cable = cables.get(section.cableId) ?? null;
    const steps = section.steps.map((st) => {
      const sd = byId.get(st.structureId);
      const set = sd?.type && st.set !== null ? structureSets(sd.type).find((k) => k.number === st.set) ?? null : null;
      if (!sd) problems.push('A structure of the section no longer exists.');
      else if (st.set !== null && !set) problems.push(`Structure ${sd.number}: set ${st.set} no longer exists on its structure type.`);
      return { st, sd, set };
    });
    // The stringing rules are checked whenever every structure and set of the section exists.
    if (problems.length === 0) {
      problems.push(...checkStringing(steps.map(({ st, sd, set }) => ({
        structureNumber: sd!.number, transposition: st.transposition,
        set: set ? { number: set.number, deadEnd: set.deadEnd, phaseCount: set.phaseCount } : null,
      }))));
    }
    const attached = steps.filter((x) => x.set && x.sd && x.sd.topZ !== null);
    const n = attached[0]?.set?.phaseCount ?? 0;
    const wires: Vec3[][] = [];
    const profile: { station: number; z: number }[][] = [];
    if (problems.length === 0 && attached.length === steps.filter((x) => x.set).length) {
      for (let k = 0; k < n; k++) {
        const tops = attached.map(({ st, sd }) => {
          const phase = Number(st.transposition[k]);
          return sd!.points.find((q) => q.a.set === st.set && q.a.phase === phase)!;
        });
        const pts = tops.map((q, i) => {
          if (q.a.insulator !== 'strain') return q.wire;
          // Strain insulator: along the chord toward the neighbouring attachment.
          const other = tops[i === 0 ? 1 : i - 1]!;
          const dir = sub(other.top, q.top);
          const l = norm(dir);
          return l > 0 ? { x: q.top.x + (dir.x / l) * q.a.length, y: q.top.y + (dir.y / l) * q.a.length, z: q.top.z + (dir.z / l) * q.a.length } : q.top;
        });
        if (pts.every((q) => q !== null)) {
          wires.push(pts as Vec3[]);
          profile.push((pts as Vec3[]).map((q, i) => {
            const sd = attached[i]!.sd!;
            return { station: stationOfPoint(d, sd.line, q.x, q.y) ?? sd.station, z: q.z };
          }));
        }
      }
    } else if (problems.length === 0) problems.push('A structure of the section has no ground elevation, so the section cannot be drawn.');
    if (!cable) problems.push('Its cable is no longer in the library.');
    const nums = steps.filter((x) => x.sd).map((x) => x.sd!.number);
    return { section, cable, wires, profile, from: nums.length ? Math.min(...nums) : null, to: nums.length ? Math.max(...nums) : null, problems };
  });

  lastKey = key;
  lastValue = { structures: sorted, byId, sections };
  return lastValue;
}

/** Virtual-profile station of a plan point on a structure's alignment (for drawing attachments in the profile). */
export function stationOfPoint(d: Derived, line: number, x: number, y: number): number | null {
  const g = d.lines[line]?.geom;
  return g ? projectPoint(g, x, y)?.station ?? null : null;
}
