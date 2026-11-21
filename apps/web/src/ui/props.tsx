import { useEffect, useState } from 'react';
import { fromSI, toSI, unitLabel, type Dimension, type UnitSystem } from '@tlcad/engine';
import { SOURCE_LABEL, type Source } from '@tlcad/model';

/** Property-grid primitives shared by the Properties panel and dialogs. */

export const SrcTag = ({ src }: { src: Source }) => (
  <span className={`src ${src}`} title={SOURCE_LABEL[src]}>{src[0]!.toUpperCase()}</span>
);

/** Text input that commits on blur or Enter and reverts on Escape. */
export function TextProp(p: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; required?: boolean }) {
  const [draft, setDraft] = useState(p.value);
  useEffect(() => setDraft(p.value), [p.value]);
  const invalid = p.required && draft.trim() === '';
  const commit = () => {
    if (invalid) { setDraft(p.value); return; }
    if (draft !== p.value) p.onCommit(draft);
  };
  const common = {
    value: draft,
    className: invalid ? 'invalid' : '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') { setDraft(p.value); (e.target as HTMLElement).blur(); }
      if (e.key === 'Enter' && !p.multiline) (e.target as HTMLElement).blur();
    },
  };
  return (
    <div className="prop">
      <label title={p.label}>{p.label}</label>
      {p.multiline ? <textarea {...common} /> : <input {...common} />}
      <SrcTag src="user" />
    </div>
  );
}

/** Numeric input; empty means "not set" when `nullable`. Rejects values failing `check`. */
export function NumProp(p: {
  label: string; value: number | null; unit?: string; src: Source; nullable?: boolean;
  check?: (v: number) => string | null; onCommit: (v: number | null) => void;
}) {
  const show = (v: number | null) => (v === null ? '' : String(v));
  const [draft, setDraft] = useState(show(p.value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(show(p.value)); setError(null); }, [p.value]);

  const commit = () => {
    const t = draft.trim();
    if (t === '') {
      if (p.nullable) { if (p.value !== null) p.onCommit(null); setError(null); }
      else { setDraft(show(p.value)); setError(null); }
      return;
    }
    const v = Number(t);
    const msg = !Number.isFinite(v) ? 'Enter a number.' : p.check?.(v) ?? null;
    if (msg) { setError(msg); return; }
    setError(null);
    if (v !== p.value) p.onCommit(v);
  };

  return (
    <div className="prop">
      <label title={p.label}>{p.label}{p.unit ? ` (${p.unit})` : ''}</label>
      <input
        className={`num ${error ? 'invalid' : ''}`} value={draft} title={error ?? ''} inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLElement).blur();
          if (e.key === 'Escape') { setDraft(show(p.value)); setError(null); }
        }}
      />
      <SrcTag src={p.src} />
    </div>
  );
}

/** Rounds a converted display value so that unit conversion noise is not shown (e.g. 49.99999 ft). */
export const tidy = (v: number, decimals = 4) => Number(v.toFixed(decimals));

/** Numeric property stored in SI and edited in the project's display unit. */
export function QuantityProp(p: {
  label: string; valueSI: number | null; sys: UnitSystem; dim: Dimension; src?: Source; nullable?: boolean;
  check?: (vSI: number) => string | null; onCommit: (vSI: number | null) => void;
}) {
  return (
    <NumProp
      label={p.label} unit={unitLabel(p.sys, p.dim)} src={p.src ?? 'user'} nullable={p.nullable}
      value={p.valueSI === null ? null : tidy(fromSI(p.valueSI, p.sys, p.dim))}
      check={(v) => p.check?.(toSI(v, p.sys, p.dim)) ?? null}
      onCommit={(v) => p.onCommit(v === null ? null : toSI(v, p.sys, p.dim))}
    />
  );
}

export function SelectProp<T extends string>(p: { label: string; value: T; options: [T, string][]; onCommit: (v: T) => void }) {
  return (
    <div className="prop">
      <label title={p.label}>{p.label}</label>
      <select value={p.value} onChange={(e) => p.onCommit(e.target.value as T)}>
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <SrcTag src="user" />
    </div>
  );
}

export const ReadOnly = ({ label, value, src }: { label: string; value: string; src?: Source }) => (
  <div className="prop"><label title={label}>{label}</label><div className="ro" title={value}>{value}</div>{src ? <SrcTag src={src} /> : <span />}</div>
);

export const Legend = () => (
  <div className="legend">
    {(['user', 'imported', 'calculated', 'default'] as Source[]).map((s) => (
      <span key={s}><SrcTag src={s} />{SOURCE_LABEL[s]}</span>
    ))}
  </div>
);
