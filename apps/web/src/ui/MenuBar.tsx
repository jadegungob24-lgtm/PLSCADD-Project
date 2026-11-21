import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { buildMenus, plannedTag, type MenuItem } from '../commands/menus';

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Re-render when state that affects labels / enabled flags changes.
  useApp((s) => s.project);
  useApp((s) => s.history);
  useApp((s) => s.tile);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const menus = buildMenus();
  const click = (item: MenuItem) => { setOpen(null); item.run?.(); };

  return (
    <div className="menubar" ref={ref}>
      <div className="brand">TLCAD</div>
      {menus.map((m, i) => (
        <div className="menu-root" key={m.label}>
          <button
            className={`menu-btn ${open === i ? 'open' : ''}`}
            onMouseDown={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => { if (open !== null) setOpen(i); }}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="menu-pop" role="menu">
              {m.items.map((it, j) => {
                if (it === 'separator') return <div className="menu-sep" key={j} />;
                const tag = plannedTag(it);
                const disabled = tag !== null || !it.run || (it.enabled ? !it.enabled() : false);
                return (
                  <button
                    className="menu-item" role="menuitem" key={j} disabled={disabled}
                    title={tag ? 'Not implemented yet — see Help ▸ Feature Status' : undefined}
                    onClick={() => click(it)}
                  >
                    {it.checked?.() && <span className="check">✓</span>}
                    <span className="grow">{it.label}</span>
                    {tag && <span className="tag">{tag}</span>}
                    {it.shortcut && <span className="hint">{it.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
