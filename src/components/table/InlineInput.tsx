import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  value: string;
  onSave: (v: string) => void;
  onCancel: () => void;
  className?: string;
  suggestions?: string[];
}

export function InlineInput({ value, onSave, onCancel, className = '', suggestions }: Props) {
  const [val, setVal] = useState(value);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const filtered = (suggestions && val.trim().length > 0)
    ? suggestions.filter(s => s && s !== val && s.toLowerCase().includes(val.toLowerCase())).slice(0, 8)
    : [];
  const showDrop = filtered.length > 0;

  const getDropPos = () => {
    if (!inputRef.current) return null;
    const r = inputRef.current.getBoundingClientRect();
    return { top: r.bottom + 2, left: r.left, width: Math.max(r.width, 180) };
  };

  const selectSugg = (s: string) => {
    setActiveIdx(-1);
    onSave(s);
  };

  return (
    <>
      <input
        ref={inputRef}
        value={val}
        onChange={e => { setVal(e.target.value); setActiveIdx(-1); }}
        onBlur={() => onSave(val)}
        onKeyDown={e => {
          if (showDrop) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); return; }
            if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectSugg(filtered[activeIdx]); return; }
          }
          if (e.key === 'Enter') { e.preventDefault(); onSave(val); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        className={`bg-transparent border-0 outline-none ring-0 p-0 m-0 text-sm leading-tight w-full ${className}`}
        style={{ boxShadow: 'none' }}
      />
      {showDrop && (() => {
        const pos = getDropPos();
        if (!pos) return null;
        return createPortal(
          <div
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
            className="bg-popover border border-border shadow-lg rounded-md overflow-hidden"
          >
            <div className="max-h-[200px] overflow-y-auto py-0.5">
              {filtered.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); selectSugg(s); }}
                  className={`w-full text-left px-2.5 py-1.5 text-xs truncate transition-colors block ${
                    i === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>,
          document.body
        );
      })()}
    </>
  );
}
