import { useState, useEffect, useRef } from 'react';
import { GetReferenceOptionsOutputType } from 'zite-endpoints-sdk';
import { getReferenceOptionsCached } from '../../../lib/referenceOptionsCache';
import { Loader2 } from 'lucide-react';
import type { TriggerState, RefInline } from './docTypes';

type Member = GetReferenceOptionsOutputType['members'][0];
type Project = GetReferenceOptionsOutputType['projects'][0];
type EventItem = GetReferenceOptionsOutputType['events'][0];
type GroupItem = GetReferenceOptionsOutputType['groups'][0];
type Item = { kind: 'user' | 'project' | 'event' | 'group'; id: string; label: string; subtitle: string };

const TYPE_META: Record<string, { icon: string; label: string }> = {
  user:    { icon: '👤', label: 'Personas' },
  project: { icon: '📁', label: 'Proyectos' },
  event:   { icon: '📅', label: 'Eventos' },
  group:   { icon: '👥', label: 'Grupos' },
};

const AVATAR_COLORS: Record<string, string> = {
  user:    'bg-chart-1/20 text-chart-1',
  project: 'bg-chart-2/20 text-chart-2',
  event:   'bg-chart-4/20 text-chart-4',
  group:   'bg-chart-5/20 text-chart-5',
};

interface Props {
  trigger: TriggerState | null;
  onSelect: (ref: RefInline) => void;
  onDismiss: () => void;
}

export default function EntityMentionMenu({ trigger, onSelect, onDismiss }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const loaded = useRef(false);
  const onDismissRef = useRef(onDismiss);
  const itemsRef = useRef<Item[]>([]);
  const activeIdxRef = useRef(0);

  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (!trigger || loaded.current) return;
    loaded.current = true;
    setLoading(true);
    getReferenceOptionsCached()
      .then(d => { setMembers(d.members); setProjects(d.projects); setEvents(d.events); setGroups(d.groups); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [trigger]);

  useEffect(() => { setActiveIdx(0); }, [trigger?.type, trigger?.query]);

  useEffect(() => {
    if (!trigger) return;
    const handler = (e: KeyboardEvent) => {
      const its = itemsRef.current;
      const ai = activeIdxRef.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setActiveIdx(Math.min(ai + 1, its.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setActiveIdx(Math.max(ai - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (its[ai]) onSelect({ type: 'ref', refType: its[ai].kind, refId: its[ai].id, label: its[ai].label }); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onDismissRef.current(); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [trigger, onSelect]);

  if (!trigger) return null;

  const q = trigger.query.toLowerCase();

  const items: Item[] = (() => {
    switch (trigger.type) {
      case 'user':
        return members
          .filter(m => { const n = `${m.firstName ?? ''} ${m.lastName ?? ''}`.toLowerCase(); return !q || n.includes(q) || (m.email ?? '').toLowerCase().includes(q); })
          .slice(0, 7)
          .map(m => ({ kind: 'user' as const, id: m.id, label: `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.email || '?', subtitle: m.email ?? '' }));
      case 'project':
        return projects
          .filter(p => !q || p.code.toLowerCase().includes(q) || (p.name ?? '').toLowerCase().includes(q))
          .slice(0, 7)
          .map(p => ({ kind: 'project' as const, id: p.code, label: p.name ?? p.code, subtitle: p.code }));
      case 'event':
        return events
          .filter(e => !q || e.name.toLowerCase().includes(q) || (e.projectCode ?? '').toLowerCase().includes(q))
          .slice(0, 7)
          .map(e => ({ kind: 'event' as const, id: e.id, label: e.name, subtitle: e.date ? new Date(e.date).toLocaleDateString() : (e.projectCode ?? '') }));
      case 'group':
        return groups
          .filter(g => !q || g.name.toLowerCase().includes(q) || (g.projectCode ?? '').toLowerCase().includes(q))
          .slice(0, 7)
          .map(g => ({ kind: 'group' as const, id: g.name, label: g.name, subtitle: g.projectCode ?? '' }));
      default:
        return [];
    }
  })();

  itemsRef.current = items;
  activeIdxRef.current = activeIdx;

  const meta = TYPE_META[trigger.type] ?? TYPE_META.user;
  const avatarColor = AVATAR_COLORS[trigger.type] ?? AVATAR_COLORS.user;

  const top = trigger.rect.bottom + window.scrollY + 6;
  const left = Math.min(trigger.rect.left + window.scrollX, window.innerWidth - 264);

  return (
    <div style={{ top, left, width: 256 }} className="fixed z-[9999] bg-card border border-border rounded-xl shadow-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        <span className="text-base leading-none">{meta.icon}</span> {meta.label}
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-5 gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...</div>
      ) : items.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground/60 italic">{q ? `Sin resultados para "${q}"` : 'Empieza a escribir...'}</div>
      ) : (
        <div className="max-h-56 overflow-y-auto">
          {items.map((item, idx) => (
            <button key={`${item.kind}-${item.id}`} onMouseDown={e => { e.preventDefault(); onSelect({ type: 'ref', refType: item.kind, refId: item.id, label: item.label }); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${idx === activeIdx ? 'bg-primary/10' : 'hover:bg-muted'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${avatarColor}`}>
                {item.kind === 'user' ? (item.label[0]?.toUpperCase() ?? '?') : item.kind === 'project' ? '#' : item.kind === 'event' ? '!' : '/'}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${idx === activeIdx ? 'text-primary' : 'text-foreground'}`}>{item.label}</div>
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
