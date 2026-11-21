# TLCAD

Browser-based transmission line design platform. Engineering methods follow the
PLS-CADD Version 12.3 user manual where it documents them; see
`docs/TLCAD_Development_Plan.md` for the manual analysis, feature matrix,
architecture and roadmap.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit and validation tests
npm run typecheck
npm run build      # production build in apps/web/dist
```

Requires Node.js 26 (pinned in `.node-version`; the project is built and tested with it) and a
current desktop browser (Chrome or Edge recommended; the project database uses the
origin-private file system).

## Deploy (Cloudflare)

TLCAD is a static web application: everything, including the SQLite project database, runs in
the browser, so there is no server code. The database uses the OPFS SAH-pool mode, which needs
no cross-origin isolation headers.

**Cloudflare Workers (static assets)** — Cloudflare dashboard ▸ Workers & Pages ▸ Create
application ▸ Continue with GitHub, choose this repository, then:

| Setting | Value |
|---|---|
| Project (Worker) name | `plscadd-project` (must match `name` in `wrangler.jsonc`) |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

`wrangler.jsonc` serves `apps/web/dist` as static assets. The site is then at
`https://plscadd-project.<your-subdomain>.workers.dev`.

**Cloudflare Pages (alternative)** — Create application ▸ Continue to Pages ▸ Connect to Git;
build command `npm run build`, build output directory `apps/web/dist`, framework preset None.

Cloudflare reads the Node version from `.node-version`. `apps/web/public/_headers` gives the
hashed files in `/assets` a one-year cache. Every push to `main` redeploys.

Each visitor's projects are stored in their own browser, on that site's address only: projects
saved on `localhost` do not appear on the deployed site and vice versa. Move a project between
them with File ▸ Export / Import Project Archive (`.tlcad`).

## Layout

| Path | Purpose |
|---|---|
| `packages/engine` | Pure engineering library: units, geometry, terrain, catenary and sag-tension, with calculation traces. No UI imports. |
| `packages/model` | Project schema (zod), provenance-tagged quantities, undo/redo history, feature status registry. |
| `packages/io` | Import/export format registry and the `.tlcad` project archive. |
| `apps/web` | React application: shell, project database (SQLite WASM in a worker), views. |
| `docs` | Development plan and calculation notes. |

## Conventions

- All stored values are SI (m, N, Pa, °C). Display units are converted only in the UI and file I/O.
- Every engineering value carries its source: user, imported, calculated or default.
- Every function is listed in `packages/model/src/features.ts` with its status. A function that is not
  implemented is disabled in the interface; engine code returns a typed "not implemented" result and
  never a placeholder number.
- Each edit to the project goes through `exec(label, recipe)` so it is undoable.

## Status

Phases 1 (Foundation) and 2 (Terrain and Alignment) are complete, with these parts of Phase 2
left partial and listed in Help ▸ Feature Status: LAZ-compressed point clouds, an EPSG
database and datum grid shifts, interactive break line drawing, TIN rendering options, point
filters on import, and feature code symbols.

Phase 2 covers: XYZ / PFL / delimited / DEM (ASCII grid, GeoTIFF) / LAS import; XYZ, PFL and BRK
export; feature codes with clearances by voltage; terrain point table; TIN with break lines,
contours and interpolated points; multiple alignments (branches, loops) shown as one virtual
profile; PI tools; stationing, equation stations, line angles; centerline and side profiles;
project coordinate system (WGS 84 / UTM or PROJ / WKT text), reprojection and a map view.

Phase 3 (Conductors and Structures) is complete: cable library with the nonlinear (polynomial,
creep, bimetallic) and simplified linear models and a polynomial fit from test data; structure
library with clamp / strain / suspension / post / 2-part insulators, Method 1 allowable-span
tables and height families; spotting (single, equal spacing, at line angles, at a feature code,
click to add, drag to move); structure table; stringing of tension sections with bypass and
transposition.
Library files use a TLCAD JSON format (PLS-CADD's cable and structure file formats are not
documented). No conductor or structure data are supplied with the application.

Phase 4 (Engineering Calculations) is complete: criteria dialog (weather cases with Eq. 7-1, final
after creep / after load cases, bimetallic compression mode, cable tension and automatic sagging
limits, weight-span model and conditions, insulator swing conditions, display condition); Level 1
ruling-span sag-tension by length compatibility for the nonlinear and linear cable models (the
numerical method is not given by the manual and is stated in the trace); section sagging by tension
or catenary constant, automatic sagging and graphical sagging through a picked profile point;
sagged catenaries in the plan, profile and 3D views; 3-D span reactions (App. J), wind and weight
spans, uplift, insulator swing (Eqs. 7-37, 7-38) and the Method 1 check. The Sag-Tension workspace
shows the sag-tension table, tension-limit checks, stringing chart, sag-temperature and
tension-elongation charts, structure checks and the calculation trace. Not implemented and listed
as such: code-specific wind height and gust models, GAP conductors, ice on multi-cable messengers,
the analysis levels above Level 1 (§7.2.3), interactive dragging of graphical sag, printable reports
(Phase 6).

Phase 5 (Clearance and Design Analysis) is complete: survey point clearances with the rectangular zone,
band and radial rules of §6.1.1 (wind from left and right); ground clearance line and spikes in the
profile; shortest distance from each wire span to the TIN; clearances between wires (3-D or
horizontal, conductor diameters, straight-line wires, ice jump); REA and CIGRE galloping ellipses with
distances between them; structure load trees for the NA±, BI±, NL±, NR± and GLB wind options with
LFV/LFW/LFT/LFS and structure pressures (Eqs. 7-7 to 7-14); Method 2 interaction-diagram strength;
clearance markers in the plan, profile and 3-D views and a Clearance workspace with cross-sections.
Not implemented and listed as such: the continuous wind range, isoclearance TINs, unbalanced loads, the
MAX wind option, taps, code asynchronous-wind increases, wire-to-structure clearance and danger trees.

Phase 6 (Drafting and Reporting) is complete: plan & profile sheets drawn from the live design (automatic
paging with a common structure repeated at page ends, page and area layout, scales, grids, labels, Long
Axis plan, title block with substitution codes); lines and annotation on sheets, plan and profile;
export of sheets to vector PDF, DXF R12 and SVG through built-in writers; DXF, shapefile and image
attachments (with world files) in the plan view and on sheets; reports (staking table, line summary,
sag-tension, stringing charts, spans/swing/strength, load trees, clearances, bill of material) to PDF,
Excel XML, CSV and HTML; parts, assemblies and material lists with costs; KMZ export for Google Earth.
Not implemented and listed as such: the aerial plan layout, profile elevation breaks, inset details,
interactive placing of annotation, DXF blocks and hatches, shapefile attributes, item status in the
bill of material.

Phase 7 (Integration and Testing) is complete. `apps/web/src/e2e/workflow.test.ts` runs the whole
workflow (survey import → alignment → criteria → library → spot → string → sag → checks → sheets →
reports → archive → undo/redo) on the Demo Line sample with no manual fixes; Help ▸ Open Demo Line
Sample builds the same line in the application and Help ▸ Getting Started lists the workflow.
`docs/Validation_Report.md` lists every validation case, the Demo Line results, the benchmark
(30 km, 100 000 points, 100 structures) and the limits of validation. Run the benchmark with
`TLCAD_BENCH=1 npx vitest run apps/web/src/e2e/bench.test.ts`; regenerate the sample with
`node samples/demo_line/generate.mjs`. The sample data are illustrative only.

Measured with 200 000 survey points in the browser: XYZ import 1.3 s; TIN (400 000 triangles),
contours and ground profile 1.0 s; save 2.4 s.

`samples/grid.xyz` is the GRID example of the PLS-CADD manual (§6.3). Alignment 1-8-6 on it
gives the line angle 108°26'06" and the 16-triangle TIN quoted by the manual; these are
checked by `packages/engine/test/alignment.test.ts`.

Only one browser tab can hold the project database. A second tab runs on a memory-only
database and says so.
