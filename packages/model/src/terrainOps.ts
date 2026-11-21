import type { FeatureCode, Project, TerrainPoint } from './project';

/** Display colours cycled for automatically created feature codes. */
const PALETTE = ['#7fd08a', '#e0a14a', '#6fb1e8', '#d98ad6', '#e8e06f', '#f08a7a', '#8ad9d0', '#b9a3f0'];

export function makeFeatureCode(code: number, description: string, onGround = true, src: FeatureCode['src'] = 'user', index = 0): FeatureCode {
  return { code, description, onGround, aerial: false, color: PALETTE[index % PALETTE.length]!, clearances: {}, src };
}

/** Generator of compact unique ids for a batch of imported items. */
export function idBatch(): () => string {
  const prefix = Math.random().toString(36).slice(2, 8);
  let n = 0;
  return () => `${prefix}${(n++).toString(36)}`;
}

/**
 * Add terrain points to a project draft. Feature codes used by the points but
 * not yet defined are created (flagged as defaults, "on ground") and reported,
 * since the manual requires every code to exist in the feature code table.
 */
export function addTerrainPoints(draft: Project, points: TerrainPoint[]): { createdCodes: number[] } {
  const known = new Set(draft.terrain.featureCodes.map((f) => f.code));
  const created: number[] = [];
  for (const p of points) {
    if (!known.has(p.code)) {
      known.add(p.code);
      created.push(p.code);
      draft.terrain.featureCodes.push(
        makeFeatureCode(p.code, `Code ${p.code} (created on import)`, true, 'default', draft.terrain.featureCodes.length),
      );
    }
    draft.terrain.points.push(p);
  }
  draft.terrain.featureCodes.sort((a, b) => a.code - b.code);
  return { createdCodes: created };
}

/** Feature codes that would be created by importing points with these codes. */
export function missingCodes(project: Project, codes: Iterable<number>): number[] {
  const known = new Set(project.terrain.featureCodes.map((f) => f.code));
  return [...new Set(codes)].filter((c) => !known.has(c)).sort((a, b) => a - b);
}
