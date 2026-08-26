import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMisPendientes, saveMisPendiente, deleteMisPendiente } from 'zite-endpoints-sdk';
import { useProject } from '../context/ProjectContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import ComboboxCreatable from '@/components/ComboboxCreatable';
import SearchableSelect from '@/components/SearchableSelect';
import { getGroupColor, GROUP_COLORS } from '../components/table/tableUtils';
import { Plus, Trash2, Mail, PenLine, ListTodo, CalendarClock, ChevronDown, ChevronRight, FolderKanban, X } from 'lucide-react';
import { toast } from 'sonner';

interface Pendiente {
  id: string;
  titulo: string;
  notas: string | null;
  area: string;
  status: string;
  fuente: string;
  proyectoCode: string | null;
  correoAsunto: string | null;
  correoRemitente: string | null;
  fechaLimite: string | null;
  createdAt: string;
}

const DEFAULT_AREAS = ['Comercial', 'Admin', 'Proyectos', 'Postventa', 'Cobranza'];
const SIN_CLASIFICAR = 'Sin clasificar';

// Color determinístico por área (mismo hash para el mismo texto siempre) — reusa
// la paleta de colores de grupo que ya usa Reclutamiento/Calendario, para que
// "Mis Pendientes" se sienta parte de la misma app, no un feature aparte.
function areaColorId(area: string): string {
  let hash = 0;
  for (let i = 0; i < area.length; i++) hash = (hash * 31 + area.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[hash % GROUP_COLORS.length].id;
}

function isOverdue(fechaLimite: string | null): boolean {
  if (!fechaLimite) return false;
  return new Date(fechaLimite + 'T23:59:59') < new Date();
}

export default function MisPendientesPage() {
  const navigate = useNavigate();
  const { projects } = useProject();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  // Quick-add
  const [newTitulo, setNewTitulo] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newProyecto, setNewProyecto] = useState('');
  const [newFecha, setNewFecha] = useState('');
  const [adding, setAdding] = useState(false);

  // Filtros
  const [projectFilter, setProjectFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState<Set<string>>(new Set());

  const load = () => {
    getMisPendientes({}).then(res => setItems(res.items)).catch(() => toast.error('Error al cargar tus pendientes')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const knownAreas = useMemo(() => {
    const fromItems = items.map(i => i.area).filter(a => a && a !== SIN_CLASIFICAR);
    return [...new Set([...DEFAULT_AREAS, ...fromItems])];
  }, [items]);

  const projectOptions = useMemo(() => [
    { value: '', label: 'Sin proyecto' },
    ...projects.map(p => ({ value: p.projectCode ?? '', label: p.fullName || p.projectCode || '', sub: p.client ?? undefined })),
  ], [projects]);

  const projectLabel = useMemo(() => {
    const m = new Map(projects.map(p => [p.projectCode, p.fullName || p.projectCode]));
    return (code: string) => m.get(code) ?? code;
  }, [projects]);

  const projectFilterOptions = useMemo(() => [
    { value: '', label: 'Todos los proyectos' },
    ...projectOptions.slice(1).filter(o => items.some(i => i.proyectoCode === o.value)),
  ], [projectOptions, items]);

  const handleAdd = async () => {
    if (!newTitulo.trim()) return;
    setAdding(true);
    try {
      const res = await saveMisPendiente({ titulo: newTitulo.trim(), area: newArea || undefined, proyectoCode: newProyecto || undefined, fechaLimite: newFecha || undefined });
      setItems(prev => [{
        id: res.id, titulo: newTitulo.trim(), notas: null, area: newArea || SIN_CLASIFICAR, proyectoCode: newProyecto || null,
        status: 'Pendiente', fuente: 'manual', correoAsunto: null, correoRemitente: null,
        fechaLimite: newFecha || null, createdAt: new Date().toISOString(),
      }, ...prev]);
      setNewTitulo(''); setNewArea(''); setNewProyecto(''); setNewFecha('');
    } catch {
      toast.error('Error al guardar el pendiente');
    } finally {
      setAdding(false);
    }
  };

  const patch = async (item: Pendiente, changes: Partial<Pendiente>, apiPayload: Record<string, unknown>) => {
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, ...changes } : i));
    try {
      await saveMisPendiente({ id: item.id, ...apiPayload });
    } catch {
      toast.error('Error al actualizar');
      setItems(prev => prev.map(i => i.id === item.id ? item : i));
    }
  };

  const toggleStatus = (item: Pendiente) => {
    const nextStatus = item.status === 'Resuelto' ? 'Pendiente' : 'Resuelto';
    patch(item, { status: nextStatus }, { status: nextStatus });
  };
  const updateArea = (item: Pendiente, area: string) => patch(item, { area }, { area });
  const updateProyecto = (item: Pendiente, proyectoCode: string) => patch(item, { proyectoCode: proyectoCode || null }, { proyectoCode });
  const updateNotas = (item: Pendiente, notas: string) => patch(item, { notas }, { notas });

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await deleteMisPendiente({ id }); } catch { toast.error('Error al borrar'); load(); }
  };

  const toggleAreaFilter = (area: string) => setAreaFilter(prev => {
    const n = new Set(prev);
    n.has(area) ? n.delete(area) : n.add(area);
    return n;
  });

  const filtered = items.filter(i =>
    (!projectFilter || i.proyectoCode === projectFilter) &&
    (areaFilter.size === 0 || areaFilter.has(i.area))
  );
  const active = filtered.filter(i => i.status !== 'Resuelto');
  const resolved = filtered.filter(i => i.status === 'Resuelto');

  const areasInPlay = useMemo(() => {
    const set = new Set(active.map(i => i.area));
    // Áreas conocidas primero (orden estable), luego cualquier otra en uso, "Sin clasificar" al final.
    const ordered = [...knownAreas.filter(a => set.has(a)), ...[...set].filter(a => a !== SIN_CLASIFICAR && !knownAreas.includes(a))];
    if (set.has(SIN_CLASIFICAR)) ordered.push(SIN_CLASIFICAR);
    return ordered;
  }, [active, knownAreas]);

  const hasActiveFilters = !!projectFilter || areaFilter.size > 0;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ListTodo className="w-6 h-6 text-primary" /> Mis Pendientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Tu parking lot personal — lo que anotas tú, y (pronto) lo que marques en tu correo.</p>
      </div>

      {/* Quick add */}
      <div className="border border-border rounded-xl p-3 bg-card space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={newTitulo}
            onChange={e => setNewTitulo(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Agregar un pendiente..."
            className="border-0 shadow-none focus-visible:ring-0 h-9 px-0 text-sm"
          />
          <Button size="sm" onClick={handleAdd} disabled={adding || !newTitulo.trim()} className="gap-1.5 flex-shrink-0">
            <Plus className="w-4 h-4" /> Agregar
          </Button>
        </div>
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/50">
          <div className="w-36"><ComboboxCreatable value={newArea} onChange={setNewArea} options={knownAreas} placeholder="Área..." className="h-8 text-xs" /></div>
          <div className="w-56"><SearchableSelect value={newProyecto} onChange={setNewProyecto} options={projectOptions} placeholder="Sin proyecto" className="min-w-0 w-56" /></div>
          <Input type="date" value={newFecha} onChange={e => setNewFecha(e.target.value)} className="h-8 text-xs w-36" />
        </div>
      </div>

      {/* Filtros */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectFilterOptions} placeholder="Todos los proyectos" />
          {areasInPlay.map(area => {
            const on = areaFilter.has(area);
            const color = area === SIN_CLASIFICAR ? 'hsl(var(--muted-foreground))' : getGroupColor(areaColorId(area));
            return (
              <button
                key={area}
                onClick={() => toggleAreaFilter(area)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${on ? 'border-transparent text-white font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
                style={on ? { backgroundColor: color } : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: on ? '#fff' : color }} />
                {area}
              </button>
            );
          })}
          {hasActiveFilters && (
            <button onClick={() => { setProjectFilter(''); setAreaFilter(new Set()); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5">
              <X className="w-3 h-3" /> Limpiar
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ListTodo className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin pendientes por ahora.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{hasActiveFilters ? 'Nada con ese filtro.' : 'Todo resuelto — buen trabajo.'}</p>
          )}
          {areasInPlay.map(area => {
            const rows = active.filter(i => i.area === area);
            if (rows.length === 0) return null;
            const color = area === SIN_CLASIFICAR ? 'hsl(var(--muted-foreground))' : getGroupColor(areaColorId(area));
            return (
              <div key={area} className="space-y-1.5">
                <div className="flex items-center gap-2 px-1">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color }}>{area}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{rows.length}</span>
                </div>
                <div className="space-y-1.5">
                  {rows.map(item => (
                    <PendienteRow key={item.id} item={item} color={color} areas={knownAreas} projectOptions={projectOptions} projectLabel={projectLabel}
                      onToggle={() => toggleStatus(item)} onArea={a => updateArea(item, a)} onProyecto={p => updateProyecto(item, p)} onNotas={n => updateNotas(item, n)}
                      onDelete={() => handleDelete(item.id)} onOpenProject={() => item.proyectoCode && navigate(`/operacion/proyectos/${encodeURIComponent(item.proyectoCode)}`)} />
                  ))}
                </div>
              </div>
            );
          })}

          {resolved.length > 0 && (
            <div className="pt-2">
              <button onClick={() => setShowResolved(v => !v)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {showResolved ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                Resueltos ({resolved.length})
              </button>
              {showResolved && (
                <div className="space-y-1.5 mt-2">
                  {resolved.map(item => (
                    <PendienteRow key={item.id} item={item} color={item.area === SIN_CLASIFICAR ? 'hsl(var(--muted-foreground))' : getGroupColor(areaColorId(item.area))} areas={knownAreas} projectOptions={projectOptions} projectLabel={projectLabel}
                      onToggle={() => toggleStatus(item)} onArea={a => updateArea(item, a)} onProyecto={p => updateProyecto(item, p)} onNotas={n => updateNotas(item, n)}
                      onDelete={() => handleDelete(item.id)} onOpenProject={() => item.proyectoCode && navigate(`/operacion/proyectos/${encodeURIComponent(item.proyectoCode)}`)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PendienteRow({ item, color, areas, projectOptions, projectLabel, onToggle, onArea, onProyecto, onNotas, onDelete, onOpenProject }: {
  item: Pendiente; color: string; areas: string[]; projectOptions: { value: string; label: string; sub?: string }[]; projectLabel: (code: string) => string;
  onToggle: () => void; onArea: (a: string) => void; onProyecto: (p: string) => void; onNotas: (n: string) => void; onDelete: () => void; onOpenProject: () => void;
}) {
  const [notasDraft, setNotasDraft] = useState(item.notas ?? '');
  const done = item.status === 'Resuelto';
  const overdue = !done && isOverdue(item.fechaLimite);

  return (
    <div
      className={`flex items-start gap-3 rounded-lg px-3 py-2.5 bg-card border transition-opacity ${done ? 'opacity-55 border-border' : 'border-border/70'}`}
      style={done ? undefined : { borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <Checkbox checked={done} onCheckedChange={onToggle} className="mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.titulo}</span>
          {item.fuente === 'correo' && (
            <span title={item.correoRemitente ?? undefined} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full flex-shrink-0">
              <Mail className="w-2.5 h-2.5" /> correo
            </span>
          )}
        </div>
        {item.correoAsunto && <p className="text-xs text-muted-foreground truncate">📧 {item.correoAsunto}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <button className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} title="Cambiar área" />
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="start">
              <ComboboxCreatable value={item.area} onChange={onArea} options={areas} placeholder="Área..." />
            </PopoverContent>
          </Popover>

          {item.proyectoCode ? (
            <button onClick={onOpenProject} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline truncate max-w-[200px]" title="Ir al proyecto">
              <FolderKanban className="w-3 h-3 flex-shrink-0" /> {projectLabel(item.proyectoCode)}
            </button>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">+ proyecto</button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <SearchableSelect value="" onChange={onProyecto} options={projectOptions} placeholder="Vincular a proyecto..." className="w-full" />
              </PopoverContent>
            </Popover>
          )}

          {item.fechaLimite && (
            <span className={`inline-flex items-center gap-1 text-[10px] ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              <CalendarClock className="w-3 h-3" /> {item.fechaLimite}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <Popover onOpenChange={o => { if (!o && notasDraft !== (item.notas ?? '')) onNotas(notasDraft); }}>
          <PopoverTrigger asChild>
            <button className={`p-1.5 rounded hover:bg-muted transition-colors ${item.notas ? 'text-primary' : 'text-muted-foreground/50'}`} title="Notas">
              <PenLine className="w-3.5 h-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <Textarea value={notasDraft} onChange={e => setNotasDraft(e.target.value)} placeholder="Notas..." rows={3} className="text-xs" />
          </PopoverContent>
        </Popover>
        <button onClick={onDelete} className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground/50 hover:text-destructive transition-colors" title="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
