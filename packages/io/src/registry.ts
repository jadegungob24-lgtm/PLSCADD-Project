import type { Project } from '@tlcad/model';

/**
 * Import / export framework.
 *
 * A format handler declares what it reads or writes and which part of the
 * project it affects. Handlers are pure: an importer returns a recipe that the
 * application applies to the project as one undoable command, plus messages
 * for the log. Formats (XYZ, PFL, CSV, DEM, DXF, …) are registered by the
 * phases that implement them.
 */

export type DataKind = 'project' | 'terrain' | 'alignment' | 'structures' | 'cables' | 'criteria' | 'drawing' | 'report';

export interface ImportMessage {
  level: 'info' | 'warning' | 'error';
  text: string;
}

export interface ImportResult {
  /** Short description used as the undo label, e.g. "Import 1 254 terrain points". */
  label: string;
  /** Mutates a draft of the project. Absent when the import failed. */
  apply?: (draft: Project) => void;
  messages: ImportMessage[];
}

export interface ExportResult {
  fileName: string;
  mimeType: string;
  data: Uint8Array | string;
  messages: ImportMessage[];
}

export interface FormatHandler {
  id: string;
  name: string;
  kind: DataKind;
  /** Lower-case extensions without the dot. */
  extensions: string[];
  /** Manual or standard reference for the format. */
  ref?: string;
  import?: (data: Uint8Array, fileName: string, project: Project) => ImportResult | Promise<ImportResult>;
  export?: (project: Project) => ExportResult | Promise<ExportResult>;
}

export class FormatRegistry {
  private handlers = new Map<string, FormatHandler>();

  register(h: FormatHandler): void {
    if (this.handlers.has(h.id)) throw new Error(`Format "${h.id}" is already registered.`);
    this.handlers.set(h.id, h);
  }

  get(id: string): FormatHandler | undefined {
    return this.handlers.get(id);
  }

  all(): FormatHandler[] {
    return [...this.handlers.values()];
  }

  importers(kind?: DataKind): FormatHandler[] {
    return this.all().filter((h) => h.import && (!kind || h.kind === kind));
  }

  exporters(kind?: DataKind): FormatHandler[] {
    return this.all().filter((h) => h.export && (!kind || h.kind === kind));
  }

  /** Importers able to read a file, by extension. */
  importersFor(fileName: string): FormatHandler[] {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    return this.importers().filter((h) => h.extensions.includes(ext));
  }

  /** Value for an <input type="file" accept="…"> attribute. */
  acceptString(kind?: DataKind): string {
    const exts = new Set(this.importers(kind).flatMap((h) => h.extensions));
    return [...exts].map((e) => `.${e}`).join(',');
  }
}
