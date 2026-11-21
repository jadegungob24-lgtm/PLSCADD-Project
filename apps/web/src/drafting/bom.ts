import { solveSpan } from '@tlcad/engine';
import type { MaterialItem, Project } from '@tlcad/model';
import { stateAt, type Analysis } from '../store/analysis';
import type { LineModel } from '../store/lineModel';

/**
 * Bill of material (manual §8.5.6.1): structure file material, structure-
 * specific material, line-specific material and cable lengths, with
 * assemblies expanded into their parts. Item status (new / existing /
 * retired / transferred) and conductor-specific part rules are not
 * implemented.
 */

export interface BomRow {
  stock: string;
  description: string;
  unit: string;
  qty: number;
  materialCost: number | null;
  laborCost: number | null;
  /** Where the quantity comes from. */
  sources: string[];
}

export interface Bom {
  rows: BomRow[];
  problems: string[];
  /** Per-structure lists (stock and quantity, assemblies not expanded) for staking tables. */
  byStructure: { label: string; items: MaterialItem[] }[];
}

export function cableLengths(p: Project, a: Analysis): { stock: string; description: string; length: number; note: string }[] {
  const out = new Map<string, { stock: string; description: string; length: number; note: string }>();
  for (const sa of a.sections.values()) {
    const c = sa.cable;
    if (!c) continue;
    const key = c.stockNumber || c.name;
    let L = 0, sagged = true;
    // Arc length of every span at the sagging condition (bare cable), or the chord when not sagged.
    const cs = sa.status === 'sagged' ? stateAt(p, sa, null, sa.sd.section.sagging.condition) : null;
    for (const spans of sa.phases) for (const g of spans) {
      if (cs?.ok) L += solveSpan(g.O, g.E, cs.H, { uh: 0, uv: cs.loads.uv }, 0).arc;
      else { sagged = false; L += Math.hypot(g.E.x - g.O.x, g.E.y - g.O.y, g.E.z - g.O.z); }
    }
    L *= sa.sd.section.conductorsPerPhase;
    const prev = out.get(key);
    const note = sagged ? 'arc length at the sagging condition, no allowance for jumpers or sag-in waste' : 'includes unsagged sections measured on the chord';
    out.set(key, { stock: key, description: c.description || c.name, length: (prev?.length ?? 0) + L, note: prev && prev.note !== note ? 'includes unsagged sections measured on the chord' : note });
  }
  return [...out.values()];
}

export function billOfMaterial(p: Project, m: LineModel, a: Analysis): Bom {
  const problems: string[] = [];
  const parts = new Map(p.materials.parts.map((x) => [x.stock, x]));
  const asm = new Map(p.materials.assemblies.map((x) => [x.stock, x]));
  const rows = new Map<string, BomRow>();
  const add = (stock: string, qty: number, src: string, depth = 0) => {
    if (depth > 20) { problems.push(`Assembly ${stock} refers to itself.`); return; }
    const as = asm.get(stock);
    if (as) { for (const it of as.items) add(it.stock, it.qty * qty, src, depth + 1); return; }
    const pt = parts.get(stock);
    if (!pt) { if (!problems.some((x) => x.includes(`"${stock}"`))) problems.push(`Stock number "${stock}" is not in the parts or assemblies list.`); }
    const r = rows.get(stock) ?? { stock, description: pt?.description ?? '(unknown part)', unit: pt?.unit ?? '', qty: 0, materialCost: pt ? 0 : null, laborCost: pt ? 0 : null, sources: [] };
    r.qty += qty;
    if (pt) { r.materialCost = (r.materialCost ?? 0) + qty * pt.materialCost; r.laborCost = (r.laborCost ?? 0) + qty * pt.laborCost; }
    if (!r.sources.includes(src)) r.sources.push(src);
    rows.set(stock, r);
  };
  const byStructure: Bom['byStructure'] = [];
  for (const sd of m.structures) {
    const items = [...(sd.type?.material ?? []), ...sd.s.material];
    const label = sd.s.label || String(sd.number);
    byStructure.push({ label, items });
    for (const it of sd.type?.material ?? []) add(it.stock, it.qty, 'structure files');
    for (const it of sd.s.material) add(it.stock, it.qty, 'structure-specific');
  }
  for (const it of p.materials.line) add(it.stock, it.qty, 'line-specific');
  for (const c of cableLengths(p, a)) {
    const pt = parts.get(c.stock);
    const r = rows.get(c.stock) ?? { stock: c.stock, description: pt?.description ?? c.description, unit: pt?.unit ?? 'm', qty: 0, materialCost: pt ? 0 : null, laborCost: pt ? 0 : null, sources: [] };
    r.qty += c.length;
    if (pt) { r.materialCost = (r.materialCost ?? 0) + c.length * pt.materialCost; r.laborCost = (r.laborCost ?? 0) + c.length * pt.laborCost; }
    r.sources.push(`cable (${c.note})`);
    rows.set(c.stock, r);
  }
  return { rows: [...rows.values()].sort((x, y) => x.stock.localeCompare(y.stock)), problems, byStructure };
}
