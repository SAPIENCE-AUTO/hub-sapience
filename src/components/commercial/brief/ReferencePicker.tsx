import { useState, useEffect, useRef } from 'react';
import { GetReferenceOptionsOutputType } from 'zite-endpoints-sdk';
import { getReferenceOptionsCached } from '../../../lib/referenceOptionsCache';
import { Loader2 } from 'lucide-react';
import type { TriggerState } from './MentionWrapper';

type Member = GetReferenceOptionsOutputType['members'][0];
type Project = GetReferenceOptionsOutputType['projects'][0];

interface ResultItem {
  kind: 'user' | 'project';
  id: string;
  label: string;
  subtitle: string;
}

interface Props {
  trigger: TriggerState;
  onSelect: (token: string) => void;
  onDismiss: () => void;
}

export default function ReferencePicker({ trigger, onSelect, onDismiss }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    getReferenceOptionsCached()
      .then(d => { setMembers(d.members); setProjects(d.projects); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const results: ResultItem[] = trigger.type === 'user'
    ? members
        .filter(m => {
          const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase();
          const q = trigger.query.toLowerCase();
          return !q || name.includes(q) || (m.email ?? '').toLowerCase().includes(q);
        })
        .slice(0, 7)
        .map(m => ({
          kind: 'user',
          id: m.id,
          label: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?',
          subtitle: m.email ?? '',
        }))
    : projects
        .filter(p => {
          const q = trigger.query.toLowerCase();
          return !q || p.code.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q);
        })
        .slice(0, 7)
        .map(p => ({
          kind: 'project',
          id: p.code,
          label: p.name ?? p.code,
          subtitle: p.status ?? p.code,
        }));

  // Reset active index when results/query change
  useEffect(() => { setActiveIdx(0); }, [trigger.query, trigger.type]);

  const handleSelect = (item: ResultItem) => {
    const token = item.kind === 'user'
      ? `[[user:${item.id}|${item.label}]]`
      : `[[project:${item.id}|${item.label}]]`;
    onSelect(token);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (results[activeIdx]) handleSelect(results[activeIdx]); }
      else if (e.key === 'Escape') { e.preventDefault(); onDismiss(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [results, activeIdx, onDismiss]);

  // Position: below caret, edge-aware
  const { rect } = trigger;
  const top = rect.bottom + window.scrollY + 6;
  const left = Math.min(rect.left + window.scrollX, window.innerWidth - 264);

  return (
    <div
      style={{ top, left, width: 256 }}
      className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg overflow-hidden"
    >
      <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {trigger.type === 'user' ? (
          <><span className="text-base leading-none">👤</span> Personas</>
        ) : (
          <><span className="text-base leading-none">📁</span> Proyectos</>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-5 gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...
        </div>
      ) : results.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground/60 italic">
          {trigger.query ? `Sin resultados para "${trigger.query}"` : 'Empieza a escribir para buscar...'}
        </div>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          {results.map((item, idx) => (
            <button
              key={`${item.kind}-${item.id}`}
              onMouseDown={e => { e.preventDefault(); handleSelect(item); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                idx === activeIdx ? 'bg-primary/10' : 'hover:bg-muted'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                item.kind === 'user'
                  ? 'bg-chart-2/20 text-chart-2'
                  : 'bg-chart-4/20 text-chart-4'
              }`}>
                {item.kind === 'user' ? (item.label[0]?.toUpperCase() ?? '?') : '#'}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${idx === activeIdx ? 'text-primary' : 'text-foreground'}`}>
                  {item.label}
                </div>
                <div className="text-xs text-muted-foreground truncate">{item.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="px-3 py-1.5 border-t border-border/40 text-[10px] text-muted-foreground/40 flex items-center gap-2">
        <span>↑↓ navegar</span><span>·</span><span>Enter seleccionar</span><span>·</span><span>Esc cerrar</span>
      </div>
    </div>
  );
}
