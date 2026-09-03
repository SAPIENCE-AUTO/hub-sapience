import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  getPreworkParticipantesCandidatos, preworkInvitarParticipantes, getPreworkParticipacionStatus,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { getGroupColor } from '@/components/table/tableUtils';
import { ParticipanteDetailDialog, type ParticipanteFila } from './ParticipanteDetailDialog';

interface Candidato {
  recruitmentRowId: string;
  participanteId?: string;
  nombre: string;
  email: string;
  boardName: string;
  grupo: string;
  grupoColorId?: string;
  yaAsignado: boolean;
  incluido: boolean;
  estadoParticipacion?: string;
}

const ESTADO_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  activo: 'default',
  pausado: 'secondary',
  completado: 'outline',
  abandono: 'destructive',
};

const groupKeyOf = (c: Pick<Candidato, 'boardName' | 'grupo'>) => `${c.boardName}::${c.grupo}`;

/**
 * Dos secciones: invitar gente nueva (a partir de los grupos de
 * Reclutamiento con grupo asignado — ver getPreworkParticipantesCandidatos.ts)
 * y, debajo, la lista de quienes ya están dentro — status, progreso, y al
 * abrir a alguien sus respuestas + follow-ups en un solo lugar (antes
 * repartido en una pestaña "Participación" aparte, sin razón real para estar
 * separada).
 */
export function PreworkParticipantesTab({ estudioId }: { estudioId?: string }) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [loadingCandidatos, setLoadingCandidatos] = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState(false);

  const [activos, setActivos] = useState<ParticipanteFila[]>([]);
  const [loadingActivos, setLoadingActivos] = useState(true);
  const [detalle, setDetalle] = useState<ParticipanteFila | null>(null);

  const loadCandidatos = async () => {
    if (!estudioId) return;
    setLoadingCandidatos(true);
    try {
      const res = await getPreworkParticipantesCandidatos({ estudioId });
      setCandidatos((res.candidatos ?? []).filter((c: Candidato) => !c.yaAsignado));
    } finally {
      setLoadingCandidatos(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadCandidatos(); }, [estudioId]);

  const loadActivos = async () => {
    if (!estudioId) return;
    setLoadingActivos(true);
    try {
      const res = await getPreworkParticipacionStatus({ estudioId });
      const nuevos: ParticipanteFila[] = res.participantes ?? [];
      setActivos(nuevos);
      if (detalle) setDetalle(nuevos.find(p => p.participanteId === detalle.participanteId) ?? null);
    } finally {
      setLoadingActivos(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadActivos(); }, [estudioId]);

  const grupos = useMemo(() => {
    const map = new Map<string, { key: string; boardName: string; grupo: string; colorId?: string; items: Candidato[] }>();
    for (const c of candidatos) {
      const key = groupKeyOf(c);
      if (!map.has(key)) map.set(key, { key, boardName: c.boardName, grupo: c.grupo, colorId: c.grupoColorId, items: [] });
      map.get(key)!.items.push(c);
    }
    return [...map.values()];
  }, [candidatos]);

  // Un proyecto puede tener varios tableros de reclutamiento (distintas
  // olas/estudios) — se agrupan los chips por tablero para no mezclar
  // grupos de nombre igual pero de tableros distintos.
  const tableros = useMemo(() => {
    const map = new Map<string, typeof grupos>();
    for (const g of grupos) {
      if (!map.has(g.boardName)) map.set(g.boardName, []);
      map.get(g.boardName)!.push(g);
    }
    return [...map.entries()].map(([boardName, grupos]) => ({ boardName, grupos }));
  }, [grupos]);

  const toggleGroupVisible = (key: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleCollapsed = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleSelected = (rowId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  const selectAllInGroup = (items: Candidato[], select: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      for (const c of items) {
        if (select) next.add(c.recruitmentRowId); else next.delete(c.recruitmentRowId);
      }
      return next;
    });
  };

  const handleInvitar = async () => {
    if (!estudioId) return;
    const seleccionados = candidatos.filter(c => selected.has(c.recruitmentRowId));
    if (!seleccionados.length) return;
    setInviting(true);
    try {
      const res = await preworkInvitarParticipantes({
        estudioId,
        participantes: seleccionados.map(c => ({ nombre: c.nombre, email: c.email, recruitmentRowId: c.recruitmentRowId })),
      });
      toast.success(`${res.invitadosNuevos} invitación(es) nueva(s), ${res.yaExistian} ya tenían cuenta en Prework`);
      if (res.fallosEnvio?.length) toast.error(`No se pudo enviar el correo a: ${res.fallosEnvio.join(', ')}`);
      setSelected(new Set());
      loadCandidatos();
      loadActivos();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo invitar');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Invitar participantes</h3>
            <p className="text-xs text-muted-foreground">
              Elige primero los grupos, luego a los participantes dentro de cada uno.
            </p>
          </div>
          <Button onClick={handleInvitar} disabled={inviting || selected.size === 0}>
            {inviting ? 'Invitando…' : `Invitar seleccionados (${selected.size})`}
          </Button>
        </div>

        {loadingCandidatos && <p className="text-sm text-muted-foreground">Cargando candidatos…</p>}

        {!loadingCandidatos && grupos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No hay participantes nuevos con grupo asignado en Reclutamiento por invitar.
          </p>
        )}

        {tableros.length > 0 && (
          <div className="space-y-2.5">
            {tableros.map(t => (
              <div key={t.boardName}>
                <p className="mb-1 text-xs font-semibold text-foreground">{t.boardName}</p>
                <div className="flex flex-wrap gap-1.5">
                  {t.grupos.map(g => {
                    const color = getGroupColor(g.colorId);
                    const active = selectedGroups.has(g.key);
                    return (
                      <button
                        key={g.key}
                        onClick={() => toggleGroupVisible(g.key)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                        style={active
                          ? { background: color, borderColor: color, color: '#fff' }
                          : { borderColor: color, color }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: active ? '#fff' : color }} />
                        {g.grupo} <span className="opacity-70">({g.items.length})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {grupos.filter(g => selectedGroups.has(g.key)).map(g => {
          const color = getGroupColor(g.colorId);
          const collapsed = collapsedGroups.has(g.key);
          const todosSeleccionados = g.items.length > 0 && g.items.every(c => selected.has(c.recruitmentRowId));
          return (
            <div key={g.key} className="rounded-md border overflow-hidden">
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                style={{ borderLeft: `4px solid ${color}`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
                onClick={() => toggleCollapsed(g.key)}
              >
                {collapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
                <span className="text-sm font-semibold" style={{ color }}>{g.grupo}</span>
                <span className="text-xs text-muted-foreground">{g.boardName} · {g.items.length}</span>
                <button
                  className="ml-auto text-xs font-medium underline-offset-2 hover:underline"
                  style={{ color }}
                  onClick={(e) => { e.stopPropagation(); selectAllInGroup(g.items, !todosSeleccionados); }}
                >
                  {todosSeleccionados ? 'Quitar selección' : 'Seleccionar todos'}
                </button>
              </div>
              {!collapsed && (
                <div className="divide-y">
                  {g.items.map(c => (
                    <div key={c.recruitmentRowId} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        checked={selected.has(c.recruitmentRowId)}
                        onCheckedChange={() => toggleSelected(c.recruitmentRowId)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.nombre}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t pt-4">
        <h3 className="text-sm font-semibold">Participantes ({activos.length})</h3>
        {loadingActivos && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {!loadingActivos && activos.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay nadie invitado.</p>}
        <div className="rounded-md border divide-y">
          {activos.map(p => (
            <button
              key={p.participanteId}
              onClick={() => setDetalle(p)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.nombre}</p>
                <p className="text-xs text-muted-foreground truncate">{p.email}</p>
              </div>
              <div className="w-28 text-right text-xs text-muted-foreground">
                {p.misionesCompletadas}/{p.misionesAsignadas} misiones
              </div>
              <div className="w-32 text-right text-[11px] text-muted-foreground">
                {p.fechaInicio ? `Día 1: ${p.fechaInicio.slice(0, 10)}` : 'sin iniciar sesión'}
              </div>
              <Badge variant={ESTADO_VARIANT[p.estadoParticipacion] ?? 'default'}>{p.estadoParticipacion}</Badge>
              {!p.incluido && <Badge variant="outline">excluido</Badge>}
            </button>
          ))}
        </div>
      </div>

      <ParticipanteDetailDialog
        participante={detalle}
        open={!!detalle}
        onClose={() => setDetalle(null)}
        estudioId={estudioId ?? ''}
        onUpdated={() => loadActivos()}
      />
    </div>
  );
}
