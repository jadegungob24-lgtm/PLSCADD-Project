/**
 * Feature status registry.
 *
 * Every function from the feature matrix (docs/TLCAD_Development_Plan.md §2) is
 * declared here with its implementation status. The UI shows it in
 * Help ▸ Feature Status and uses it to label menu commands, so that the user can
 * always tell whether a capability is implemented, partial, planned, or blocked
 * by missing reference information.
 */

export type FeatureStatus = 'implemented' | 'partial' | 'planned' | 'gap';

export interface FeatureEntry {
  id: string;
  module: string;
  name: string;
  status: FeatureStatus;
  phase: number | null;
  /** Manual reference(s). */
  ref: string;
  note?: string;
}

export const FEATURE_STATUS_LABEL: Record<FeatureStatus, string> = {
  implemented: 'Implemented',
  partial: 'Partial',
  planned: 'Planned',
  gap: 'Awaiting reference data',
};

const f = (
  id: string,
  module: string,
  name: string,
  status: FeatureStatus,
  phase: number | null,
  ref: string,
  note?: string,
): FeatureEntry => (note === undefined ? { id, module, name, status, phase, ref } : { id, module, name, status, phase, ref, note });

export const FEATURES: FeatureEntry[] = [
  // Project management
  f('P1', 'Project', 'Create / open / save / close projects (browser SQLite database)', 'implemented', 1, '§5.1–5.3'),
  f('P1b', 'Project', 'Project archive export / import (.tlcad)', 'implemented', 1, 'App. K'),
  f('P2', 'Project', 'Unit systems (US, SI-N, SI-daN) with SI internal storage', 'implemented', 1, '§5.2, §6.2.1'),
  f('P3', 'Project', 'Revisions (named snapshots, restore)', 'implemented', 1, '—'),
  f('P4', 'Project', 'Undo / redo', 'implemented', 1, '—'),
  f('P5', 'Project', 'Import / export framework (format registry)', 'implemented', 1, 'App. D', 'Framework only; formats are added in later phases.'),
  // Terrain
  f('T1', 'Terrain', 'XYZ terrain import / export (ASCII)', 'implemented', 2, 'App. D.1', 'The binary XYZ format is not documented and is not supported.'),
  f('T2', 'Terrain', 'PFL terrain import / export', 'implemented', 2, 'App. E.1, §6.9', 'Export writes one alignment; a line angle needs a ground point or TIN elevation at the P.I.'),
  f('T3', 'Terrain', 'User-defined CSV/TXT import with field mapping', 'partial', 2, 'App. D.3', 'Column mapping, units and default code are implemented; point filters, saved import settings and latitude/longitude input are not.'),
  f('T4', 'Terrain', 'DEM (GeoTIFF / ASCII grid) import', 'implemented', 2, '—', 'Not covered by the manual; uses public formats. The file coordinate system is chosen by the user, not read from the file. Rotated rasters are not supported.'),
  f('T5', 'Terrain', 'LAS / LAZ import', 'partial', 2, 'App. D.7', 'Uncompressed LAS 1.0–1.4 with class to feature-code mapping and thinning is implemented; LAZ (compressed) is not.'),
  f('T6', 'Terrain', 'Feature codes and required clearances table', 'partial', 2, '§6.1', 'Codes, ground/aerial flags and clearances by voltage are implemented; symbols, label options and .fea files are not.'),
  f('T7', 'Terrain', 'TIN model', 'partial', 2, '§6.4', 'Delaunay TIN, edge-length limit, break lines, contour lines, surface elevation, TIN-cut profiles and interpolated points are implemented; rendering options, saving the TIN and adding a point at X,Y are not.'),
  f('T8', 'Terrain', 'Terrain point editing, filtering, deactivation', 'partial', 2, 'App. D.2–D.5', 'Table editing, add, delete and deactivate are implemented; the domain/station filters and graphical selection are not.'),
  f('T9', 'Terrain', 'Side profiles, clearance line and spikes', 'implemented', 5, '§6.10', 'Ground clearance line on the centre line and side profiles, with spikes above points (and below aerial obstacles). Wire clearance lines (§6.10.2.1) are not implemented.'),
  f('T10', 'Terrain', 'Break lines', 'partial', 2, '§6.5, App. D.6', 'BRK import/export, display and enforcement in the TIN are implemented; interactive drawing and import from DXF are not.'),
  f('T11', 'Terrain', 'DXF / SHP / raster attachments', 'partial', 6, '§6.6', 'DXF lines, polylines, circles, arcs, points and text; shapefile geometry; images placed by corner, size and rotation or a world file, in the plan view and sheets. Not implemented: DXF blocks and hatches, shapefile attributes, reprojection, GeoTIFF/ECW/JP2 images, draping on the TIN, Move/Stretch by picking.'),
  // Alignment
  f('A1', 'Alignment', 'PI add / insert / move / delete / reverse', 'implemented', 2, '§6.3.1', 'Includes delete small-angle P.I.s (by angle only) and automatic alignment through a feature code (in stored point order).'),
  f('A2', 'Alignment', 'Multiple alignments, branches, loops', 'implemented', 2, '§6.3.1.2', 'Alignments are shown as one virtual profile with a station gap. The loop ordering rule that matters for stringing is applied when stringing arrives in Phase 3.'),
  f('A3', 'Alignment', 'Stationing, offsets, line angles, centerline profile', 'implemented', 2, '§6.3.2'),
  f('A4', 'Alignment', 'Equation stations', 'implemented', 2, '§6.11'),
  f('A5', 'Alignment', 'Coordinate reference systems and reprojection', 'partial', 2, '§6.2.1', 'WGS 84 / UTM zones and user PROJ or WKT definitions, reprojection and longitude/latitude input are implemented; no EPSG database or grid-shift files.'),
  f('A6', 'Alignment', 'Map view (basemap)', 'implemented', 2, '—', 'OpenStreetMap basemap; needs a project coordinate system and an internet connection.'),
  // Cables
  f('C1', 'Conductor', 'Cable library and editor', 'implemented', 3, '§9.2', 'All mechanical fields; thermal-rating fields are not collected (thermal rating is a gap). Library files use a TLCAD JSON format: the PLS-CADD cable file format is not documented.'),
  f('C2', 'Conductor', 'Nonlinear bimetallic cable model with creep', 'implemented', 4, '§9.1, §7.3.4–7.3.5', 'Polynomials are used up to their first maximum and continued along the final modulus beyond it (stated in the trace). Final after creep and after load are computed independently from their weather cases.'),
  f('C3', 'Conductor', 'Simplified linear cable model', 'implemented', 4, 'App. G.2', 'Creep as an equivalent temperature increase; no permanent stretch after load.'),
  f('C4', 'Conductor', 'Polynomial coefficients from test data', 'implemented', 3, 'App. G.1', 'Least-squares fit of all five coefficients; the regression details are not given by the manual and are stated in the dialog.'),
  f('C6', 'Conductor', 'Bundles and GAP-type conductors', 'partial', 4, '§9.2.1–9.2.2', 'Bundles: conductors per phase multiply structure loads. GAP-type conductors and ice on multi-cable messengers are refused: the manual does not give their calculation.'),
  f('C7', 'Conductor', 'Improved linear cable model', 'gap', null, 'App. G.3', 'Defined in an external technote not in the reference set.'),
  // Structures
  f('S1', 'Structure', 'Structure library, top geometry, insulators', 'implemented', 3, '§8.2, App. F.1', 'Clamp, strain, suspension, post and 2-part insulators; parts and material lists are Phase 6.'),
  f('S2', 'Structure', '2-part (V-string) insulator geometry', 'implemented', 3, 'App. F.1.3'),
  f('S3', 'Structure', 'Method 1 strength (allowable spans)', 'implemented', 4, '§8.3.1', 'Wind and weight spans of the heaviest set against the allowable spans interpolated at the line angle; minimum weight span checked.'),
  f('S4', 'Structure', 'Method 2 strength (interaction diagrams)', 'implemented', 5, '§8.3.2, §7.3.11, App. F.1.4.2', 'Diagram polygons per angle range and interaction condition; usage measured along the ray from the origin (a stated convention: the manual gives no usage definition).'),
  f('S5', 'Structure', 'Structure families (multiple heights)', 'implemented', 3, 'App. F.1.6'),
  f('S6', 'Structure', 'Structure 2D / 3D display', 'implemented', 3, '§8.4', 'Stick figures from the top geometry, as for Method 1–3 structures; detailed models need TOWER / PLS-POLE.'),
  f('S7', 'Structure', 'Parts, assemblies, bill of material', 'partial', 6, '§8.5', 'Parts, nested assemblies, structure-file, structure-specific and line-specific material and cable lengths, with costs. Not implemented: item status (new/existing/retired/transferred), conductor-specific part rules, user columns, ODBC links.'),
  f('S8', 'Structure', 'Method 3 / Method 4 structural analysis', 'gap', null, '§8.3.3–8.3.4', 'Requires TOWER / PLS-POLE finite element analysis; load trees will be exported instead.'),
  // Spotting & wires
  f('SP1', 'Spotting', 'Manual structure spotting (add, move, snap, copy, N-paste)', 'partial', 3, '§10.2', 'Add, move (snapping to P.I.s), remove, equal spacing and the Structure Modify fields are implemented; the copy/paste buffer and Move On (snap to a survey point) are not.'),
  f('SP2', 'Spotting', 'Angle structures at PIs / feature codes', 'implemented', 3, '§10.2.1'),
  f('SP3', 'Spotting', 'Spotting constraints (prohibited, extra cost, required)', 'planned', 5, '§6.10.3'),
  f('SP4', 'Spotting', 'Optimum spotting (dynamic programming)', 'planned', 5, '§14.1'),
  f('W1', 'Wires', 'Stringing of tension sections', 'implemented', 3, '§10.3.1', 'Sets, bypass and transposition; wires are dashed straight chords until sagged, then catenaries at the display condition. Adding a structure under existing wires does not reconnect them (§10.2.4).'),
  f('W2', 'Wires', 'Sagging by tension or catenary constant', 'implemented', 4, '§10.3.2.1.1–10.3.2.1.2', 'Section properties; ruling span calculated from the set centres (Eq. I-1) or overridden.'),
  f('W3', 'Wires', 'Automatic sagging', 'implemented', 4, '§7.3.7, §10.3.2.1.3'),
  f('W4', 'Wires', 'Graphical sagging (ruling span)', 'partial', 4, '§10.3.2.1.4', 'Snap to a picked profile point at the sagging condition (bare cable). Interactive dragging and snapping to the nearest survey point are not implemented.'),
  // Engineering
  f('E1', 'Analysis', 'Weather cases and loads per unit length', 'implemented', 4, '§7.2, §7.3.2, Eqs. 7-1 to 7-6', 'The input wind applies at all heights (the None option of the manual); see E11.'),
  f('E2', 'Analysis', 'Ruling span', 'implemented', 4, 'App. I.1, Eq. I-1'),
  f('E3', 'Analysis', 'Sag-tension change of state (Initial / Creep / Load)', 'implemented', 4, '§9.1', 'Numerical solver not specified by the manual (gap G1): standard length-compatibility method (arc length = unstressed length × (1 + strain at the average tension)), labelled in the trace.'),
  f('E4', 'Analysis', 'Catenary geometry and span end reactions', 'implemented', 4, 'App. J', '3-D span reactions in the plane of the chord and the resultant load; the NESC constant K enters the geometry (§7.2.3.1).'),
  f('E5', 'Analysis', 'Wind and weight spans, uplift', 'implemented', 4, 'App. I.2–I.3', 'Exact (V / UV) or arc-length weight span; minimum vertical load per attachment.'),
  f('E6', 'Analysis', 'Insulator swing / 2-part load angle', 'implemented', 4, '§7.3.16, Eqs. 7-37, 7-38', 'Wind normal to each adjacent span, both directions; insulator wind load = pressure × insulator wind area.'),
  f('E7', 'Analysis', 'Cable tension limits check', 'implemented', 4, '§7.3.6, §7.3.8, §11.2.2'),
  f('E8', 'Analysis', 'Structure load trees', 'partial', 5, '§7.3.12, Eqs. 7-7 to 7-14', 'Wire loads at attachment points for NA±, BI±, NL±, NR± and GLB winds with LFV, LFW, LFT, LFS, and structure pressures. Not implemented: MAX wind, unbalanced loading, taps, strength factors, LCA/LIC export.'),
  f('E9', 'Analysis', 'Sag-tension reports and stringing charts', 'partial', 4, '§11.2.1, §11.2.4', 'Tables and charts in the Sag-Tension workspace; printable reports arrive with Phase 6.'),
  f('E11', 'Analysis', 'Code-specific wind height / gust factors (NESC, IEC, ASCE …)', 'gap', null, '§7.2.1', 'Defined in external document version7_loads.pdf; manual factors supported meanwhile.'),
  // Clearance
  f('CL1', 'Clearance', 'Survey point clearances (rectangular, band, radial)', 'implemented', 5, '§6.1.1, §7.3.13, §11.2.3.1', 'Wind from left and right. Not implemented: the continuous range of wind positions, concentrated loads, danger trees.'),
  f('CL2', 'Clearance', 'Clearance to TIN, isoclearance', 'partial', 5, '§11.2.3.4', 'Shortest 3-D distance from each wire span to the TIN; isoclearance TINs are not implemented.'),
  f('CL3', 'Clearance', 'Wire-to-wire clearances, crossings, ice jump', 'implemented', 5, '§7.3.14, §11.2.3.2', '3-D or horizontal, conductor diameters, straight line wire, ice jump. Code-specific asynchronous-wind increases are not implemented.'),
  f('CL4', 'Clearance', 'Galloping ellipses', 'implemented', 5, '§7.3.15, Eqs. 7-22 to 7-36, Fig. 7.3-13', 'REA single/double loop and CIGRE single/bundle with GSF and ESW override; distances between ellipses. Insulator swing and overlap areas are not included.'),
  f('CL5', 'Clearance', 'Wire-to-structure clearance, departure angles', 'planned', null, '§11.2.3.3'),
  f('CL6', 'Clearance', 'Vegetation / danger trees', 'planned', null, '§11.2.9'),
  // Drafting & reports
  f('D1', 'Drafting', 'Plan & profile sheets', 'partial', 6, '§13.1–13.2', 'Automatic paging with common-structure overlap, page/area layout, scales, grids and labels, Long Axis plan layout, title block codes. Not implemented: the aerial plan layout, profile elevation breaks, part lists in structure labels, inset plan details.'),
  f('D2', 'Drafting', 'Annotation', 'implemented', 6, '§13.3', 'Text, lines, arrows and polygons on all sheets, one sheet, the plan or the profile, edited in a table with the substitution codes. Interactive placing with the mouse is not implemented.'),
  f('D3', 'Drafting', 'Export PDF / SVG / DXF', 'implemented', 6, '§13.4', 'Vector PDF (built-in writer, Helvetica), SVG and DXF R12 with layers; raster attachments are not written to PDF or DXF.'),
  f('R1', 'Reports', 'Engineering reports to PDF / Excel', 'implemented', 6, '§12', 'Staking table, line summary, sag-tension, stringing charts, spans/swing/strength, load trees, clearances and bill of material to PDF, Excel XML, CSV and HTML.'),
  f('R2', 'Reports', 'KMZ (Google Earth) export', 'implemented', 6, 'Google Earth note', 'Alignments, structures and wires in WGS 84 from the project coordinate system; elevations written as given.'),
  // Gaps
  f('X1', 'Analysis', 'Thermal rating (IEEE 738)', 'gap', null, '§11.2.6', 'Requires IEEE Std 738 text.'),
  f('X2', 'Analysis', 'EMF calculations', 'gap', null, '§11.2.8', 'Method not documented in reference set.'),
  f('X3', 'Analysis', 'Construction offsets (Winkelman long form)', 'gap', null, '§11.2.5', 'Method referenced but not given.'),
  f('X4', 'Analysis', 'Finite element wire modelling (Levels 2–4)', 'gap', null, '§7.1.1, App. N', 'Requires SAPS; out of scope.'),
  // Views
  f('V1', 'Views', 'Plan view (pan / zoom / fit)', 'implemented', 1, '§5.4'),
  f('V2', 'Views', 'Profile view (pan / zoom / fit, aspect ratio)', 'implemented', 1, '§5.4.3'),
  f('V3', 'Views', '3D view (orbit / pan / zoom)', 'implemented', 1, '§5.4.4'),
  f('V4', 'Views', 'Sag-tension, structure, clearance workspaces', 'implemented', 5, '—', 'All workspaces have content; printable drawings and reports arrive in Phase 6.'),
  f('V5', 'Views', 'Terrain, TIN and alignment shown in Plan, Profile and 3D', 'implemented', 2, '§5.4.7'),
];

export function featureById(id: string): FeatureEntry | undefined {
  return FEATURES.find((e) => e.id === id);
}

export function featureSummary(list: FeatureEntry[] = FEATURES): Record<FeatureStatus, number> {
  const out: Record<FeatureStatus, number> = { implemented: 0, partial: 0, planned: 0, gap: 0 };
  for (const e of list) out[e.status]++;
  return out;
}
