import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { saveTask, reorderTasks, duplicateRows } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, ChevronUp, FolderPlus, GripVertical, ArrowUpDown, ClipboardCopy, ChevronsDownUp, ChevronsUpDown, CornerDownRight } from 'lucide-react';
import { DynamicColumnHeaders, DynamicColumnCells, type DynCols } from '../DynamicColumns';
import { ColumnFilterPopover } from '../ColumnFilterPopover';
import { getGroupColor, useResizableCol, cellDisplayValue } from '../table/tableUtils';
import { InlineInput } from '../table/InlineInput';
import { GroupSectionHeader } from '../table/GroupSectionHeader';
import { ChildSubTable } from '../table/ChildSubTable';
import { TimelineCell } from './TimelineCell';
import { Task } from './pmTypes';

export const TaskList = memo(function TaskList({ tasks, onEdit, onDelete, onSaveName, onQuickCreate, onCreateGroup, dynCols, childDynCols, groupDynCols, childLabel, onChildLabelChange, columnFilters, setColFilter, colUniqueValues, hiddenColumns, onTasksChange, sortColumn, sortDirection, toggleSort, onDuplicateGroup, onRefresh, onBulkDelete, onGroupStructureChanged }: {
  tasks: Task[];
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onSaveName: (id: string, name: string) => void;
  onQuickCreate: (name: string, parentId?: string, groupId?: string) => void;
  onCreateGroup: () => void;
  dynCols: DynCols; childDynCols: DynCols; groupDynCols: DynCols;
  childLabel: string; onChildLabelChange: (l: string) => void;
  columnFilters?: Record<string, Set<string>>;
  setColFilter?: (col: string, vals: Set<string>) => void;
  colUniqueValues?: (col: string) => string[];
  hiddenColumns: Set<string>;
  onTasksChange: React.Dispatch<React.SetStateAction<Task[]>>;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  toggleSort: (col: string) => void;
  onDuplicateGroup?: (groupId: string) => void;
  onRefresh?: () => void;
  onBulkDelete?: (ids: string[]) => void;
  onGroupStructureChanged?: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  const [expandedTasks,  setExpandedTasks]  = useState<Set<string>>(new Set());
  const [editingName,    setEditingName]    = useState<string | null>(null);
  const [addingChildTo,  setAddingChildTo]  = useState<string | null>(null);
  const [newChildName,   setNewChildName]   = useState('');
  const [newTaskNames,   setNewTaskNames]   = useState<Record<string, string>>({});
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [duplicating,    setDuplicating]    = useState(false);
  const [dragGroupId,    setDragGroupId]    = useState<string | null>(null);

  const showBulkConfirm = (label: string, applyAll: () => void) => {
    if (selectedIds.size <= 1) return;
    toast(`¿Aplicar a las ${selectedIds.size} filas seleccionadas?`, {
      description: `"${label}"`,
      action: { label: 'Aplicar a todas', onClick: applyAll },
      cancel: { label: 'Solo esta fila', onClick: () => {} },
      duration: 5000,
    });
  };
  const [dropTargetId,   setDropTargetId]   = useState<string | null>(null);
  const [dragRowId,      setDragRowId]      = useState<string | null>(null);
  const [dropRowGroupId, setDropRowGroupId] = useState<string | null>(null);

  const dropRowGroupRef = useRef<string | null>(null);
  const dropTargetRef   = useRef<{ rowId: string; position: 'before' | 'after' } | null>(null);
  const dropLineRef     = useRef<HTMLDivElement>(null);
  const dragRowIdRef    = useRef<string | null>(null);
  const dragClientYRef  = useRef<number>(0);
  const rafIdRef        = useRef<number | null>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const nameCol = useResizableCol('pm-tasks-name-col', 250, 120);

  // ── Fixed date columns ────────────────────────────────────────────────────
  const startDynCol = dynCols.columns.find(c => c.columnName === 'Inicio');
  const endDynCol   = dynCols.columns.find(c => c.columnName === 'Fin');

  const getEffectiveDate = (task: Task, field: 'start' | 'end'): string => {
    const dynCol = field === 'start' ? startDynCol : endDynCol;
    if (dynCol) {
      const v = dynCols.getCellVal(task.id, dynCol.id)?.dateValue?.split('T')[0];
      if (v) return v;
    }
    return (field === 'start' ? task.startDate : task.endDate)?.split('T')[0] || '';
  };

  const saveTimelineRange = async (taskId: string, start: string, end: string) => {
    onTasksChange(prev => prev.map(t => t.id === taskId ? { ...t, startDate: start || undefined, endDate: end || undefined } : t));
    try {
      await saveTask({ id: taskId, startDate: start || undefined, endDate: end || undefined });
      if (startDynCol) dynCols.setCellVal(taskId, startDynCol.id, { dateValue: start ? start + 'T00:00:00' : undefined });
      if (endDynCol)   dynCols.setCellVal(taskId, endDynCol.id,   { dateValue: end   ? end   + 'T00:00:00' : undefined });
    } catch {
      toast.error('Error al guardar fechas');
    }
  };

  const hideDropLine = () => { if (dropLineRef.current) dropLineRef.current.style.opacity = '0'; };
  const cancelRaf = () => { if (rafIdRef.current !== null) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null; } };

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

  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const groups = groupDynCols.columns;

  const getTaskGroupId = (taskId: string) =>
    groups.find(g => groupDynCols.getCellVal(taskId, g.id)?.textValue === '1')?.id ?? null;

  const recentColors = useMemo(() => {
    const colorCols = dynCols.columns.filter(c => c.columnType === 'Color');
    if (!colorCols.length) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of tasks) {
      for (const col of colorCols) {
        const hex = dynCols.getCellVal(t.id, col.id)?.textValue;
        if (hex && !seen.has(hex)) { seen.add(hex); result.push(hex); }
        if (result.length >= 10) return result;
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynCols.columns, dynCols.getCellVal, tasks]);

  const sortedTopLevel = useMemo(() => {
    const topLevel = tasks.filter(t => !t.parentTaskId);
    if (!sortColumn) return topLevel;
    return [...topLevel].sort((a, b) => {
      let aVal = '';
      let bVal = '';
      if (sortColumn === 'taskName') {
        aVal = (a.taskName || '').toLowerCase();
        bVal = (b.taskName || '').toLowerCase();
      } else {
        const col = dynCols.columns.find(c => c.id === sortColumn);
        aVal = (cellDisplayValue(dynCols.getCellVal(a.id, sortColumn), col?.columnType) || '').toLowerCase();
        bVal = (cellDisplayValue(dynCols.getCellVal(b.id, sortColumn), col?.columnType) || '').toLowerCase();
      }
      if (!aVal && bVal) return 1;
      if (aVal && !bVal) return -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sortColumn, sortDirection, dynCols.getCellVal, dynCols.columns]);

  const grouped: Record<string, Task[]> = { __none__: [] };
  for (const g of groups) grouped[g.id] = [];
  for (const t of sortedTopLevel) {
    const gid = getTaskGroupId(t.id);
    if (gid && grouped[gid]) grouped[gid].push(t);
    else grouped.__none__.push(t);
  }

  const groupOrder = useMemo(
    () => [{ id: '__none__', columnName: 'Sin grupo', columnType: undefined as string | undefined }, ...groups],
    [groups]
  );

  const toggleGroup = (id: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const getChildTasks = (id: string) => tasks.filter(t => t.parentTaskId === id);

  const sortedDynCols = [...dynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));
  const visibleDynCols = sortedDynCols.filter(c => !hiddenColumns.has(c.id));
  const totalCols = 2 + 1 + visibleDynCols.length + 1; // +1 for fixed Timeline column

  const handleRowOnRowDrop = async (draggedId: string, targetTask: Task, position: 'before' | 'after') => {
    const targetGroupId  = getTaskGroupId(targetTask.id) ?? '__none__';
    const draggedGroupId = getTaskGroupId(draggedId) ?? '__none__';
    const draggedTask = sortedTopLevel.find(t => t.id === draggedId);
    if (!draggedTask) return;

    const sortedGroup = [...(grouped[targetGroupId] ?? [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter(t => t.id !== draggedId);

    const targetIdx = sortedGroup.findIndex(t => t.id === targetTask.id);
    const insertIdx = position === 'before' ? Math.max(0, targetIdx) : targetIdx + 1;
    sortedGroup.splice(insertIdx, 0, { ...draggedTask });

    const updates = sortedGroup.map((t, i) => ({ id: t.id, order: (i + 1) * 1000 }));
    const orderMap = new Map(updates.map(u => [u.id, u.order]));

    onTasksChange(prev => prev.map(t => orderMap.has(t.id) ? { ...t, order: orderMap.get(t.id)! } : t));

    if (draggedGroupId !== targetGroupId) {
      // Clear ALL groups for this task (not just the detected one) to fix phantom assignments
      await Promise.all(groups.filter(g => groupDynCols.getCellVal(draggedId, g.id)?.textValue === '1').map(g => groupDynCols.setCellVal(draggedId, g.id, { textValue: undefined })));
      if (targetGroupId !== '__none__') await groupDynCols.setCellVal(draggedId, targetGroupId, { textValue: '1' });
      toast.success('Tarea movida al grupo');
    }

    await reorderTasks({ updates });
  };

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    dropTargetRef.current = null; cancelRaf(); hideDropLine();
    if (e.dataTransfer.types.includes('rowid')) {
      const rowId = e.dataTransfer.getData('rowId');
      if (rowId) {
        const draggedGroupId = getTaskGroupId(rowId) ?? '__none__';
        if (draggedGroupId !== targetGroupId) {
          // Clear ALL groups for this task to fix phantom assignments
          await Promise.all(groups.filter(g => groupDynCols.getCellVal(rowId, g.id)?.textValue === '1').map(g => groupDynCols.setCellVal(rowId, g.id, { textValue: undefined })));
          if (targetGroupId !== '__none__') await groupDynCols.setCellVal(rowId, targetGroupId, { textValue: '1' });
          toast.success('Tarea movida al grupo');
        }
        const targetGroupTasks = grouped[targetGroupId] ?? [];
        const maxOrder = targetGroupTasks.length > 0 ? Math.max(...targetGroupTasks.map(t => t.order ?? 0)) + 1000 : 1000;
        onTasksChange(prev => prev.map(t => t.id === rowId ? { ...t, order: maxOrder } : t));
        await reorderTasks({ updates: [{ id: rowId, order: maxOrder }] });
      }
      setDragRowId(null); setDropRowGroupId(null); dropRowGroupRef.current = null;
      return;
    }
    if (!dragGroupId || dragGroupId === targetGroupId || targetGroupId === '__none__') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'left' : 'right';
    await groupDynCols.reorderColumns(dragGroupId, targetGroupId, side);
    setDragGroupId(null); setDropTargetId(null);
  };

  const containerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragClientYRef.current = e.clientY;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const container = tableContainerRef.current;
      const dropLine  = dropLineRef.current;
      const draggedId = dragRowIdRef.current;
      if (!container || !dropLine || !draggedId) return;
      const clientY = dragClientYRef.current;
      const containerRect = container.getBoundingClientRect();
      const candidates = Array.from(container.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]'))
        .filter(tr => tr.getAttribute('data-row-id') !== draggedId);
      if (candidates.length === 0) { hideDropLine(); return; }
      if (dropRowGroupRef.current) { dropRowGroupRef.current = null; setDropRowGroupId(null); }
      let targetId = candidates[candidates.length - 1].getAttribute('data-row-id')!;
      let position: 'before' | 'after' = 'after';
      let lineY = candidates[candidates.length - 1].getBoundingClientRect().bottom;
      for (const tr of candidates) {
        const rect = tr.getBoundingClientRect();
        const mid  = rect.top + rect.height / 2;
        if (clientY < mid) { targetId = tr.getAttribute('data-row-id')!; position = 'before'; lineY = rect.top; break; }
      }
      dropTargetRef.current = { rowId: targetId, position };
      const localY = lineY - containerRect.top + container.scrollTop;
      dropLine.style.transform = `translateY(${localY - 1.5}px)`;
      dropLine.style.opacity   = '1';
    });
  };

  const containerDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('rowid')) return;
    e.preventDefault();
    const srcRowId = e.dataTransfer.getData('rowId');
    const cur = dropTargetRef.current;
    dropTargetRef.current = null; cancelRaf(); hideDropLine();
    dropRowGroupRef.current = null; dragRowIdRef.current = null;
    if (!srcRowId || !cur) { setDragRowId(null); setDropRowGroupId(null); return; }
    const targetTask = tasks.find(t => t.id === cur.rowId);
    if (!targetTask || srcRowId === targetTask.id) { setDragRowId(null); setDropRowGroupId(null); return; }
    handleRowOnRowDrop(srcRowId, targetTask, cur.position);
    setDragRowId(null); setDropRowGroupId(null);
  };

  const containerDragLeave = (e: React.DragEvent) => {
    const container = tableContainerRef.current;
    if (container && !container.contains(e.relatedTarget as Node)) {
      dropTargetRef.current = null; cancelRaf(); hideDropLine();
    }
  };

  const cellBorder = '1px solid hsl(var(--border) / 0.3)';

  const renderRow = (task: Task) => {
    const children   = getChildTasks(task.id);
    const isExpanded = expandedTasks.has(task.id);
    const showNested = isExpanded && (children.length > 0 || addingChildTo === task.id);
    const taskGroupId = getTaskGroupId(task.id);
    const taskGroupColorId = taskGroupId ? groups.find(g => g.id === taskGroupId)?.columnType : undefined;
    const rowColor = taskGroupId ? getGroupColor(taskGroupColorId) : undefined;
    const effectiveStart = getEffectiveDate(task, 'start');
    const effectiveEnd   = getEffectiveDate(task, 'end');

    return (
      <React.Fragment key={task.id}>
        <tr data-row-id={task.id} className={`group${dragRowId === task.id ? ' opacity-25' : ''}${selectedIds.has(task.id) ? ' bg-primary/5' : ''}`}>
          <td className={`h-9 pl-1 group-hover:bg-muted ${selectedIds.has(task.id) ? 'bg-primary/5' : 'bg-card'}`}
            style={{ position: 'sticky', left: 0, zIndex: 10, borderBottom: cellBorder, borderLeft: rowColor ? `3px solid ${rowColor}` : '3px solid transparent' }}>
            <div className="flex items-center gap-0.5 h-full">
              <div
                draggable
                onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData('rowId', task.id); e.dataTransfer.effectAllowed = 'move'; setDragRowId(task.id); dragRowIdRef.current = task.id; }}
                onDragEnd={() => { dragRowIdRef.current = null; cancelRaf(); hideDropLine(); setDragRowId(null); setDropRowGroupId(null); dropTargetRef.current = null; dropRowGroupRef.current = null; }}
                onClick={e => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-all flex-shrink-0 py-1"
              >
                <GripVertical className="w-3 h-3" />
              </div>
              <Checkbox checked={selectedIds.has(task.id)} onCheckedChange={() => toggleSelect(task.id)} className="h-3.5 w-3.5" />
            </div>
          </td>

          <td className={`px-2 py-0 h-9 overflow-hidden group-hover:bg-muted border-r border-border/40 ${selectedIds.has(task.id) ? 'bg-primary/5' : 'bg-card'}`}
            style={{ position: 'sticky', left: 35, zIndex: 10, borderBottom: cellBorder }}>
            <div className="flex items-center gap-1.5 w-full h-full">
              <button onClick={() => setExpandedTasks(p => { const n = new Set(p); n.has(task.id) ? n.delete(task.id) : n.add(task.id); return n; })} className="text-muted-foreground flex-shrink-0 hover:text-foreground w-4">
                {(children.length > 0 || isExpanded) ? (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3 inline-block" />}
              </button>
              {editingName === task.id ? (
                <InlineInput value={task.taskName ?? ''} className="font-medium text-foreground flex-1"
                  onSave={val => {
                    if (val.trim()) {
                      onSaveName(task.id, val.trim());
                      if (selectedIds.has(task.id)) showBulkConfirm(val.trim(), () => [...selectedIds].filter(id => id !== task.id).forEach(id => onSaveName(id, val.trim())));
                    }
                    setEditingName(null);
                  }}
                  onCancel={() => setEditingName(null)} />
              ) : (
                <span className="text-sm font-medium cursor-pointer hover:text-primary flex-1 truncate"
                  onClick={() => setEditingName(task.id)}>{task.taskName}</span>
              )}
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button title={`Agregar ${childLabel}`} onClick={() => { setAddingChildTo(task.id); setNewChildName(''); setExpandedTasks(p => new Set([...p, task.id])); }} className="text-muted-foreground hover:text-primary p-0.5 rounded hover:bg-primary/10"><Plus className="w-3 h-3" /></button>
                <button onClick={() => onEdit(task)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"><Pencil className="w-3 h-3" /></button>
                <button onClick={() => onDelete(task.id)} className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-destructive/10"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          </td>

          <td style={{ borderBottom: cellBorder, borderRight: '1px solid hsl(var(--border) / 0.3)', padding: 0, width: 180 }} className="group-hover:bg-muted">
            <TimelineCell taskId={task.id} startDate={effectiveStart} endDate={effectiveEnd} onSave={saveTimelineRange} />
          </td>
          <DynamicColumnCells rowId={task.id} dynCols={dynCols} hiddenColumns={hiddenColumns} recentColors={recentColors}
            colUniqueValues={colUniqueValues}
            selectedIds={selectedIds}
            onBulkSave={(colId, value, label) => showBulkConfirm(label, () => {
              const ops = [...selectedIds].filter(id => id !== task.id).map(id => ({ rowId: id, colId, value }));
              if (ops.length > 0) dynCols.batchSetCellVals(ops);
            })} />
        </tr>

        {showNested && (
          <tr>
            <td colSpan={totalCols} style={{ padding: 0, borderBottom: '1px solid hsl(var(--border) / 0.2)' }}>
              <ChildSubTable childDynCols={childDynCols} childLabel={childLabel} onLabelChange={onChildLabelChange}
                addingName={addingChildTo === task.id ? newChildName : ''}
                onAddingNameChange={v => { setAddingChildTo(task.id); setNewChildName(v); }}
                onCommit={() => { if (newChildName.trim()) { onQuickCreate(newChildName.trim(), task.id); setNewChildName(''); setAddingChildTo(null); } }}
                onCancel={() => { setAddingChildTo(null); setNewChildName(''); }}>
                {children.map(child => (
                  <tr key={child.id} className="hover:bg-muted/20 border-t border-border/20 group/child">
                    <td className="pl-2 pr-0 py-1.5 w-8"><Checkbox checked={selectedIds.has(child.id)} onCheckedChange={() => toggleSelect(child.id)} className="h-3.5 w-3.5" /></td>
                    <td className="px-3 py-1.5 min-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <CornerDownRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                        {editingName === child.id ? (
                          <InlineInput value={child.taskName ?? ''} className="text-foreground flex-1"
                            onSave={val => { if (val.trim()) onSaveName(child.id, val.trim()); setEditingName(null); }}
                            onCancel={() => setEditingName(null)} />
                        ) : (
                          <span className="text-sm cursor-pointer hover:text-primary flex-1 truncate" onClick={() => setEditingName(child.id)}>{child.taskName}</span>
                        )}
                        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover/child:opacity-100 transition-opacity">
                          <button onClick={() => onEdit(child)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"><Pencil className="w-3 h-3" /></button>
                          <button onClick={() => onDelete(child.id)} className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-destructive/10"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    </td>
                    <DynamicColumnCells rowId={child.id} dynCols={childDynCols} />
                  </tr>
                ))}
              </ChildSubTable>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  return (
    <>
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl shadow-lg animate-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-medium">{selectedIds.size} seleccionada{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1 ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"><FolderPlus className="w-3 h-3" /> Mover a...</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={async () => { for (const id of selectedIds) { const g = getTaskGroupId(id); if (g) await groupDynCols.setCellVal(id, g, { textValue: undefined }); } setSelectedIds(new Set()); toast.success('Movido a Sin grupo'); }} className="text-xs gap-2">
                  <div className="w-2.5 h-2.5 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" />Sin grupo
                </DropdownMenuItem>
                <div className="my-1 border-t border-border/30" />
                {groups.map(g => (
                  <DropdownMenuItem key={g.id} onClick={async () => { for (const id of selectedIds) { const cg = getTaskGroupId(id); if (cg) await groupDynCols.setCellVal(id, cg, { textValue: undefined }); await groupDynCols.setCellVal(id, g.id, { textValue: '1' }); } setSelectedIds(new Set()); toast.success(`Movido a ${g.columnName}`); }} className="text-xs gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getGroupColor(g.columnType) }} />
                    <span className="truncate">{g.columnName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"
              disabled={duplicating}
              onClick={async () => {
                setDuplicating(true);
                try {
                  await duplicateRows({ ids: [...selectedIds], tableType: 'task' });
                  toast.success(`${selectedIds.size} tarea${selectedIds.size !== 1 ? 's' : ''} duplicada${selectedIds.size !== 1 ? 's' : ''}`);
                  setSelectedIds(new Set());
                  onRefresh?.();
                  dynCols.softReload(); childDynCols.softReload(); groupDynCols.softReload();
                } catch { toast.error('Error al duplicar'); }
                setDuplicating(false);
              }}
            >
              {duplicating ? <div className="w-3 h-3 border border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <ClipboardCopy className="w-3 h-3" />}
              Duplicar
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-destructive/80 text-destructive-foreground hover:bg-destructive border-0" onClick={() => { if (onBulkDelete) { onBulkDelete([...selectedIds]); } else { selectedIds.forEach(id => onDelete(id)); } setSelectedIds(new Set()); }}><Trash2 className="w-3 h-3" /> Eliminar</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10" onClick={() => setSelectedIds(new Set())}>Cancelar</Button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/20 bg-muted/20 flex-shrink-0">
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
          onClick={() => expandedGroups.size > 0 ? setExpandedGroups(new Set()) : setExpandedGroups(new Set(groupOrder.map(g => g.id)))}>
          {expandedGroups.size > 0 ? <ChevronsDownUp className="w-3.5 h-3.5" /> : <ChevronsUpDown className="w-3.5 h-3.5" />}
          {expandedGroups.size > 0 ? 'Colapsar todos' : 'Expandir todos'}
        </Button>
      </div>

      <div ref={tableContainerRef}
        className="bg-card border rounded-lg overflow-auto max-h-[calc(100vh-360px)]"
        style={{ position: 'relative' }}
        onDragOver={containerDragOver}
        onDrop={containerDrop}
        onDragLeave={containerDragLeave}
      >
        <div ref={dropLineRef} style={{
          position: 'absolute', left: 0, right: 0, height: 3, pointerEvents: 'none', opacity: 0, zIndex: 50,
          background: 'hsl(var(--primary))', borderRadius: 9999, boxShadow: '0 0 10px hsl(var(--primary) / 0.6)',
          willChange: 'transform, opacity', transform: 'translateY(0)', transition: 'opacity 0.08s',
        }}>
          <div style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'hsl(var(--primary))', border: '2px solid hsl(var(--card))' }} />
          <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 10, height: 10, borderRadius: '50%', background: 'hsl(var(--primary))', border: '2px solid hsl(var(--card))' }} />
        </div>

        <table style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, width: 32 + nameCol.width + 180 + visibleDynCols.reduce((sum, c) => sum + dynCols.getColWidth(c.id), 0) + 60, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: nameCol.width }} />
            <col style={{ width: 180 }} />
            {visibleDynCols.map(c => { const w = dynCols.getColWidth(c.id); return <col key={c.id} data-col-id={c.id} style={{ width: w, minWidth: w, maxWidth: w }} />; })}
            <col />
          </colgroup>
          <thead>
            <tr style={{ height: 33 }}>
              <th className="bg-muted border-b border-border/50"
                style={{ position: 'sticky', top: 0, left: 0, zIndex: 40 }} />
              <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40 relative group/nth"
                style={{ position: 'sticky', top: 0, left: 35, zIndex: 40 }}>
                <div className="flex items-center">
                  <button onClick={() => toggleSort('taskName')} className="flex items-center gap-1 hover:bg-muted-foreground/10 transition-colors rounded px-1 -mx-1">
                    Tarea
                    {sortColumn === 'taskName' ? (sortDirection === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />) : <ArrowUpDown className="w-3 h-3 text-muted-foreground/30 opacity-0 group-hover/nth:opacity-100" />}
                  </button>
                  {setColFilter && (
                    <ColumnFilterPopover allValues={colUniqueValues?.('taskName') ?? []} activeValues={columnFilters?.['taskName'] ?? new Set()} onApply={v => setColFilter('taskName', v)} />
                  )}
                </div>
                <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/nth:opacity-100 transition-opacity z-10"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); nameCol.startResize(e.clientX); }} />
              </th>
              <th className="text-left px-2 text-xs font-semibold whitespace-nowrap bg-muted border-b border-border/50 border-r border-border/40" style={{ position: 'sticky', top: 0, zIndex: 30, width: 180 }}>Timeline</th>
              <DynamicColumnHeaders
                dynCols={dynCols}
                sticky
                columnFilters={columnFilters}
                setColFilter={setColFilter}
                colUniqueValues={colUniqueValues}
                hiddenColumns={hiddenColumns}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onToggleSort={toggleSort}
              />
            </tr>
          </thead>

          <tbody>
            {groupOrder.map((g, idx) => {
              const tasksInGroup = grouped[g.id] ?? [];
              const isExpanded   = expandedGroups.has(g.id);
              const isNone       = g.id === '__none__';
              return (
                <React.Fragment key={g.id}>
                  {idx > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={totalCols} style={{ height: 12, padding: 0, border: 'none', background: 'transparent' }} />
                    </tr>
                  )}
                  <GroupSectionHeader
                    groupId={g.id}
                    name={g.columnName ?? 'Sin grupo'}
                    colorId={g.columnType}
                    optionsJson={isNone ? undefined : groupDynCols.columns.find(c => c.id === g.id)?.optionsJson}
                    itemCount={tasksInGroup.length}
                    isExpanded={isExpanded}
                    isNone={isNone}
                    onToggle={() => toggleGroup(g.id)}
                    groupDynCols={groupDynCols}
                    colSpan={totalCols}
                    itemIds={tasksInGroup.map(t => t.id)}
                    selectedIds={selectedIds}
                    onToggleSelectAll={(ids, select) => setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => select ? n.add(id) : n.delete(id)); return n; })}
                    onDragStart={id => setDragGroupId(id)}
                    onDragOver={(e, id) => {
                      e.preventDefault();
                      if (e.dataTransfer.types.includes('rowid')) {
                        cancelRaf(); hideDropLine();
                        if (dropTargetRef.current) dropTargetRef.current = null;
                        if (dropRowGroupRef.current !== id) { dropRowGroupRef.current = id; setDropRowGroupId(id); }
                      } else {
                        setDropTargetId(id);
                      }
                    }}
                    onDragEnd={() => { setDragGroupId(null); setDropTargetId(null); }}
                    onDrop={handleGroupDrop}
                    isDragOver={(dropTargetId === g.id && dragGroupId !== g.id) || dropRowGroupId === g.id}
                    onDuplicateGroup={onDuplicateGroup && !isNone ? () => onDuplicateGroup(g.id) : undefined}
                    onGroupStructureChanged={!isNone ? onGroupStructureChanged : undefined}
                  />

                  {isExpanded && (
                    <>
                      {tasksInGroup.length === 0 && (
                        <tr>
                          <td colSpan={totalCols} className="px-10 py-3 text-xs text-muted-foreground/50 italic"
                            style={{ borderBottom: '1px solid hsl(var(--border) / 0.2)' }}>
                            {isNone ? 'Todas las tareas están en un grupo.' : 'Grupo vacío — agrega tareas aquí.'}
                          </td>
                        </tr>
                      )}
                      {(sortColumn ? tasksInGroup : [...tasksInGroup].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))).map(t => renderRow(t))}

                      <tr>
                        <td colSpan={totalCols} className="px-10 py-2"
                          style={{ borderBottom: '1px dashed hsl(var(--border) / 0.3)' }}>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Plus className="w-3 h-3 opacity-40 flex-shrink-0" />
                            <input
                              value={newTaskNames[g.id] ?? ''}
                              onChange={e => setNewTaskNames(p => ({ ...p, [g.id]: e.target.value }))}
                              onKeyDown={e => {
                                const v = newTaskNames[g.id] ?? '';
                                if (e.key === 'Enter' && v.trim()) { onQuickCreate(v.trim(), undefined, isNone ? undefined : g.id); setNewTaskNames(p => ({ ...p, [g.id]: '' })); }
                                if (e.key === 'Escape') setNewTaskNames(p => ({ ...p, [g.id]: '' }));
                              }}
                              placeholder="Nueva tarea...  (Enter para crear)"
                              className="flex-1 bg-transparent outline-none border-0 text-sm placeholder:text-muted-foreground/40 focus:text-foreground transition-colors"
                            />
                          </div>
                        </td>
                      </tr>
                    </>
                  )}
                </React.Fragment>
              );
            })}

            <tr>
              <td colSpan={totalCols} className="px-3 py-2" style={{ borderTop: '1px dashed hsl(var(--border) / 0.3)' }}>
                <button onClick={onCreateGroup} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-2 py-1.5 rounded-md transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" /> Nueva fase
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
});
