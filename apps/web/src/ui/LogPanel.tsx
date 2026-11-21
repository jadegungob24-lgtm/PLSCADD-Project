import { useEffect, useRef, useState } from 'react';
import { useApp, type LogLevel } from '../store/appStore';

type Tab = 'all' | LogLevel;
const LEVEL_TEXT: Record<LogLevel, string> = { info: 'INFO', result: 'RESULT', warning: 'WARNING', error: 'ERROR' };

export function LogPanel() {
  const log = useApp((s) => s.log);
  const clearLog = useApp((s) => s.clearLog);
  const [tab, setTab] = useState<Tab>('all');
  const end = useRef<HTMLDivElement>(null);
  const rows = tab === 'all' ? log : log.filter((e) => e.level === tab);
  const count = (l: LogLevel) => log.filter((e) => e.level === l).length;

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [rows.length]);

  const tabs: [Tab, string][] = [
    ['all', 'Log'],
    ['result', `Results (${count('result')})`],
    ['warning', `Warnings (${count('warning')})`],
    ['error', `Errors (${count('error')})`],
  ];

  return (
    <>
      <div className="log-tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={`log-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button className="log-tab" onClick={clearLog} title="Clear the log">Clear</button>
      </div>
      <div className="log-list">
        {rows.map((e) => (
          <div key={e.id} className={`log-row ${e.level}`}>
            <span className="t">{e.time}</span>
            <span className="lv">{LEVEL_TEXT[e.level]}</span>
            <span>{e.text}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </>
  );
}
