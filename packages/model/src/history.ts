import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';

enablePatches();

/**
 * Undo/redo history based on immer patches. Each command records forward and
 * inverse patches, so undo/redo is exact and memory-light even for large
 * terrain models (only changed paths are stored).
 */

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  at: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  limit: number;
}

export function emptyHistory(limit = 200): History {
  return { past: [], future: [], limit };
}

export interface ExecuteResult<T> {
  state: T;
  history: History;
  changed: boolean;
}

/** Apply an editing recipe as one undoable command. */
export function execute<T>(
  state: T,
  history: History,
  label: string,
  recipe: (draft: Draft<T>) => void,
): ExecuteResult<T> {
  const [next, patches, inverse] = produceWithPatches(state, recipe);
  if (patches.length === 0) return { state, history, changed: false };
  const past = [...history.past, { label, patches, inverse, at: Date.now() }];
  if (past.length > history.limit) past.splice(0, past.length - history.limit);
  return { state: next as T, history: { ...history, past, future: [] }, changed: true };
}

export function undo<T>(state: T, history: History): ExecuteResult<T> {
  const entry = history.past[history.past.length - 1];
  if (!entry) return { state, history, changed: false };
  return {
    state: applyPatches(state as object, entry.inverse) as T,
    history: { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] },
    changed: true,
  };
}

export function redo<T>(state: T, history: History): ExecuteResult<T> {
  const entry = history.future[0];
  if (!entry) return { state, history, changed: false };
  return {
    state: applyPatches(state as object, entry.patches) as T,
    history: { ...history, past: [...history.past, entry], future: history.future.slice(1) },
    changed: true,
  };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;
export const undoLabel = (h: History) => h.past[h.past.length - 1]?.label;
export const redoLabel = (h: History) => h.future[0]?.label;
