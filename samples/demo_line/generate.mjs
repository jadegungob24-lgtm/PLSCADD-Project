// Generates the Demo Line sample data set used by the end-to-end workflow test
// (apps/web/src/e2e/workflow.test.ts). Run: node samples/demo_line/generate.mjs
//
// ALL VALUES ARE ILLUSTRATIVE. The terrain is synthetic, and the cable,
// structures, weather cases, limits and clearances are made-up round numbers
// chosen to exercise the program. They are not manufacturer data, code values
// or a design basis and must not be used for an actual line.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PIS = [[0, 0], [800, 250], [1700, 150]];

// ---- terrain: a corridor of survey points along the P.I. path
const segs = [];
let s0 = 0;
for (let i = 1; i < PIS.length; i++) {
  const [ax, ay] = PIS[i - 1], [bx, by] = PIS[i];
  const L = Math.hypot(bx - ax, by - ay);
  segs.push({ ax, ay, dx: (bx - ax) / L, dy: (by - ay) / L, L, s0 });
  s0 += L;
}
const total = s0;
const at = (s, o) => {
  const g = segs.find((q) => s <= q.s0 + q.L + 1e-9) ?? segs[segs.length - 1];
  const t = s - g.s0;
  // Offset positive to the right of the direction of travel.
  return [g.ax + g.dx * t + g.dy * o, g.ay + g.dy * t - g.dx * o];
};
const ground = (s, o) => 150 + 10 * Math.sin(s / 220) + 6 * Math.sin(s / 97) - 22 * Math.exp(-(((s - 1150) / 120) ** 2)) + 0.04 * o;
const r = (v) => Math.round(v * 1000) / 1000;
const lines = [
  "TYPE='XYZ FILE' VERSION='4' UNITS='SI' SOURCE='TLCAD sample generator' USER='' FILENAME='terrain.xyz'",
  '; Demo Line: synthetic terrain for testing only (not a real survey).',
];
let n = 0;
const pt = (desc, s, o, code, h = 0) => {
  const [x, y] = at(s, o);
  lines.push(`'${desc}' ${r(x)} ${r(y)} ${r(ground(s, o))} ${code} ${r(h)}`);
  n++;
};
for (let s = -20; s <= total + 20; s += 20) for (let o = -60; o <= 60; o += 20) pt(`G${n + 1}`, Math.max(0, Math.min(total, s)), o, 2);
// Road crossing at station ~500 (ground-level feature code).
for (let o = -50; o <= 50; o += 10) pt('ROAD', 500, o, 300);
// Barn near station 1300, 15 m right of the centre line, 8 m high.
pt('BARN', 1300, 15, 310, 8);
pt('BARN', 1310, 15, 310, 8);
// Distribution line crossing at station ~1550 (aerial obstacle, 11 m above ground).
for (let o = -40; o <= 40; o += 20) pt('DIST', 1550, o, 400, 11);
writeFileSync(join(here, 'terrain.xyz'), lines.join('\n') + '\n');

// ---- P.I.s (entered in the plan view in the real workflow)
writeFileSync(join(here, 'alignment.json'), JSON.stringify({ name: 'Demo Line', startStation: 0, pis: PIS.map(([x, y]) => ({ x, y })) }, null, 1));

// ---- feature codes and required clearances by voltage (illustrative)
writeFileSync(join(here, 'feature_codes.json'), JSON.stringify({
  voltages: [230],
  codes: [
    { code: 2, description: 'Ground', onGround: true, aerial: false, color: '#7fd08a', clearances: { 230: { rv: 7, rh: null } } },
    { code: 300, description: 'Road', onGround: true, aerial: false, color: '#c0c0c0', clearances: { 230: { rv: 8.5, rh: null } } },
    { code: 310, description: 'Building', onGround: false, aerial: false, color: '#e05d4f', clearances: { 230: { rv: 5, rh: 3 } } },
    { code: 400, description: 'Distribution line', onGround: false, aerial: true, color: '#4f8ff7', clearances: { 230: { rv: 2.5, rh: null } } },
  ],
}, null, 1));

// ---- cable and structure library in the TLCAD library format
const att = (set, phase, o) => ({ set, phase, deadEnd: false, setDescription: '', insulator: 'clamp', weight: 0, windArea: 0, length: 0, x: 0, y: 0, z: 0, minVertical: { kind: 'noLimit', value: 0 }, swing: null, part2: null, ...o });
const library = {
  format: 'tlcad-library', version: 1,
  cables: [{
    id: 'demo-cable', name: 'Demo conductor (illustrative)', description: 'Illustrative values only, not manufacturer data', stockNumber: 'DEMO-COND', model: 'linear',
    area: 4.0e-4, diameter: 0.0259, unitWeight: 15.3, ultimateTension: 125000, independentCables: 1, gapType: false, testTemperature: 20,
    outer: { finalModulus: 7.0e8, thermalCoeff: 19e-6, initial: [0, 0, 0, 0, 0], creep: [0, 0, 0, 0, 0] }, core: null,
    creepTemperatureShift: 15, outerCompression: { mode: 'criteria', limit: 0 }, color: '#d33c2f', testData: null, src: 'user',
  }],
  structures: [
    {
      id: 'demo-tangent', name: 'Demo tangent 27', description: 'Illustrative horizontal-configuration tangent', height: 27, embedment: 3, cost: null, autoSpotMinAngle: 0, material: [], src: 'user',
      strength: { method: 'method1', validity: 'Illustrative allowable spans', rows: [
        { lineAngle: 0, maxWindSpan: 400, maxWeightSpan: [500, 500, 500], minWeightSpan: 0 },
        { lineAngle: 2, maxWindSpan: 350, maxWeightSpan: [450, 450, 450], minWeightSpan: 0 },
      ], ranges: [] },
      attachments: [-6, 0, 6].map((x, i) => att(1, i + 1, { insulator: 'suspension', length: 2.4, weight: 600, windArea: 0.25, x, y: 2, swing: [[-60, 60], [-60, 60], [-70, 70], [-60, 60]], minVertical: { kind: 'noUplift', value: 0 } })),
    },
    {
      id: 'demo-deadend', name: 'Demo dead end 24', description: 'Illustrative angle / dead-end structure', height: 24, embedment: 3.5, cost: null, autoSpotMinAngle: 0, material: [], src: 'user',
      strength: { method: 'none', validity: '', rows: [], ranges: [] },
      attachments: [-6, 0, 6].map((x, i) => att(1, i + 1, { insulator: 'strain', deadEnd: true, length: 3, weight: 900, x, y: 2 })),
    },
  ],
};
writeFileSync(join(here, 'library.json'), JSON.stringify(library, null, 1));

// ---- design criteria (illustrative)
const wc = (id, name, temperature, windPressure = 0, iceThickness = 0) => ({ id, name, airDensity: 0.613, windPressure, iceThickness, iceDensity: iceThickness ? 8820 : 0, iceLoad: 0, temperature, weatherLoadFactor: 1, nescK: 0, gustFactor: 1, src: 'user' });
writeFileSync(join(here, 'criteria.json'), JSON.stringify({
  notes: 'Demo Line criteria: illustrative values only.',
  weatherCases: [wc('ed', 'Everyday 15C', 15), wc('hot', 'Hot 75C', 75), wc('cold', 'Cold -10C', -10), wc('wind', 'High wind', 10, 700), wc('ice', 'Ice 12 mm', 0, 0, 0.012), wc('gal', 'Galloping swing', 0, 96, 0.012)],
  creepWeatherId: 'ed', loadWeatherId: 'ice',
  tensionLimits: [
    { id: 'tl1', weatherId: 'ed', condition: 'initial', maxPercentUltimate: 25, maxTension: null, maxCatenary: null, cableIds: [] },
    { id: 'tl2', weatherId: 'wind', condition: 'initial', maxPercentUltimate: 50, maxTension: null, maxCatenary: null, cableIds: [] },
    { id: 'tl3', weatherId: 'ice', condition: 'initial', maxPercentUltimate: 50, maxTension: null, maxCatenary: null, cableIds: [] },
  ],
  autosagLimits: [
    { id: 'al1', weatherId: 'ed', condition: 'initial', maxPercentUltimate: 20, maxTension: null, maxCatenary: null, cableIds: [] },
    { id: 'al2', weatherId: 'cold', condition: 'initial', maxPercentUltimate: 30, maxTension: null, maxCatenary: null, cableIds: [] },
  ],
  weightSpanConditions: [{ weatherId: 'cold', condition: 'initial' }, { weatherId: 'ice', condition: 'initial' }, { weatherId: 'wind', condition: 'initial' }],
  swingConditions: [{ weatherId: 'ed', condition: 'creep' }, { weatherId: 'cold', condition: 'initial' }, { weatherId: 'wind', condition: 'initial' }, { weatherId: null, condition: 'initial' }],
  surveyClearance: { conditions: [{ weatherId: 'hot', condition: 'creep' }, { weatherId: 'ice', condition: 'load' }, { weatherId: 'wind', condition: 'initial' }], type: 'rectangular', maxHorizontal: null },
  clearanceLine: { voltageKV: 230, groundCode: 2 },
  wireClearance: {
    source: { voltageKV: null, weatherId: 'ice', condition: 'initial', wind: 'right', straight: false, iceJump: true },
    target: { voltageKV: null, weatherId: 'ice', condition: 'initial', wind: 'right', straight: false, iceJump: false },
    measure: '3d', required: [{ sourceKV: 230, targetKV: 230, distance: 2 }],
  },
  galloping: { method: 'reaSingle', sag: { weatherId: 'ice', condition: 'initial' }, swing: { weatherId: 'gal', condition: 'initial' }, gsf: 1, eswZero: false },
  loadCases: [
    { id: 'lc1', name: 'High wind NA+', weatherId: 'wind', condition: 'initial', windDirection: 'NA+', wb: 0, lfv: 1.1, lfw: 1.2, lft: 1.1, lfs: 1.1 },
    { id: 'lc2', name: 'High wind NA-', weatherId: 'wind', condition: 'initial', windDirection: 'NA-', wb: 0, lfv: 1.1, lfw: 1.2, lft: 1.1, lfs: 1.1 },
    { id: 'lc3', name: 'Ice', weatherId: 'ice', condition: 'initial', windDirection: 'NA+', wb: 0, lfv: 1.2, lfw: 1, lft: 1.2, lfs: 1.1 },
  ],
  display: { weatherId: null, condition: 'initial', wind: 'right' },
}, null, 1));

console.log(`Demo Line: ${n} survey points over ${total.toFixed(1)} m written to ${here}`);
