import { structureFrame } from '@tlcad/engine';
import type { Attachment, LoadCase, Project } from '@tlcad/model';
import type { Derived } from './derived';
import type { StructureDerived } from './lineModel';
import { endReaction, stateAt, stateForWeather, type Analysis, type SectionAnalysis, type SpanWind } from './analysis';

/**
 * Structure load trees (§7.3.12): factored wire loads at the structure
 * attachment points for each load case of the criteria, in the structure's
 * transverse (TS), longitudinal (LS) and vertical directions. Unbalanced
 * loading (§7.3.12.7), the MAX wind option and taps are not implemented.
 */

export interface SpanReaction {
  span: 'back' | 'ahead';
  /** Factored reactions in span coordinates (Eqs. 7-7 to 7-12), bundle included. */
  V: number;
  T: number;
  L: number;
}

export interface AttachmentLoad {
  attachment: Attachment;
  sectionIds: string[];
  spans: SpanReaction[];
  /** Design loads in structure axes: vertical (down positive), transverse (TS), longitudinal (LS). */
  vertical: number;
  transverse: number;
  longitudinal: number;
}

export interface LoadCaseResult {
  loadCase: LoadCase;
  attachments: AttachmentLoad[];
  /** Structure design pressures SPRT and SPRL (Eqs. 7-13, 7-14). */
  sprt: number;
  sprl: number;
  problems: string[];
}

const rotCw = (v: { x: number; y: number }, deg: number) => {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return { x: v.x * c + v.y * s, y: -v.x * s + v.y * c };
};

export function loadTrees(p: Project, d: Derived, a: Analysis, sd: StructureDerived): { results: LoadCaseResult[]; problems: string[] } {
  const problems: string[] = [];
  const g = d.lines[sd.line]?.geom;
  if (!g || !sd.frame || !sd.type) return { results: [], problems: ['The structure has no position or type.'] };
  if (p.criteria.loadCases.length === 0) return { results: [], problems: ['No structure load cases are defined in the criteria (§7.3.12.8).'] };
  // Bisector direction on the positive-offset side, without the structure orientation (Fig. 7.3-7).
  const bis = structureFrame(g, sd.station, sd.s.offset, 0).ts;
  const B = { x: bis.e, y: bis.n };
  const TS = { x: sd.frame.ts.e, y: sd.frame.ts.n };
  const LS = { x: TS.y, y: -TS.x }; // TS rotated 90° clockwise (§7.3.12.1)
  // Sections and the index of this structure in each.
  const uses: { sa: SectionAnalysis; idx: number; set: number; transposition: string }[] = [];
  for (const sa of a.sections.values()) {
    const idx = sa.attached.findIndex((x) => x.s.id === sd.s.id);
    if (idx < 0) continue;
    const step = sa.sd.section.steps.filter((st) => st.set !== null)[idx]!;
    if (sa.status !== 'sagged') { problems.push(`Section ${sa.sd.from}–${sa.sd.to} is not sagged; its loads are not included.`); continue; }
    uses.push({ sa, idx, set: step.set!, transposition: step.transposition });
  }
  const results = p.criteria.loadCases.map((lc): LoadCaseResult => {
    const probs: string[] = [];
    const wc = lc.weatherId ? p.criteria.weatherCases.find((w) => w.id === lc.weatherId) ?? null : null;
    if (lc.weatherId && !wc) probs.push('Its weather case no longer exists.');
    const sign = lc.windDirection.endsWith('-') ? -1 : 1;
    // Wind direction vector in plan for the structure (and spans for BI/GLB/NL/NR).
    let structWind = { x: B.x * sign, y: B.y * sign };
    const out: AttachmentLoad[] = [];
    for (const att of sd.type!.attachments) {
      const al: AttachmentLoad = { attachment: att, sectionIds: [], spans: [], vertical: 0, transverse: 0, longitudinal: 0 };
      for (const u of uses.filter((x) => x.set === att.set)) {
        const k = u.transposition.indexOf(String(att.phase));
        if (k < 0) continue;
        const cs = wc ? stateForWeather(u.sa, wc, lc.condition) : stateAt(p, u.sa, null, lc.condition);
        if (!cs.ok) { probs.push(cs.message); continue; }
        const nc = u.sa.sd.section.conductorsPerPhase;
        const spans = u.sa.phases[k]!;
        const parts = [
          ...(u.idx > 0 ? [{ g: spans[u.idx - 1]!, end: 'E' as const, other: u.sa.attached[u.idx - 1]! }] : []),
          ...(u.idx < spans.length ? [{ g: spans[u.idx]!, end: 'O' as const, other: u.sa.attached[u.idx + 1]! }] : []),
        ];
        // Back span: the one whose far structure has the smaller station (§7.3.12.2).
        const tagged = parts.map((q) => ({ ...q, side: (q.other.station < sd.station ? 'back' : 'ahead') as 'back' | 'ahead' }));
        const backSpan = tagged.find((q) => q.side === 'back'), aheadSpan = tagged.find((q) => q.side === 'ahead');
        const normalOf = (q: typeof tagged[number] | undefined) => {
          if (!q) return null;
          const hx = q.g.E.x - q.g.O.x, hy = q.g.E.y - q.g.O.y, hl = Math.hypot(hx, hy) || 1;
          const n = { x: hy / hl, y: -hx / hl };
          return n.x * B.x + n.y * B.y >= 0 ? n : { x: -n.x, y: -n.y }; // on the positive-offset side
        };
        let windOf: (q: typeof tagged[number]) => SpanWind;
        switch (lc.windDirection) {
          case 'NA+': case 'NA-':
            // Wind normal to every span, toward positive (negative) offsets (§7.3.12.2).
            windOf = (q) => { const n = normalOf(q)!; return { kind: 'vector', x: n.x * sign, y: n.y * sign }; };
            break;
          case 'BI+': case 'BI-': {
            const w = rotCw(B, lc.wb);
            structWind = { x: w.x * sign, y: w.y * sign };
            windOf = () => ({ kind: 'vector', ...structWind });
            break;
          }
          case 'NL+': case 'NL-': case 'NR+': case 'NR-': {
            const ref = lc.windDirection.startsWith('NL') ? backSpan : aheadSpan;
            const n = normalOf(ref) ?? B;
            structWind = { x: n.x * sign, y: n.y * sign };
            windOf = () => ({ kind: 'vector', ...structWind });
            break;
          }
          case 'GLB': {
            const az = (lc.wb * Math.PI) / 180;
            structWind = { x: Math.sin(az), y: Math.cos(az) };
            windOf = () => ({ kind: 'vector', ...structWind });
            break;
          }
        }
        for (const q of tagged) {
          const r = endReaction(q.g, q.end, cs, windOf(q));
          // Factored bundle reactions (Eqs. 7-7 to 7-12).
          const V = lc.lfv * nc * r.V, T = lc.lfw * nc * r.T, L = lc.lft * nc * r.L;
          // Reported T is positive toward the positive bisector direction (§7.3.12.3 sign convention).
          al.spans.push({ span: q.side, V, T: r.normal.x * B.x + r.normal.y * B.y >= 0 ? T : -T, L });
          const fx = r.along.x * L + r.normal.x * T, fy = r.along.y * L + r.normal.y * T;
          al.transverse += fx * TS.x + fy * TS.y;
          al.longitudinal += fx * LS.x + fy * LS.y;
          al.vertical += V;
        }
        if (!al.sectionIds.includes(u.sa.sd.section.id)) al.sectionIds.push(u.sa.sd.section.id);
      }
      if (al.spans.length === 0) continue;
      // Insulator and counterweight weights times LFS (§7.3.12.4).
      al.vertical += lc.lfs * (att.weight + (att.part2?.weight ?? 0) + (sd.s.counterweights[String(att.set)] ?? 0));
      out.push(al);
    }
    if (!wc) structWind = { x: 0, y: 0 };
    const P = wc ? lc.lfw * wc.weatherLoadFactor * wc.windPressure : 0;
    return {
      loadCase: lc, attachments: out,
      sprt: P * (structWind.x * TS.x + structWind.y * TS.y),
      sprl: P * (structWind.x * LS.x + structWind.y * LS.y),
      problems: [...new Set(probs)],
    };
  });
  return { results, problems };
}
