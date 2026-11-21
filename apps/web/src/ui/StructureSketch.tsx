import { fromSI, twoPartPoint, unitLabel, type UnitSystem } from '@tlcad/engine';
import { INSULATOR_LABEL, type StructureType } from '@tlcad/model';

/**
 * Transverse elevation of a structure type (view down the line): the vertical
 * axis from ground to TOP, and each attachment with its insulator. Drawn from
 * the top geometry only (Method 1–3 structures are "stick figures", §8.4.1).
 * Strain insulators run along the line, so in this view they appear as a
 * point; their length is listed in the table instead.
 */

const COLORS = ['#2f6fbd', '#c4572a', '#2f9a52', '#8a4fc0', '#b8860b', '#178a8a'];

export function StructureSketch({ t, sys, height = 300, highlight }: { t: StructureType; sys: UnitSystem; height?: number; highlight?: number }) {
  const pts = t.attachments.flatMap((a) => {
    const out = [{ x: a.x, y: a.y }];
    if (a.insulator === 'suspension') out.push({ x: a.x, y: a.y + a.length });
    if (a.part2) out.push({ x: a.part2.x, y: a.part2.y });
    return out;
  });
  const xs = [0, ...pts.map((p) => p.x)];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const H = t.height;
  // Square scale; frame: from TOP (y = 0) down to the ground (y = H), plus margins.
  const spanX = Math.max(maxX - minX, H * 0.25, 1);
  const pad = Math.max(spanX, H) * 0.08;
  const vbX = minX - pad - spanX * 0.15, vbW = spanX * 1.3 + 2 * pad;
  const vbY = Math.min(0, ...pts.map((p) => p.y)) - pad, vbH = H - vbY + pad;
  const s = Math.max(vbW, vbH) / 300; // stroke and text scale
  const len = (v: number) => `${Number(fromSI(v, sys, 'length').toFixed(2))}`;
  const setColor = (set: number) => COLORS[(set - 1) % COLORS.length]!;
  const sets = [...new Set(t.attachments.map((a) => a.set))];

  return (
    <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} style={{ width: '100%', height, background: '#fbfcfd', border: '1px solid var(--border-soft)' }} aria-label={`Elevation of ${t.name}`}>
      {/* ground */}
      <line x1={vbX} x2={vbX + vbW} y1={H} y2={H} stroke="#8a6d3b" strokeWidth={s * 1.5} />
      {/* structure axis */}
      <line x1={0} x2={0} y1={0} y2={H} stroke="#3a4450" strokeWidth={s * 3} />
      <text x={s * 4} y={H - s * 4} fontSize={s * 10} fill="#5d6772">HT {len(H)} {unitLabel(sys, 'length')}</text>
      {t.attachments.map((a, i) => {
        const col = setColor(a.set);
        const dim = highlight !== undefined && highlight !== a.set ? 0.3 : 1;
        const arm = <line x1={0} y1={a.y} x2={a.x} y2={a.y} stroke="#6b7480" strokeWidth={s * 1.5} opacity={dim} />;
        let ins: React.ReactNode = null;
        let wire = { x: a.x, y: a.y };
        if (a.insulator === 'suspension') {
          wire = { x: a.x, y: a.y + a.length };
          ins = <line x1={a.x} y1={a.y} x2={wire.x} y2={wire.y} stroke={col} strokeWidth={s * 2.5} />;
        } else if (a.insulator === '2part' && a.part2) {
          const c = twoPartPoint(a, a.length, a.part2, a.part2.length, a.part2.bottomOrRight);
          if (c) {
            wire = { x: c.x, y: c.y };
            ins = (
              <>
                <line x1={0} y1={a.part2.y} x2={a.part2.x} y2={a.part2.y} stroke="#6b7480" strokeWidth={s * 1.5} />
                <line x1={a.x} y1={a.y} x2={c.x} y2={c.y} stroke={col} strokeWidth={s * 2.5} />
                <line x1={a.part2.x} y1={a.part2.y} x2={c.x} y2={c.y} stroke={col} strokeWidth={s * 2.5} />
              </>
            );
          }
        }
        return (
          <g key={i} opacity={dim}>
            {arm}
            {ins}
            {a.insulator === 'strain'
              ? <rect x={a.x - s * 4} y={a.y - s * 4} width={s * 8} height={s * 8} fill="none" stroke={col} strokeWidth={s * 2} />
              : <circle cx={wire.x} cy={wire.y} r={s * 3.5} fill={col} />}
            <text x={wire.x + (a.x >= 0 ? s * 6 : -s * 6)} y={wire.y + s * 12} fontSize={s * 9} fill={col} textAnchor={a.x >= 0 ? 'start' : 'end'}>
              {a.set}:{a.phase}
            </text>
          </g>
        );
      })}
      {/* legend */}
      {sets.map((set, i) => {
        const a = t.attachments.find((k) => k.set === set)!;
        return (
          <text key={set} x={vbX + s * 6} y={vbY + s * 12 * (i + 1)} fontSize={s * 9} fill={setColor(set)}>
            Set {set}{a.setDescription ? ` ${a.setDescription}` : ''} — {INSULATOR_LABEL[a.insulator]}{a.deadEnd ? ', dead end' : ''}
          </text>
        );
      })}
    </svg>
  );
}
