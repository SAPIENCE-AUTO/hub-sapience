import { useEffect, useState, useCallback, Fragment } from 'react';
import { getUserActivity } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { EXITO, GRIS, TEAL } from '../../lib/toolColors';

interface UserActivity {
  id: string; name: string; email: string; role?: string;
  lastActiveAt?: string; online: boolean; currentSection?: string;
  totalSeconds: number; secondsByDay: Record<string, number>;
  sections: { section: string; seconds: number }[];
}
interface ActivityData { days: string[]; users: UserActivity[] }

const RANGES = [{ days: 1, label: 'Hoy' }, { days: 7, label: '7 días' }, { days: 30, label: '30 días' }];

function fmtDuration(sec: number): string {
  if (sec < 60) return sec > 0 ? '<1 min' : '—';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

function fmtAgo(iso?: string): string {
  if (!iso) return 'Nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 2) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function dayLabel(d: string): string {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
}

function DayBars({ days, secondsByDay }: { days: string[]; secondsByDay: Record<string, number> }) {
  const max = Math.max(1, ...days.map(d => secondsByDay[d] ?? 0));
  return (
    <div className="flex items-end gap-0.5 h-8">
      {days.map(d => {
        const s = secondsByDay[d] ?? 0;
        return (
          <div key={d} title={`${dayLabel(d)}: ${fmtDuration(s)}`} className="w-2 flex flex-col justify-end h-full">
            <div className="w-full rounded-sm" style={{ height: `${Math.max(s > 0 ? 8 : 2, (s / max) * 100)}%`, backgroundColor: s > 0 ? TEAL : GRIS, opacity: s > 0 ? 1 : 0.3 }} />
          </div>
        );
      })}
    </div>
  );
}

// Panel exclusivo de Sergio (oct 2026): "ver qué hace cada usuario, cuánto
// tiempo, etc." — el gate real vive en getUserActivity.ts; que la pestaña
// solo se muestre a su correo (SettingsPage.tsx) es cosmético.
export default function ActivityTab() {
  const [range, setRange] = useState(7);
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    getUserActivity({ days: range }).then(d => { setData(d); setError(null); }).catch(e => setError(e instanceof Error ? e.message : 'No se pudo cargar'));
  }, [range]);

  useEffect(() => {
    setData(null);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!data) return <div className="p-6 space-y-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;

  const onlineCount = data.users.filter(u => u.online).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border flex-wrap">
        <div>
          <p className="text-sm font-semibold">Actividad de uso del Hub</p>
          <p className="text-xs text-muted-foreground">
            {onlineCount} en línea ahora · solo cuenta tiempo con la pestaña visible y actividad en los últimos 2 min
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          {RANGES.map((r, i) => (
            <button
              key={r.days}
              onClick={() => setRange(r.days)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${i > 0 ? 'border-l border-border' : ''} ${range === r.days ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground text-left">
            <th className="px-5 py-2">Persona</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Tiempo ({RANGES.find(r => r.days === range)?.label})</th>
            {range > 1 && <th className="px-3 py-2">Por día</th>}
            <th className="px-3 py-2">Más usado</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.users.map(u => {
            const open = expanded === u.id;
            return (
              <Fragment key={u.id}>
                <tr className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => setExpanded(open ? null : u.id)}>
                  <td className="px-5 py-2.5">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-[11px] text-muted-foreground">{u.role ?? '—'}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: u.online ? EXITO : GRIS }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                      {u.online ? 'En línea' : 'Desconectado'}
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {u.online && u.currentSection ? u.currentSection : fmtAgo(u.lastActiveAt)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 font-semibold tabular-nums">{fmtDuration(u.totalSeconds)}</td>
                  {range > 1 && <td className="px-3 py-2.5"><DayBars days={data.days} secondsByDay={u.secondsByDay} /></td>}
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {u.sections.slice(0, 3).map(s => (
                        <span key={s.section} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                          {s.section} <span className="text-muted-foreground">{fmtDuration(s.seconds)}</span>
                        </span>
                      ))}
                      {u.sections.length === 0 && <span className="text-[11px] text-muted-foreground">Sin actividad registrada</span>}
                    </div>
                  </td>
                  <td className="pr-3 text-muted-foreground">{open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                </tr>
                {open && (
                  <tr className="bg-muted/10">
                    <td colSpan={range > 1 ? 6 : 5} className="px-5 py-3">
                      {u.sections.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sin actividad en este periodo.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1">
                          {u.sections.map(s => (
                            <div key={s.section} className="flex items-center justify-between text-xs border-b border-border/50 py-1">
                              <span>{s.section}</span>
                              <span className="tabular-nums text-muted-foreground">{fmtDuration(s.seconds)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
