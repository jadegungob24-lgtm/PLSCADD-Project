import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { validateProject, type Project } from '@tlcad/model';

/**
 * .tlcad project archive: a zip file containing
 *   manifest.json          format id, format version, export time, app version
 *   project.json           the project (schema-validated on import)
 *   revisions/<n>.json     optional saved revisions (label, note, createdAt, project)
 */

export const ARCHIVE_FORMAT = 'tlcad-project';
export const ARCHIVE_VERSION = 1;

export interface ArchivedRevision {
  label: string;
  note: string;
  createdAt: string;
  project: Project;
}

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  projectName: string;
  revisionCount: number;
}

export interface ArchiveContent {
  manifest: ArchiveManifest;
  project: Project;
  revisions: ArchivedRevision[];
}

export function packArchive(
  project: Project,
  revisions: ArchivedRevision[] = [],
  appVersion = '0.1.0',
  now = new Date(),
): Uint8Array {
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    appVersion,
    projectName: project.meta.name,
    revisionCount: revisions.length,
  };
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'project.json': strToU8(JSON.stringify(project)),
  };
  revisions.forEach((r, i) => {
    files[`revisions/${String(i + 1).padStart(4, '0')}.json`] = strToU8(JSON.stringify(r));
  });
  return zipSync(files, { level: 6 });
}

export type UnpackOutcome = { ok: true; content: ArchiveContent } | { ok: false; errors: string[] };

function parseJson(bytes: Uint8Array | undefined, name: string, errors: string[]): unknown {
  if (!bytes) {
    errors.push(`Archive is missing ${name}.`);
    return undefined;
  }
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    errors.push(`${name} is not valid JSON.`);
    return undefined;
  }
}

export function unpackArchive(bytes: Uint8Array): UnpackOutcome {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { ok: false, errors: ['File is not a valid .tlcad archive (cannot be unzipped).'] };
  }
  const errors: string[] = [];
  const manifest = parseJson(files['manifest.json'], 'manifest.json', errors) as ArchiveManifest | undefined;
  if (manifest && manifest.format !== ARCHIVE_FORMAT) errors.push('manifest.json: unknown archive format.');
  if (manifest && manifest.version > ARCHIVE_VERSION) {
    errors.push(`Archive version ${manifest.version} is newer than this application supports (${ARCHIVE_VERSION}).`);
  }
  const rawProject = parseJson(files['project.json'], 'project.json', errors);
  if (errors.length || !manifest) return { ok: false, errors };

  const pv = validateProject(rawProject);
  if (!pv.ok) return { ok: false, errors: pv.errors.map((e) => `project.json: ${e}`) };

  const revisions: ArchivedRevision[] = [];
  for (const name of Object.keys(files).filter((n) => n.startsWith('revisions/') && n.endsWith('.json')).sort()) {
    const raw = parseJson(files[name], name, errors) as Partial<ArchivedRevision> | undefined;
    if (!raw) continue;
    const rv = validateProject(raw.project);
    if (!rv.ok || typeof raw.label !== 'string' || typeof raw.createdAt !== 'string') {
      errors.push(`${name}: invalid revision.`);
      continue;
    }
    revisions.push({ label: raw.label, note: raw.note ?? '', createdAt: raw.createdAt, project: rv.project });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, content: { manifest, project: pv.project, revisions } };
}
