# TLCAD — Validation Report

Version 0.1.0 · 19 November 2026 · Phase 7 (Integration and Testing)

## 1. Purpose and basis

This report records how the engineering functions of TLCAD were checked, what the checks found, and
where the program stops. The reference is the PLS-CADD manual (Version 12.3), cited by section,
equation and figure. The development rule was that no engineering formula is invented: where the
manual is silent, the program either uses a stated standard method or refuses to calculate. Those
places are listed in §6.

Everything here can be reproduced from the repository:

```bash
npm test
```

```bash
TLCAD_BENCH=1 npx vitest run apps/web/src/e2e/bench.test.ts
```

The first command runs all 164 tests (one benchmark is skipped unless asked for). The second runs the
large-line benchmark of §5.

## 2. How results were checked

Each calculated result is checked in one or more of these ways. The test names state which.

| Kind | Meaning |
|---|---|
| Manual example | Reproduces a number or figure printed in the manual (e.g. the GRID example). |
| Independent method | Compared with a different formulation of the same physics (e.g. the parabolic change-of-state equation against the catenary length-compatibility solver). |
| Statics / identity | A conservation law or identity that must hold (forces balance, arc length is conserved, an inverse returns the input). |
| Hand calculation | Recomputed in the test from the manual's equation with numbers typed in. |
| Round trip | Written by TLCAD and read back (files, archive, undo/redo). |
| Refusal | Inputs the manual does not cover are rejected with a message, not given a number. |

## 3. Validation cases

### 3.1 Terrain and alignment (§6)

| Case | Reference | Check | Result |
|---|---|---|---|
| Line angle of alignment 1-8-6 is 108°26'06" | Fig. 6.3-2 | Manual example | Pass |
| Alignment 1-2-5-9: angles −90°, +45°; end station 1707.11 | Fig. 6.3-7 | Manual example | Pass |
| Virtual alignment with branch: point 8 at station 2507.11 | Fig. 6.3-8 | Manual example | Pass |
| Equation stations | §6.11 | Manual example | Pass |
| GRID TIN has 16 triangles; diagonal profile reproduces the pyramid | §6.4.4 | Manual example | Pass |
| Points in the outside wedge of a line angle are not projected | §6.3.2 | Manual rule | Pass |
| Break lines force TIN edges; contours close | §6.5 | Identity | Pass |
| UTM: central meridian on the equator is E 500 000, N 0 | §6.2.1 | Known value | Pass |
| XYZ, PFL, BRK, CSV, ASCII grid, GeoTIFF, LAS read/write | App. D, E | Round trip / manual record | Pass |

### 3.2 Cables, structures, stringing (§8–§10)

| Case | Reference | Check | Result |
|---|---|---|---|
| Structure axes: TS to positive offsets, LS = TS turned 90° clockwise; bisector at a P.I. | §7.3.12.1 | Hand calculation | Pass |
| 2-part (V-string) point C | App. F.1.3 | Two-circle solution | Pass |
| Method 1 allowable spans interpolated by line angle | App. F.1.4.1 | Hand calculation | Pass |
| Stringing rules: dead ends, bypass, transposition, phase counts | §10.3.1 | Rule cases | Pass |
| Polynomial fit from test data recovers an exact polynomial | App. G.1 | Identity | Pass |
| Linear elastic cable with constant creep equals the linear model | Eqs. 9-10, 9-11 | Independent method | Pass |

### 3.3 Sag-tension and span results (§7, §9, App. I, J)

| Case | Reference | Check | Result |
|---|---|---|---|
| Catenary identities, J-3 sag and J-7 low point agree with the curve | App. J | Identity | Pass |
| Span end forces balance the load, with and without wind | J.1.2 | Statics | Pass |
| Ruling span, S²/C for one inclined span | Eq. I-1 | Hand calculation | Pass |
| Unit loads with wind on ice and NESC K | Eqs. 7-3, 7-6 | Hand calculation | Pass |
| Change of state agrees with the parabolic state-change equation | §9.1 | Independent method, within 0.2 % | Pass |
| Linear creep equals the initial state at a higher temperature | App. G.2 | Identity | Pass |
| A sagging condition given after creep is matched exactly | §10.3.2 | Identity | Pass |
| Bimetallic share; outer strands cannot carry compression | §7.3.5, §9.1 | Physical bound | Pass |
| Automatic sagging lands exactly on the controlling limit | §7.3.7 | Identity | Pass |
| Weight span by the J-7 low points | App. I.3 | Hand calculation | Pass |
| Exact and arc-length weight span models agree without wind | App. I.3 | Independent method | Pass |
| Swing of a weightless insulator on a level line = atan(UH/UV) | Eq. 7-37 | Hand calculation, within 0.15° | Pass |
| Tension limit usage from H + w·sag | §7.3.6 | Hand calculation | Pass |
| Graphical sag through a picked point returns the same tension | §10.3.2.1.4 | Round trip, 4 × 10⁻¹⁴ | Pass (browser) |
| GAP conductors, ice on multi-cable messengers | §9.2 | Refusal | Pass |

### 3.4 Clearances, loads and strength (§6.1.1, §7.3.11–7.3.15, §8.3.2, §11.2.3)

| Case | Reference | Check | Result |
|---|---|---|---|
| Rectangular zone, band (RH blank), aerial obstacle | Fig. 6.1-3 | Hand calculation | Pass |
| Building under a phase: wire height from the catenary of App. J | §6.1.1 | Hand calculation, 1 cm | Pass |
| Wind checked from both sides | §7.3.13 | Rule | Pass |
| Phase separation minus conductor diameter | §11.2.3.2.2 | Hand calculation | Pass |
| Ice jump reflects the iced shape about the un-iced shape | §11.2.3.2.2 | Identity | Pass |
| Galloping REA single and double loop, CIGRE, safety factor | Eqs. 7-22 to 7-36 | Hand calculation | Pass |
| Ellipse position relative to the conductor | Fig. 7.3-13 | Read from the rendered figure | Pass |
| Load tree on an exactly level line: V and T by statics, no net L | Eqs. 7-7 to 7-12 | Statics, 10⁻⁶ | Pass |
| Structure pressures | Eqs. 7-13, 7-14 | Hand calculation | Pass |
| Method 2 inside/outside and usage | Fig. 8.3-2 | Hand calculation | Pass |

### 3.5 Drafting, reports and data (§12, §13, App. M)

| Case | Reference | Check | Result |
|---|---|---|---|
| Sheet paging and the common structure at page ends | §13.2.3 | Rule | Pass |
| Structure drawn at its scaled station and height | §13.2.3 | Hand calculation | Pass |
| PDF cross-reference offsets and stream lengths | PDF 1.4 | Structure check; opened and drawn by MuPDF | Pass |
| DXF R12 written and read back | §13.4 | Round trip | Pass |
| Bill of material: nested assemblies, cable arc length > chord length | §8.5 | Hand calculation | Pass |
| Project archive and 25-step undo/redo | — | Round trip | Pass |

## 4. End-to-end workflow (Demo Line)

`apps/web/src/e2e/workflow.test.ts` runs the full design workflow through the same commands the
user interface calls, with no manual data fixes. It fails if any step logs an error. The input is
the Demo Line sample (`samples/demo_line`). Its data are synthetic and illustrative, not a design
basis. The same line can be built in the application with Help ▸ Open Demo Line Sample.

Steps: new project → import 648 survey points → feature codes and clearances → alignment (3 P.I.s,
1 743.7 m) → cable and structure library → criteria (6 weather cases) → spot 3 dead ends and
4 tangents → string 2 sections → automatic sagging → all checks → 5 P&P sheets → 8 reports →
bill of material → KMZ → archive round trip → undo all 17 commands and redo them.

Results:

| Result | Section 1–4 | Section 4–7 |
|---|---|---|
| Ruling span | 277.26 m | 298.31 m |
| Sagging tension H (autosag, everyday 20 % ULT controls) | 24 909.6 N | 24 895.3 N |
| Everyday tension limit usage (25 % ULT) | 80.0 % | 80.0 % |
| High wind (50 % ULT) | 56.2 % | 56.7 % |
| Ice (50 % ULT) | 65.7 % | 66.3 % |

The checks find the problems the sample was built to contain. Structure 5 is a tangent at the
bottom of a valley:

- **Uplift at structure 5:** the weight spans are −161 m, −64 m and −269 m, and minimum vertical load
  is violated on all 3 phases. The swing is reported as "uplift" rather than as an angle.
- **Overloaded tangent:** structure 6 is at 128 % of its Method 1 allowable spans; the other tangents
  are at 69–89 %.
- **Ground clearance:** 43 ground points are questionable (band check), and the shortest distance to
  the TIN is 3.65 m against the 7 m required.
- **No violations:** survey point rectangles (barn, road, distribution crossing), wire-to-wire with ice
  jump (smallest clearance 5.84 m against 2 m required), galloping (no ellipse overlap).

Two program defects were found and fixed while running this workflow:

1. A suspension insulator in uplift reported a swing of 180°. It now reports uplift and fails the
   swing check.
2. A wire passing below a ground point was not reported. The clearance zone now extends below
   the ground (the manual's zone stops at the ground, where a wire cannot be; data that put it
   there must be flagged).

## 5. Performance

Synthetic line: 30 km, 100 000 survey points (TIN of 199 156 triangles), 100 structures, 10 sections.
Times from the benchmark, in Node on the development PC:

| Operation | Time |
|---|---|
| Terrain, TIN and profiles | 442 ms |
| Line model (structures, attachment points, wires) | 149 ms |
| Sag-tension of 10 sections | 4 ms |
| Structure checks (100 structures) | 24 ms |
| Survey point clearances (100 000 points, 3 conditions) | 666 ms (was 10 591 ms) |
| Clearance to the TIN | 1 642 ms |
| Wire clearances | 166 ms |
| 99 P&P sheets | 732 ms |

Tuning in this phase: survey clearances now index the spans by station, so each point meets only
the spans above it (16 × faster). The Sheets view draws only the page shown. Interactive work (sag
changes, structure moves) stays within a few tens of milliseconds. The clearance checks run on
request.

## 6. Limits of validation

These parts rest on a stated method, or are not implemented. Each is listed in Help ▸ Feature Status.

- **Change-of-state solver:** the manual does not specify the numerical method. The standard
  length-compatibility method is used and stated in every calculation trace. It is checked against
  the independent parabolic equation (§3.3), not against PLS-CADD output.
- **No comparison with PLS-CADD output:** no PLS-CADD project files or reports were available, so no
  result has been compared with numbers produced by PLS-CADD itself, except the manual examples
  in §3.1.
- **Not available because the defining document is not in the reference set:**
  - code-specific wind height and gust factors (E11);
  - the improved linear cable model (C7);
  - thermal rating (X1);
  - EMF (X2);
  - construction offsets (X3);
  - finite-element wire models (X4);
  - Method 3/4 structure analysis (S8).
- **Planned, not built:**
  - spotting constraints and optimum spotting (SP3, SP4);
  - wire-to-structure clearance (CL5);
  - danger trees (CL6).
- **Partial**, as noted per feature:
  - continuous wind range for clearances;
  - isoclearance TINs;
  - unbalanced loads;
  - aerial plan layout and profile breaks on sheets;
  - DXF blocks;
  - item status in the bill of material.

All engineering inputs (weather, limits, clearances, cable and structure data) are the user's
responsibility. The program supplies none, and the sample data are illustrative only.
