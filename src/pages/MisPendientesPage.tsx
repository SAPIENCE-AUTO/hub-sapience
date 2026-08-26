import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMisPendientes, saveMisPendiente, deleteMisPendiente, getPendienteCorreoBody } from 'zite-endpoints-sdk';
import { useProject } from '../context/ProjectContext';
import { useDynamicColumns } from '../hooks/useDynamicColumns';
import { DynamicColumnHeaders, DynamicColumnCells } from '../components/DynamicColumns';
import { GroupPicker } from '../components/table/GroupPicker';
import { GroupSectionHeader } from '../components/table/GroupSectionHeader';
import { getGroupColor, useResizableCol } from '../components/table/tableUtils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Mail, ListTodo, FolderKanban, ChevronsDownUp, ChevronsUpDown, X, EyeOff, Eye, Loader2, AlertCircle, NotebookPen } from 'lucide-react';
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
  correoRecibidoAt: string | null;
  fechaLimite: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLOR_FAMILIES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const cellBorder = '1px solid hsl(var(--border) / 0.3)';

function isOverdue(fechaLimite: string | null): boolean {
  if (!fechaLimite) return false;
  return new Date(fechaLimite + 'T23:59:59') < new Date();
}

export default function MisPendientesPage() {
  const navigate = useNavigate();
  const { projects } = useProject();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [hideResolved, setHideResolved] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [newTaskNames, setNewTaskNames] = useState<Record<string, string>>({});
  const [detailItem, setDetailItem] = useState<Pendiente | null>(null);

  // Filtros
  const [projectFilter, setProjectFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set()); // vacío = todos

  // Áreas = grupos reales (BoardColumns/CellValues, mismo motor que Reclutamiento/Calendario).
  // El resto de columnas (Notas, etc.) son dynamic columns reales del mismo board.
  const groupDynCols = useDynamicColumns(boardId ? `${boardId}::groups` : '', undefined, { enabled: !!boardId });
  const dynCols = useDynamicColumns(boardId, undefined, { enabled: !!boardId });

  const nameCol = useResizableCol('mis-pendientes-titulo-col', 260, 160);

  const load = (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setSyncing(true);
    getMisPendientes({})
      .then(res => {
        setItems(res.items);
        setBoardId(res.boardId);
        if (res.emailsImported > 0) toast.success(`📧 ${res.emailsImported} correo${res.emailsImported === 1 ? '' : 's'} marcado${res.emailsImported === 1 ? '' : 's'} importado${res.emailsImported === 1 ? '' : 's'} como pendiente`);
      })
      .catch(() => toast.error('Error al cargar tus pendientes'))
      .finally(() => { setLoading(false); setSyncing(false); });
  };
  useEffect(() => { load({ silent: true }); }, []);

  // Refresco automático silencioso mientras la página sigue abierta — no es
  // push real (eso necesitaría suscripciones/webhooks de Graph), pero cubre
  // el caso real de "lo flageé hace un rato, ¿ya debería estar aquí?" sin
  // que el usuario tenga que recargar o darle a "Sincronizar correo".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const interval = setInterval(() => load({ silent: true }), 150_000);
    return () => clearInterval(interval);
  }, []);

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

  // Auto-expandir áreas nuevas al crearse
  const seenGroupIds = useRef(new Set<string>(['__none__']));
  const groupColIds = groupDynCols.columns.map(c => c.id).join(',');
  useEffect(() => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      groupDynCols.columns.forEach(g => { if (!seenGroupIds.current.has(g.id)) { n.add(g.id); seenGroupIds.current.add(g.id); } });
      return n;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupColIds]);

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

  const quickCreate = async (titulo: string, groupId?: string) => {
    try {
      const res = await saveMisPendiente({ titulo });
      if (groupId) await groupDynCols.setCellVal(res.id, groupId, { textValue: '1' });
      setItems(prev => [{
        id: res.id, titulo, notas: null, status: 'Pendiente', fuente: 'manual', proyectoCode: null,
        correoAsunto: null, correoRemitente: null, correoRecibidoAt: null, fechaLimite: null,
        completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }, ...prev]);
    } catch {
      toast.error('Error al guardar el pendiente');
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
  const updateFecha = (item: Pendiente, fechaLimite: string) => patch(item, { fechaLimite: fechaLimite || null }, { fechaLimite });
  const updateNotas = (item: Pendiente, notas: string) => patch(item, { notas: notas || null }, { notas });

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
    (groupFilter.size === 0 || groupFilter.has(groupOf(i.id) ?? '__none__')) &&
    (!hideResolved || i.status !== 'Resuelto')
  );

  const groupOrder = useMemo(
    () => [{ id: '__none__', columnName: 'Sin área', columnType: undefined as string | undefined }, ...groupDynCols.columns],
    [groupDynCols.columns]
  );

  const grouped: Record<string, Pendiente[]> = { __none__: [] };
  for (const g of groupDynCols.columns) grouped[g.id] = [];
  for (const item of filtered) {
    const gid = groupOf(item.id);
    if (gid && grouped[gid]) grouped[gid].push(item);
    else grouped.__none__.push(item);
  }
  const sortRows = (rows: Pendiente[]) => [...rows].sort((a, b) =>
    (a.status === 'Resuelto' ? 1 : 0) - (b.status === 'Resuelto' ? 1 : 0) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const toggleGroupExpand = (id: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    if (!dragGroupId || dragGroupId === targetGroupId || targetGroupId === '__none__') { setDragGroupId(null); setDropTargetId(null); return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'left' : 'right';
    try { await groupDynCols.reorderColumns(dragGroupId, targetGroupId, side); } catch { toast.error('Error al reordenar'); }
    setDragGroupId(null); setDropTargetId(null);
  };

  const hasActiveFilters = !!projectFilter || groupFilter.size > 0;
  const ready = !loading && groupDynCols.hasInitiallyLoaded && dynCols.hasInitiallyLoaded;

  const sortedDynCols = [...dynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
  const totalCols = 4 + sortedDynCols.length;
  const totalWidth = 40 + nameCol.width + 190 + 130 + sortedDynCols.reduce((sum, c) => sum + dynCols.getColWidth(c.id), 0) + 60;

  const renderRow = (item: Pendiente) => {
    const done = item.status === 'Resuelto';
    const overdue = !done && isOverdue(item.fechaLimite);
    return (
      <tr key={item.id} className="group" data-row-id={item.id}>
        <td className="h-9 pl-2 group-hover:bg-muted bg-card" style={{ position: 'sticky', left: 0, zIndex: 10, borderBottom: cellBorder }}>
          <div className="flex items-center gap-1.5 h-full">
            <Checkbox checked={done} onCheckedChange={() => toggleStatus(item)} className="h-3.5 w-3.5" />
            <GroupPicker rowId={item.id} groups={groupDynCols.columns} groupDynCols={groupDynCols} />
          </div>
        </td>
        <td className="px-2 py-0 h-9 overflow-hidden group-hover:bg-muted border-r border-border/40 bg-card" style={{ position: 'sticky', left: 40, zIndex: 10, borderBottom: cellBorder }}>
          <div className="flex items-center gap-1.5 w-full h-full">
            <span className={`text-sm flex-1 truncate ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.titulo}</span>
            {item.fuente === 'correo' && (
              <span title={[item.correoAsunto, item.correoRemitente].filter(Boolean).join(' — ')} className="text-muted-foreground/50 flex-shrink-0">
                <Mail className="w-3 h-3" />
              </span>
            )}
            <button onClick={() => setDetailItem(item)} title="Ver notas / correo" className={`p-0.5 rounded hover:bg-primary/10 flex-shrink-0 transition-opacity ${item.notas ? 'text-primary opacity-100' : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100'}`}>
              <Eye className="w-3 h-3" />
            </button>
            <button onClick={() => handleDelete(item.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive p-0.5 rounded hover:bg-destructive/10 flex-shrink-0 transition-opacity">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </td>
        <td className="px-2 h-9 border-r border-border/40 group-hover:bg-muted" style={{ borderBottom: cellBorder }}>
          {item.proyectoCode ? (
            <button onClick={() => navigate(`/operacion/proyectos/${encodeURIComponent(item.proyectoCode!)}`)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-full" title="Ir al proyecto">
              <FolderKanban className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{projectLabel(item.proyectoCode)}</span>
            </button>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <button className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors">+ proyecto</button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <SearchableSelect value="" onChange={p => updateProyecto(item, p)} options={projectOptions} placeholder="Vincular a proyecto..." className="w-full" />
              </PopoverContent>
            </Popover>
          )}
        </td>
        <td className="px-2 h-9 border-r border-border/40 group-hover:bg-muted" style={{ borderBottom: cellBorder }}>
          <input
            type="date"
            value={item.fechaLimite ?? ''}
            onChange={e => updateFecha(item, e.target.value)}
            className={`bg-transparent outline-none border-0 text-xs w-full ${overdue ? 'text-destructive font-medium' : 'text-foreground'}`}
          />
        </td>
        <DynamicColumnCells rowId={item.id} dynCols={dynCols} />
      </tr>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ListTodo className="w-6 h-6 text-primary" /> Mis Pendientes</h1>
          <p className="text-sm text-muted-foreground mt-1">Tu parking lot personal — lo que anotas tú, y lo que marques en tu correo.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={syncing} className="gap-1.5 flex-shrink-0 mt-1">
          <Mail className={`w-3.5 h-3.5 ${syncing ? 'animate-pulse' : ''}`} /> {syncing ? 'Sincronizando...' : 'Sincronizar correo'}
        </Button>
      </div>

      {ready && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
            onClick={() => expandedGroups.size > 0 ? setExpandedGroups(new Set()) : setExpandedGroups(new Set(groupOrder.map(g => g.id)))}>
            {expandedGroups.size > 0 ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
            {expandedGroups.size > 0 ? 'Colapsar todos' : 'Expandir todos'}
          </Button>
          <button onClick={() => setHideResolved(v => !v)} className={`inline-flex items-center gap-1.5 text-xs h-7 px-2.5 rounded-md border transition-colors ${hideResolved ? 'border-border text-muted-foreground hover:bg-muted' : 'border-primary/40 bg-primary/10 text-primary'}`}>
            {hideResolved ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} {hideResolved ? 'Mostrar resueltos' : 'Ocultar resueltos'}
          </button>
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
          {hasActiveFilters && (
            <button onClick={() => { setProjectFilter(''); setGroupFilter(new Set()); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5">
              <X className="w-3 h-3" /> Limpiar
            </button>
          )}
        </div>
      )}

      {!ready ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded" />)}</div>
      ) : (
        <div className="bg-card border rounded-lg overflow-auto max-h-[calc(100vh-280px)]" style={{ position: 'relative' }}>
          <table style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: 40 }} />
              <col style={{ width: nameCol.width }} />
              <col style={{ width: 190 }} />
              <col style={{ width: 130 }} />
              {sortedDynCols.map(c => { const w = dynCols.getColWidth(c.id); return <col key={c.id} data-col-id={c.id} style={{ width: w, minWidth: w, maxWidth: w }} />; })}
              <col />
            </colgroup>
            <thead>
              <tr style={{ height: 33 }}>
                <th className="bg-muted border-b border-border/50" style={{ position: 'sticky', top: 0, left: 0, zIndex: 40 }} />
                <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40 relative group/nth"
                  style={{ position: 'sticky', top: 0, left: 40, zIndex: 40 }}>
                  Pendiente
                  <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/nth:opacity-100 transition-opacity z-10"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); nameCol.startResize(e.clientX); }} />
                </th>
                <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40" style={{ position: 'sticky', top: 0, zIndex: 30, width: 190 }}>Proyecto</th>
                <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40" style={{ position: 'sticky', top: 0, zIndex: 30, width: 130 }}>Fecha límite</th>
                <DynamicColumnHeaders dynCols={dynCols} sticky />
              </tr>
            </thead>
            <tbody>
              {groupOrder.map((g, idx) => {
                const rows = sortRows(grouped[g.id] ?? []);
                const isExpanded = expandedGroups.has(g.id);
                const isNone = g.id === '__none__';
                return (
                  <Fragment key={g.id}>
                    {idx > 0 && (
                      <tr aria-hidden="true"><td colSpan={totalCols} style={{ height: 10, padding: 0, border: 'none', background: 'transparent' }} /></tr>
                    )}
                    <GroupSectionHeader
                      groupId={g.id}
                      name={g.columnName ?? 'Sin área'}
                      colorId={g.columnType}
                      itemCount={rows.length}
                      isExpanded={isExpanded}
                      isNone={isNone}
                      onToggle={() => toggleGroupExpand(g.id)}
                      groupDynCols={groupDynCols}
                      colSpan={totalCols}
                      onDragStart={id => setDragGroupId(id)}
                      onDragOver={(_e, id) => setDropTargetId(id)}
                      onDragEnd={() => { setDragGroupId(null); setDropTargetId(null); }}
                      onDrop={handleGroupDrop}
                      isDragOver={dropTargetId === g.id && dragGroupId !== g.id}
                    />
                    {isExpanded && (
                      <>
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={totalCols} className="px-10 py-3 text-xs text-muted-foreground/50 italic" style={{ borderBottom: '1px solid hsl(var(--border) / 0.2)' }}>
                              {isNone ? 'Todos tus pendientes están en un área.' : 'Área vacía — agrega pendientes aquí.'}
                            </td>
                          </tr>
                        )}
                        {rows.map(item => renderRow(item))}
                        <tr>
                          <td colSpan={totalCols} className="px-10 py-2" style={{ borderBottom: '1px dashed hsl(var(--border) / 0.3)' }}>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Plus className="w-3 h-3 opacity-40 flex-shrink-0" />
                              <input
                                value={newTaskNames[g.id] ?? ''}
                                onChange={e => setNewTaskNames(p => ({ ...p, [g.id]: e.target.value }))}
                                onKeyDown={e => {
                                  const v = newTaskNames[g.id] ?? '';
                                  if (e.key === 'Enter' && v.trim()) { quickCreate(v.trim(), isNone ? undefined : g.id); setNewTaskNames(p => ({ ...p, [g.id]: '' })); }
                                  if (e.key === 'Escape') setNewTaskNames(p => ({ ...p, [g.id]: '' }));
                                }}
                                placeholder="Nuevo pendiente...  (Enter para crear)"
                                className="flex-1 bg-transparent outline-none border-0 text-sm placeholder:text-muted-foreground/40 focus:text-foreground transition-colors"
                              />
                            </div>
                          </td>
                        </tr>
                      </>
                    )}
                  </Fragment>
                );
              })}
              <tr>
                <td colSpan={totalCols} className="px-3 py-2" style={{ borderTop: '1px dashed hsl(var(--border) / 0.3)' }}>
                  <button onClick={createGroup} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-2 py-1.5 rounded-md transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Nueva área
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <PendienteDetailDialog
        item={detailItem}
        onOpenChange={open => { if (!open) setDetailItem(null); }}
        onSaveNotas={notas => { if (detailItem) updateNotas(detailItem, notas); }}
      />
    </div>
  );
}

interface CorreoBodyState {
  loading: boolean;
  available: boolean;
  errorMessage: string | null;
  bodyHtml: string | null;
}

const EMAIL_IFRAME_BASE_STYLE = `body{margin:0;padding:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;font-size:13px;line-height:1.55;color:#1a1a1a;word-wrap:break-word;} img{max-width:100%;height:auto;} a{color:#027495;} table{max-width:100%;}`;

function PendienteDetailDialog({ item, onOpenChange, onSaveNotas }: {
  item: Pendiente | null;
  onOpenChange: (open: boolean) => void;
  onSaveNotas: (notas: string) => void;
}) {
  const [notasDraft, setNotasDraft] = useState('');
  const [correo, setCorreo] = useState<CorreoBodyState | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(120);

  useEffect(() => {
    if (!item) return;
    setNotasDraft(item.notas ?? '');
    setCorreo(null);
    setIframeHeight(120);
    if (item.fuente === 'correo') {
      setCorreo({ loading: true, available: false, errorMessage: null, bodyHtml: null });
      getPendienteCorreoBody({ id: item.id })
        .then(res => setCorreo({ loading: false, available: res.available, errorMessage: res.errorMessage, bodyHtml: res.bodyHtml }))
        .catch(() => setCorreo({ loading: false, available: false, errorMessage: 'No se pudo cargar el correo.', bodyHtml: null }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  const done = item.status === 'Resuelto';
  // Fondo blanco fijo para el preview del correo — el HTML del mensaje asume
  // texto oscuro sobre blanco, sin importar el tema de la app.
  const emailSrcDoc = correo?.bodyHtml ? `<style>${EMAIL_IFRAME_BASE_STYLE}</style>${correo.bodyHtml}` : '';

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden [&_.lucide-x]:text-white/80 [&_.lucide-x]:hover:text-white">
        <DialogHeader className="flex-row items-start justify-between gap-3 space-y-0 px-6 py-4 flex-shrink-0 bg-gradient-to-br from-[#14495A] via-[#0F3D4C] to-[#0A2F3B] text-white">
          <DialogTitle className="text-base leading-snug text-left pr-2 text-white">{item.titulo}</DialogTitle>
          <span className="inline-flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap bg-white/15 text-white border border-white/25">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${done ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {done ? 'Resuelto' : 'Pendiente'}
          </span>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {item.fuente === 'correo' && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Correo original</p>
              </div>

              {(item.correoAsunto || item.correoRemitente) && (
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {item.correoAsunto && (
                    <>
                      <span className="text-muted-foreground/70">Asunto</span>
                      <span className="text-foreground font-medium truncate">{item.correoAsunto}</span>
                    </>
                  )}
                  {item.correoRemitente && (
                    <>
                      <span className="text-muted-foreground/70">De</span>
                      <span className="text-foreground truncate">{item.correoRemitente}</span>
                    </>
                  )}
                </div>
              )}

              {correo?.loading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando contenido...
                </div>
              )}
              {correo && !correo.loading && !correo.available && (
                <div className="flex items-start gap-1.5 text-xs text-muted-foreground/80 bg-muted/40 rounded-lg p-2.5 border border-border/50">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{correo.errorMessage ?? 'No se pudo cargar el contenido del correo.'}</span>
                </div>
              )}
              {correo?.available && correo.bodyHtml && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <iframe
                    ref={iframeRef}
                    srcDoc={emailSrcDoc}
                    sandbox="allow-same-origin allow-popups"
                    title="Contenido del correo"
                    style={{ width: '100%', height: iframeHeight, border: 'none', display: 'block', background: '#fff' }}
                    onLoad={() => {
                      const doc = iframeRef.current?.contentDocument;
                      if (doc) setIframeHeight(Math.min(600, doc.documentElement.scrollHeight + 24));
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <NotebookPen className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Notas</p>
            </div>
            <Textarea
              value={notasDraft}
              onChange={e => setNotasDraft(e.target.value)}
              onBlur={() => { if (notasDraft !== (item.notas ?? '')) onSaveNotas(notasDraft); }}
              placeholder="Agrega notas o contexto sobre este pendiente..."
              rows={5}
              className="text-sm resize-none"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
