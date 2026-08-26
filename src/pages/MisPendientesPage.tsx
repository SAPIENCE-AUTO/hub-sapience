import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMisPendientes, saveMisPendiente, deleteMisPendiente } from 'zite-endpoints-sdk';
import { useProject } from '../context/ProjectContext';
import { useDynamicColumns } from '../hooks/useDynamicColumns';
import { GroupPicker } from '../components/table/GroupPicker';
import { GroupSectionHeader } from '../components/table/GroupSectionHeader';
import { getGroupColor } from '../components/table/tableUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Mail, PenLine, ListTodo, CalendarClock, FolderKanban, X } from 'lucide-react';
import { toast } from 'sonner';

interface Pendiente {
  id: string;
  titulo: string;
  notas: string | null;
  status: string;
  fuente: string;
  proyectoCode: string | null;
  correoAsunto: string | null;
  correoRemitente: string | null;
  fechaLimite: string | null;
  createdAt: string;
}

const COLOR_FAMILIES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [groupBoardId, setGroupBoardId] = useState('');

  // Grupos = "áreas" — mismo motor de grupos que ya usan Reclutamiento/Calendario
  // (BoardColumns + CellValues). getBoardColumns.ts solo resuelve boardIds que
  // sean o un prefijo legacy reconocido o el UUID real de una fila en Boards —
  // un string inventado cae en "formato desconocido" y siempre devuelve vacío.
  // Por eso groupBoardId viene del backend (getMisPendientes crea/reusa una
  // fila real en Boards por usuario), no se construye aquí.
  const groupDynCols = useDynamicColumns(groupBoardId ? `${groupBoardId}::groups` : '', undefined, { enabled: !!groupBoardId });

  // Quick-add
  const [newTitulo, setNewTitulo] = useState('');
  const [newGroupId, setNewGroupId] = useState<string | null>(null);
  const [newProyecto, setNewProyecto] = useState('');
  const [newFecha, setNewFecha] = useState('');
  const [adding, setAdding] = useState(false);

  // Filtros
  const [projectFilter, setProjectFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set()); // vacío = todos

  const load = () => {
    getMisPendientes({}).then(res => { setItems(res.items); setGroupBoardId(res.groupBoardId); }).catch(() => toast.error('Error al cargar tus pendientes')).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

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

  const createGroup = async () => {
    const n = groupDynCols.columns.length;
    const family = COLOR_FAMILIES[n % COLOR_FAMILIES.length];
    const shade = Math.floor(n / COLOR_FAMILIES.length) % 5 + 1;
    try {
      await groupDynCols.addColumn(`Área ${n + 1}`, `${family}-${shade}`);
    } catch {
      toast.error('Error al crear el área');
    }
  };

  const handleAdd = async () => {
    if (!newTitulo.trim()) return;
    setAdding(true);
    try {
      const res = await saveMisPendiente({ titulo: newTitulo.trim(), proyectoCode: newProyecto || undefined, fechaLimite: newFecha || undefined });
      if (newGroupId) await groupDynCols.setCellVal(res.id, newGroupId, { textValue: '1' });
      setItems(prev => [{
        id: res.id, titulo: newTitulo.trim(), notas: null, proyectoCode: newProyecto || null,
        status: 'Pendiente', fuente: 'manual', correoAsunto: null, correoRemitente: null,
        fechaLimite: newFecha || null, createdAt: new Date().toISOString(),
      }, ...prev]);
      setNewTitulo(''); setNewGroupId(null); setNewProyecto(''); setNewFecha('');
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
  const updateProyecto = (item: Pendiente, proyectoCode: string) => patch(item, { proyectoCode: proyectoCode || null }, { proyectoCode });
  const updateNotas = (item: Pendiente, notas: string) => patch(item, { notas }, { notas });

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await deleteMisPendiente({ id }); } catch { toast.error('Error al borrar'); load(); }
  };

  const toggleGroupFilter = (groupId: string) => setGroupFilter(prev => {
    const n = new Set(prev);
    n.has(groupId) ? n.delete(groupId) : n.add(groupId);
    return n;
  });

  const groupOf = (rowId: string): string | null =>
    groupDynCols.columns.find(g => groupDynCols.getCellVal(rowId, g.id)?.textValue === '1')?.id ?? null;

  const filtered = items.filter(i =>
    (!projectFilter || i.proyectoCode === projectFilter) &&
    (groupFilter.size === 0 || groupFilter.has(groupOf(i.id) ?? '__none__'))
  );
  const active = filtered.filter(i => i.status !== 'Resuelto');
  const resolved = filtered.filter(i => i.status === 'Resuelto');

  const sections = useMemo(() => {
    const byGroup = new Map<string, Pendiente[]>();
    for (const g of groupDynCols.columns) byGroup.set(g.id, []);
    const none: Pendiente[] = [];
    for (const row of active) {
      const gid = groupOf(row.id);
      if (gid && byGroup.has(gid)) byGroup.get(gid)!.push(row);
      else none.push(row);
    }
    const result = groupDynCols.columns.map(g => ({ id: g.id, name: g.columnName ?? 'Sin nombre', colorId: g.columnType, rows: byGroup.get(g.id) ?? [], isNone: false }));
    if (none.length > 0 || result.length === 0) result.push({ id: '__none__', name: 'Sin área', colorId: undefined, rows: none, isNone: true });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, groupDynCols.columns, groupDynCols.getCellVal]);

  const handleDrop = (targetId: string) => {
    if (dragGroupId && dragGroupId !== targetId && targetId !== '__none__') {
      groupDynCols.reorderColumns(dragGroupId, targetId, 'left').catch(() => toast.error('Error al reordenar'));
    }
    setDragGroupId(null); setDragOverId(null);
  };

  const hasActiveFilters = !!projectFilter || groupFilter.size > 0;
  const ready = !loading && groupDynCols.hasInitiallyLoaded;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ListTodo className="w-6 h-6 text-primary" /> Mis Pendientes</h1>
        <p className="text-sm text-muted-foreground mt-1">Tu parking lot personal — lo que anotas tú, y lo que marques en tu correo.</p>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1.5 text-xs h-8 px-2.5 rounded-md border border-border hover:bg-muted transition-colors">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-dashed border-muted-foreground/40" style={newGroupId ? { backgroundColor: getGroupColor(groupDynCols.columns.find(g => g.id === newGroupId)?.columnType), border: 'none' } : undefined} />
                {newGroupId ? groupDynCols.columns.find(g => g.id === newGroupId)?.columnName : 'Sin área'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 p-1">
              <DropdownMenuItem onClick={() => setNewGroupId(null)} className="text-xs gap-2">
                <div className="w-3 h-3 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" /> Sin área
              </DropdownMenuItem>
              {groupDynCols.columns.length > 0 && <div className="my-1 border-t border-border/30" />}
              {groupDynCols.columns.map(g => (
                <DropdownMenuItem key={g.id} onClick={() => setNewGroupId(g.id)} className="text-xs gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getGroupColor(g.columnType) }} />
                  <span className="truncate">{g.columnName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="w-56"><SearchableSelect value={newProyecto} onChange={setNewProyecto} options={projectOptions} placeholder="Sin proyecto" className="min-w-0 w-56" /></div>
          <Input type="date" value={newFecha} onChange={e => setNewFecha(e.target.value)} className="h-8 text-xs w-36" />
        </div>
      </div>

      {/* Filtros + gestión de áreas */}
      {ready && (
        <div className="flex items-center gap-2 flex-wrap">
          <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectFilterOptions} placeholder="Todos los proyectos" />
          {groupDynCols.columns.map(g => {
            const on = groupFilter.has(g.id);
            const color = getGroupColor(g.columnType);
            return (
              <button
                key={g.id}
                onClick={() => toggleGroupFilter(g.id)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${on ? 'border-transparent text-white font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
                style={on ? { backgroundColor: color } : undefined}
              >
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: on ? '#fff' : color }} />
                {g.columnName}
              </button>
            );
          })}
          <button onClick={createGroup} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-full px-2.5 py-1 transition-colors">
            <Plus className="w-3 h-3" /> Área
          </button>
          {hasActiveFilters && (
            <button onClick={() => { setProjectFilter(''); setGroupFilter(new Set()); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5">
              <X className="w-3 h-3" /> Limpiar
            </button>
          )}
        </div>
      )}

      {!ready ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ListTodo className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin pendientes por ahora.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{hasActiveFilters ? 'Nada con ese filtro.' : 'Todo resuelto — buen trabajo.'}</p>
          )}
          {sections.map(section => {
            if (section.rows.length === 0) return null;
            const isExpanded = !collapsed.has(section.id);
            return (
              <div key={section.id} className="rounded-lg border border-border/60 overflow-hidden">
                <GroupSectionHeader
                  groupId={section.id}
                  name={section.name}
                  colorId={section.colorId}
                  itemCount={section.rows.length}
                  isExpanded={isExpanded}
                  isNone={section.isNone}
                  onToggle={() => setCollapsed(prev => { const n = new Set(prev); isExpanded ? n.add(section.id) : n.delete(section.id); return n; })}
                  groupDynCols={groupDynCols}
                  onDragStart={id => setDragGroupId(id)}
                  onDragOver={(_e, id) => setDragOverId(id)}
                  onDragEnd={() => { setDragGroupId(null); setDragOverId(null); }}
                  onDrop={(_e, id) => handleDrop(id)}
                  isDragOver={dragOverId === section.id}
                />
                {isExpanded && (
                  <div className="p-1.5 space-y-1.5 bg-background">
                    {section.rows.map(item => (
                      <PendienteRow key={item.id} item={item} groups={groupDynCols.columns} groupDynCols={groupDynCols} projectOptions={projectOptions} projectLabel={projectLabel}
                        onToggle={() => toggleStatus(item)} onProyecto={p => updateProyecto(item, p)} onNotas={n => updateNotas(item, n)}
                        onDelete={() => handleDelete(item.id)} onOpenProject={() => item.proyectoCode && navigate(`/operacion/proyectos/${encodeURIComponent(item.proyectoCode)}`)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {resolved.length > 0 && (
            <div className="pt-2">
              <button onClick={() => setShowResolved(v => !v)} className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                {showResolved ? '▾' : '▸'} Resueltos ({resolved.length})
              </button>
              {showResolved && (
                <div className="space-y-1.5 mt-2">
                  {resolved.map(item => (
                    <PendienteRow key={item.id} item={item} groups={groupDynCols.columns} groupDynCols={groupDynCols} projectOptions={projectOptions} projectLabel={projectLabel}
                      onToggle={() => toggleStatus(item)} onProyecto={p => updateProyecto(item, p)} onNotas={n => updateNotas(item, n)}
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

function PendienteRow({ item, groups, groupDynCols, projectOptions, projectLabel, onToggle, onProyecto, onNotas, onDelete, onOpenProject }: {
  item: Pendiente; groups: ReturnType<typeof useDynamicColumns>['columns']; groupDynCols: ReturnType<typeof useDynamicColumns>;
  projectOptions: { value: string; label: string; sub?: string }[]; projectLabel: (code: string) => string;
  onToggle: () => void; onProyecto: (p: string) => void; onNotas: (n: string) => void; onDelete: () => void; onOpenProject: () => void;
}) {
  const [notasDraft, setNotasDraft] = useState(item.notas ?? '');
  const done = item.status === 'Resuelto';
  const overdue = !done && isOverdue(item.fechaLimite);

  return (
    <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 bg-card border border-border/70 transition-opacity ${done ? 'opacity-55' : ''}`}>
      <Checkbox checked={done} onCheckedChange={onToggle} className="mt-0.5 flex-shrink-0" />
      <div className="mt-0.5"><GroupPicker rowId={item.id} groups={groups} groupDynCols={groupDynCols} /></div>

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
