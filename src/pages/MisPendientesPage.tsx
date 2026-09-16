import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { getMisPendientes, saveMisPendiente, deleteMisPendiente, getPendienteCorreoBody, ensurePendienteNotasBlock, reorderMisPendientes } from 'zite-endpoints-sdk';
import { useProject } from '../context/ProjectContext';
import { useDynamicColumns, type DynCellValue } from '../hooks/useDynamicColumns';
import { DynamicColumnHeaders, DynamicColumnCells } from '../components/DynamicColumns';
import { GroupPicker } from '../components/table/GroupPicker';
import { GroupSectionHeader } from '../components/table/GroupSectionHeader';
import { InlineInput } from '../components/table/InlineInput';
import { getGroupColor, useResizableCol } from '../components/table/tableUtils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import BlockNoteDocEditor from '@/components/docblock/BlockNoteDocEditor';
import SearchableSelect from '@/components/SearchableSelect';
import { Plus, Trash2, Mail, ListTodo, FolderKanban, ChevronsDownUp, ChevronsUpDown, X, EyeOff, Eye, Loader2, AlertCircle, NotebookPen, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

interface Pendiente {
  id: string;
  titulo: string;
  notasBlockId: string | null;
  status: string;
  fuente: string;
  proyectoCode: string | null;
  correoAsunto: string | null;
  correoRemitente: string | null;
  correoRecibidoAt: string | null;
  fechaLimite: string | null;
  completedAt: string | null;
  rowOrder: number;
  createdAt: string;
  updatedAt: string;
}

const COLOR_FAMILIES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const cellBorder = '1px solid hsl(var(--border) / 0.3)';

function isOverdue(fechaLimite: string | null): boolean {
  if (!fechaLimite) return false;
  return new Date(fechaLimite + 'T23:59:59') < new Date();
}

// Restringido a Sergio a petición suya (sep 2026) — nadie más del equipo
// usaba este módulo (0 pendientes de otros usuarios en pendientes_personales).
// El gate real está aquí y en Layout.tsx (nav item con `emails`) — no hace
// falta tocar el backend: cada endpoint ya escribe/lee scoped a
// context.user!.id, así que ni siquiera navegando directo a la URL alguien
// vería los pendientes de otra persona.
const MIS_PENDIENTES_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export default function MisPendientesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects } = useProject();
  const [items, setItems] = useState<Pendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [boardId, setBoardId] = useState('');
  const [hideResolved, setHideResolved] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropSide, setDropSide] = useState<'left' | 'right' | null>(null);
  const [newTaskNames, setNewTaskNames] = useState<Record<string, string>>({});
  const [detailItem, setDetailItem] = useState<Pendiente | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);

  // ── Drag-and-drop de filas (reordenar pendientes) — overlay sin re-render por
  // pixel, adaptado de RecruitmentPage.tsx (mismo patrón, sin virtualización ni
  // columnas de duplicado, que no aplican aquí).
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const dropTargetRef = useRef<{ rowId: string; position: 'before' | 'after' } | null>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  const dragRowIdRef = useRef<string | null>(null);
  const dragClientYRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  const hideDropLine = () => { if (dropLineRef.current) dropLineRef.current.style.opacity = '0'; };
  const cancelRaf = () => {
    if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; }
  };

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
      // Optimista: mismo criterio "al final de todo" que ya usa el backend al
      // crear (server/api/saveMisPendiente.ts) — evita que el item salte de
      // posición cuando llegue el siguiente refresh y traiga el rowOrder real.
      const nextOrder = Math.max(0, ...items.map(i => i.rowOrder ?? 0)) + 1000;
      setItems(prev => [{
        id: res.id, titulo, notasBlockId: null, status: 'Pendiente', fuente: 'manual', proyectoCode: null,
        correoAsunto: null, correoRemitente: null, correoRecibidoAt: null, fechaLimite: null,
        completedAt: null, rowOrder: nextOrder, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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
  const updateTitulo = (item: Pendiente, titulo: string) => {
    const trimmed = titulo.trim();
    if (trimmed && trimmed !== item.titulo) patch(item, { titulo: trimmed }, { titulo: trimmed });
    setEditingTitleId(null);
  };

  const onNotasBlockCreated = (itemId: string, blockId: string) =>
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, notasBlockId: blockId } : i));

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
    (a.rowOrder ?? 0) - (b.rowOrder ?? 0) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const toggleGroupExpand = (id: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    if (!dragGroupId || dragGroupId === targetGroupId || targetGroupId === '__none__') { setDragGroupId(null); setDropTargetId(null); setDropSide(null); return; }
    try { await groupDynCols.reorderColumns(dragGroupId, targetGroupId, dropSide ?? 'right'); } catch { toast.error('Error al reordenar'); }
    setDragGroupId(null); setDropTargetId(null); setDropSide(null);
  };

  // Soltar un pendiente sobre otro — reordena dentro de la misma área, o
  // mueve + reordena si el objetivo está en otra área (mismo comportamiento
  // que RecruitmentPage.tsx, reutilizando el mismo motor de grupos).
  const handleRowOnRowDrop = async (draggedId: string, targetItem: Pendiente, position: 'before' | 'after') => {
    const targetGroupId = groupOf(targetItem.id) ?? '__none__';
    const draggedGroupId = groupOf(draggedId) ?? '__none__';
    const draggedItem = items.find(i => i.id === draggedId);
    if (!draggedItem) return;

    const sortedGroup = [...(grouped[targetGroupId] ?? [])]
      .sort((a, b) => (a.rowOrder ?? 0) - (b.rowOrder ?? 0))
      .filter(i => i.id !== draggedId);

    const targetIdx = sortedGroup.findIndex(i => i.id === targetItem.id);
    const insertIdx = position === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
    sortedGroup.splice(insertIdx, 0, { ...draggedItem });

    const updates = sortedGroup.map((i, idx) => ({ id: i.id, rowOrder: (idx + 1) * 1000 }));
    const orderMap = new Map(updates.map(u => [u.id, u.rowOrder]));
    setItems(prev => prev.map(i => orderMap.has(i.id) ? { ...i, rowOrder: orderMap.get(i.id)! } : i));

    if (draggedGroupId !== targetGroupId) {
      const ops: Array<{ rowId: string; colId: string; value: DynCellValue }> = [];
      for (const g of groupDynCols.columns) {
        if (groupDynCols.getCellVal(draggedId, g.id)?.textValue === '1') ops.push({ rowId: draggedId, colId: g.id, value: {} });
      }
      if (targetGroupId !== '__none__') ops.push({ rowId: draggedId, colId: targetGroupId, value: { textValue: '1' } });
      if (ops.length > 0) groupDynCols.batchSetCellVals(ops);
    }

    try {
      await reorderMisPendientes({ updates });
    } catch {
      toast.error('Error al reordenar');
    }
  };

  // ── Drag delegado al contenedor de la tabla — una línea de drop calculada por
  // geometría en vivo, sin re-render por cada dragover (RAF-throttled).
  const containerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragClientYRef.current = e.clientY;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = tableContainerRef.current;
      const dropLine = dropLineRef.current;
      const draggedId = dragRowIdRef.current;
      if (!container || !dropLine || !draggedId) return;

      const clientY = dragClientYRef.current;
      const containerRect = container.getBoundingClientRect();
      const candidates = Array.from(container.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]'))
        .filter(tr => tr.getAttribute('data-row-id') !== draggedId);
      if (candidates.length === 0) { hideDropLine(); return; }

      let targetId = candidates[candidates.length - 1].getAttribute('data-row-id')!;
      let position: 'before' | 'after' = 'after';
      let lineY = candidates[candidates.length - 1].getBoundingClientRect().bottom;

      for (const tr of candidates) {
        const rect = tr.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (clientY < mid) { targetId = tr.getAttribute('data-row-id')!; position = 'before'; lineY = rect.top; break; }
      }

      dropTargetRef.current = { rowId: targetId, position };
      const localY = lineY - containerRect.top + container.scrollTop;
      dropLine.style.transform = `translateY(${localY - 1.5}px)`;
      dropLine.style.opacity = '1';
    });
  };

  const containerDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    const srcRowId = e.dataTransfer.getData('rowId');
    const cur = dropTargetRef.current;
    dropTargetRef.current = null;
    cancelRaf();
    hideDropLine();
    dragRowIdRef.current = null;
    setDragRowId(null);
    if (!srcRowId || !cur) return;
    const targetItem = items.find(i => i.id === cur.rowId);
    if (!targetItem || srcRowId === targetItem.id) return;
    handleRowOnRowDrop(srcRowId, targetItem, cur.position);
  };

  const containerDragLeave = (e: React.DragEvent) => {
    const container = tableContainerRef.current;
    if (container && !container.contains(e.relatedTarget as Node)) {
      dropTargetRef.current = null;
      cancelRaf();
      hideDropLine();
    }
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
      <tr key={item.id} className={`group${dragRowId === item.id ? ' opacity-25' : ''}`} data-row-id={item.id}>
        <td className="h-9 pl-2 group-hover:bg-muted bg-card" style={{ position: 'sticky', left: 0, zIndex: 10, borderBottom: cellBorder }}>
          <div className="flex items-center gap-1.5 h-full">
            <Checkbox checked={done} onCheckedChange={() => toggleStatus(item)} className="h-3.5 w-3.5" />
            <GroupPicker rowId={item.id} groups={groupDynCols.columns} groupDynCols={groupDynCols} />
          </div>
        </td>
        <td className="px-2 py-0 h-9 overflow-hidden group-hover:bg-muted border-r border-border/40 bg-card" style={{ position: 'sticky', left: 40, zIndex: 10, borderBottom: cellBorder }}>
          <div className="flex items-center gap-1.5 w-full h-full">
            <div
              draggable
              onDragStart={e => {
                e.stopPropagation();
                e.dataTransfer.setData('rowId', item.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragRowId(item.id);
                dragRowIdRef.current = item.id;
              }}
              onDragEnd={() => { dragRowIdRef.current = null; cancelRaf(); hideDropLine(); setDragRowId(null); dropTargetRef.current = null; }}
              onClick={e => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-all flex-shrink-0"
              title="Arrastrar para reordenar"
            >
              <GripVertical className="w-3 h-3" />
            </div>
            {editingTitleId === item.id ? (
              <InlineInput value={item.titulo} onSave={v => updateTitulo(item, v)} onCancel={() => setEditingTitleId(null)} className="flex-1" />
            ) : (
              <span
                onClick={() => setEditingTitleId(item.id)}
                className={`text-sm flex-1 truncate cursor-text hover:opacity-70 transition-opacity ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}
              >
                {item.titulo}
              </span>
            )}
            {item.fuente === 'correo' && (
              <span title={[item.correoAsunto, item.correoRemitente].filter(Boolean).join(' — ')} className="text-muted-foreground/50 flex-shrink-0">
                <Mail className="w-3 h-3" />
              </span>
            )}
            <button onClick={() => setDetailItem(item)} title="Ver notas / correo" className={`p-0.5 rounded hover:bg-primary/10 flex-shrink-0 transition-opacity ${item.notasBlockId ? 'text-primary opacity-100' : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100'}`}>
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

  // Este módulo solo aparece en el nav para Sergio (Layout.tsx), pero el
  // guard real está en los endpoints (scoped a context.user!.id) — esto es
  // un candado de UI adicional por si alguien navega directo a la URL.
  if (user && !MIS_PENDIENTES_ALLOWED_EMAILS.includes(user.email ?? '')) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">No tienes permisos para ver este módulo.</p>
      </div>
    );
  }

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
        <div
          ref={tableContainerRef}
          className="bg-card border rounded-lg overflow-auto max-h-[calc(100vh-280px)]"
          style={{ position: 'relative', overscrollBehavior: 'contain' }}
          onDragOver={containerDragOver}
          onDrop={containerDrop}
          onDragLeave={containerDragLeave}
        >
          {/* Línea de drop — posicionada con transform, sin impacto en el layout de la tabla */}
          <div
            ref={dropLineRef}
            style={{
              position: 'absolute', left: 0, right: 0, height: 3,
              pointerEvents: 'none', opacity: 0, zIndex: 50,
              background: 'hsl(var(--primary))', borderRadius: 9999,
              boxShadow: '0 0 10px hsl(var(--primary) / 0.6)',
              willChange: 'transform, opacity',
            }}
          />
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
                      onDragOver={(e, id) => {
                        setDropTargetId(id);
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setDropSide(e.clientY < rect.top + rect.height / 2 ? 'left' : 'right');
                      }}
                      onDragEnd={() => { setDragGroupId(null); setDropTargetId(null); setDropSide(null); }}
                      onDrop={handleGroupDrop}
                      isDragOver={dropTargetId === g.id && dragGroupId !== g.id}
                      insertSide={dropTargetId === g.id && dragGroupId !== g.id ? dropSide : null}
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
        onNotasBlockCreated={onNotasBlockCreated}
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

function PendienteDetailDialog({ item, onOpenChange, onNotasBlockCreated }: {
  item: Pendiente | null;
  onOpenChange: (open: boolean) => void;
  onNotasBlockCreated: (itemId: string, blockId: string) => void;
}) {
  const [notasBlockId, setNotasBlockId] = useState<string | null>(null);
  const [correo, setCorreo] = useState<CorreoBodyState | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(120);

  useEffect(() => {
    if (!item) return;
    setCorreo(null);
    setIframeHeight(120);
    if (item.fuente === 'correo') {
      setCorreo({ loading: true, available: false, errorMessage: null, bodyHtml: null });
      getPendienteCorreoBody({ id: item.id })
        .then(res => setCorreo({ loading: false, available: res.available, errorMessage: res.errorMessage, bodyHtml: res.bodyHtml }))
        .catch(() => setCorreo({ loading: false, available: false, errorMessage: 'No se pudo cargar el correo.', bodyHtml: null }));
    }

    // Notas = editor de bloques (mismo motor que las minutas), pero privado —
    // se monta con collaborative=false. El bloque en document_blocks se crea
    // la primera vez que se abren las notas de este pendiente.
    if (item.notasBlockId) {
      setNotasBlockId(item.notasBlockId);
    } else {
      setNotasBlockId(null);
      ensurePendienteNotasBlock({ id: item.id })
        .then(res => { setNotasBlockId(res.blockId); onNotasBlockCreated(item.id, res.blockId); })
        .catch(() => toast.error('Error al preparar las notas'));
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
      <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col gap-0 p-0 overflow-hidden [&_.lucide-x]:text-white/80 [&_.lucide-x]:hover:text-white">
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
            <div className="rounded-lg border border-border overflow-hidden" style={{ height: 'min(65vh, 620px)' }}>
              {notasBlockId ? (
                <BlockNoteDocEditor blockId={notasBlockId} collaborative={false} />
              ) : (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
