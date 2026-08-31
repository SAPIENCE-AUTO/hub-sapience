import React, { useState, useEffect, useRef, useMemo } from 'react';
import { saveCalendarEvent, duplicateRows, syncOutlookInvite, syncZoomMeeting } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, CornerDownRight, FolderPlus, X, ClipboardCopy, Loader2, RefreshCw, Check, ChevronsDownUp, ChevronsUpDown, Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { DynamicColumnHeaders, DynamicColumnCells, type DynCols } from '../DynamicColumns';
import { getGroupColor, useResizableCol } from '../table/tableUtils';
import { InlineInput } from '../table/InlineInput';
import { GroupSectionHeader } from '../table/GroupSectionHeader';
import { ChildSubTable } from '../table/ChildSubTable';
import { getLocationColor } from '../WeeklyCalendar';
import { ColumnFilterPopover } from '../ColumnFilterPopover';
import type { CalEvent } from './pmTypes';

// Emails "asistentes" llegan pegados de Outlook/Excel con formatos mixtos:
// "correo@x.com", "Nombre Apellido <correo@x.com>", separados por coma, punto
// y coma o salto de línea. EMAIL_RE encuentra el correo dentro de cualquiera
// de esas formas; lo que no matchea se conserva tal cual pero marcado inválido
// (chip rojo) en vez de guardarse en silencio — es justo lo que el usuario no
// podía ver antes con el textarea plano.
const EMAIL_RE = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/;

type EmailChip = { value: string; valid: boolean };

function parseEmailToken(token: string): EmailChip {
  const angle = token.match(/<([^<>]+)>/);
  const candidate = (angle ? angle[1] : token).trim();
  const match = candidate.match(EMAIL_RE);
  return match ? { value: match[0], valid: true } : { value: token.trim(), valid: false };
}

function parseEmailTokens(raw: string): EmailChip[] {
  return raw.split(/[,;\n\r\t]+/).map(s => s.trim()).filter(Boolean).map(parseEmailToken);
}

// ── Stable EmailsCell component (must be defined OUTSIDE EventsTable so React
//    keeps the same component type across re-renders and never remounts it) ──
function EmailsCell({ ev, onRefresh, onInviteStatusChanged }: { ev: CalEvent; onRefresh?: () => void; onInviteStatusChanged?: (evId: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [chips, setChips] = React.useState<EmailChip[]>([]);
  const [inputText, setInputText] = React.useState('');
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const editInputRef = React.useRef<HTMLInputElement>(null);

  // Reparse from the saved value when closed (mount + after external refresh) —
  // frozen while open so mid-edit chips don't get clobbered by a background reload.
  React.useEffect(() => {
    if (!open) { setChips(parseEmailTokens(ev.inviteEmails ?? '')); setInputText(''); setEditingIndex(null); setEditingText(''); }
  }, [ev.inviteEmails, open]);

  const commit = (text: string) => {
    const tokens = parseEmailTokens(text);
    if (tokens.length === 0) return;
    setChips(prev => {
      const seen = new Set(prev.map(c => c.value.toLowerCase()));
      return [...prev, ...tokens.filter(t => !seen.has(t.value.toLowerCase()))];
    });
  };

  // Clic en el cuerpo del chip (no en la X): lo edita EN SU MISMO LUGAR (un
  // input inline reemplaza al chip), en vez de moverlo al final de la lista.
  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(chips[index]?.value ?? '');
    requestAnimationFrame(() => editInputRef.current?.focus());
  };

  const commitEdit = () => {
    setEditingIndex(prevIndex => {
      if (prevIndex === null) return null;
      const text = editingText.trim();
      setChips(prev => {
        if (!text) return prev.filter((_, idx) => idx !== prevIndex);
        const next = [...prev];
        next[prevIndex] = parseEmailToken(text);
        return next;
      });
      return null;
    });
    setEditingText('');
  };

  const cancelEdit = () => { setEditingIndex(null); setEditingText(''); };

  const validCount = chips.filter(c => c.valid).length;
  const invalidCount = chips.length - validCount;

  const save = async () => {
    const value = chips.filter(c => c.valid).map(c => c.value).join(', ');
    const res = await saveCalendarEvent({ id: ev.id, inviteEmails: value || undefined });
    if (res.inviteStatusChanged) onInviteStatusChanged?.(ev.id);
    onRefresh?.();
  };

  const previewText = ev.inviteEmails ?? '';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          style={{ fontSize: 11, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: previewText ? 'inherit' : 'hsl(var(--muted-foreground))', minHeight: 16, cursor: 'pointer' }}
          onClick={() => setOpen(true)}
        >
          {previewText || 'correo@mail.com...'}
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        style={{ width: 360, padding: 12 }}
        onOpenAutoFocus={e => e.preventDefault()}
        onInteractOutside={() => setOpen(false)}
        onPointerDownOutside={() => setOpen(false)}
      >
        <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: 'hsl(var(--foreground))' }}>Emails asistentes</p>
        <div className="flex flex-wrap gap-1 p-1.5 border border-input rounded-md bg-background max-h-32 overflow-y-auto">
          {chips.map((c, i) => (
            editingIndex === i ? (
              <input
                key={`editing-${i}`}
                ref={editInputRef}
                value={editingText}
                onChange={e => setEditingText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
                onBlur={commitEdit}
                className="text-[11px] leading-tight px-1.5 py-0.5 rounded border border-primary bg-background outline-none"
                style={{ width: Math.max(90, editingText.length * 6.5 + 24) }}
              />
            ) : (
              <span
                key={`${c.value.toLowerCase()}-${i}`}
                title={c.valid ? 'Clic para editar' : 'No parece un correo válido — clic para editar'}
                onClick={() => startEdit(i)}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-tight cursor-pointer hover:opacity-80 ${c.valid ? 'bg-muted text-foreground' : 'bg-destructive/10 text-destructive border border-destructive/40'}`}
              >
                {c.value}
                <button type="button" onClick={e => { e.stopPropagation(); setChips(prev => prev.filter((_, idx) => idx !== i)); }} className="hover:opacity-70">
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            )
          ))}
          <input
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault();
                commit(inputText);
                setInputText('');
              } else if (e.key === 'Backspace' && inputText === '' && chips.length > 0) {
                setChips(prev => prev.slice(0, -1));
              }
            }}
            onPaste={e => {
              const pasted = e.clipboardData.getData('text');
              if (/[,;\n\r\t]/.test(pasted)) {
                e.preventDefault();
                commit(pasted);
                setInputText('');
              }
            }}
            onBlur={() => { if (inputText.trim()) { commit(inputText); setInputText(''); } }}
            placeholder={chips.length === 0 ? 'correo@ejemplo.com, otro@ejemplo.com...' : ''}
            className="flex-1 min-w-[100px] text-xs outline-none bg-transparent"
            autoFocus
          />
        </div>
        {invalidCount > 0 && (
          <p className="text-[10px] text-destructive mt-1">
            {invalidCount} entrada{invalidCount !== 1 ? 's' : ''} no parece{invalidCount === 1 ? '' : 'n'} correo{invalidCount === 1 ? '' : 's'} válido{invalidCount === 1 ? '' : 's'} — no se guardará{invalidCount === 1 ? '' : 'n'}.
          </p>
        )}
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-muted-foreground">{validCount} destinatario{validCount !== 1 ? 's' : ''}</p>
          {validCount > 0 && (
            <button
              type="button"
              title="Copiar todos los correos"
              onClick={async () => {
                const value = chips.filter(c => c.valid).map(c => c.value).join(', ');
                try {
                  await navigator.clipboard.writeText(value);
                  toast.success(`${validCount} correo${validCount !== 1 ? 's' : ''} copiado${validCount !== 1 ? 's' : ''}`);
                } catch {
                  toast.error('No se pudo copiar');
                }
              }}
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <ClipboardCopy className="w-3 h-3" /> Copiar todos
            </button>
          )}
        </div>
        <div className="flex gap-2 justify-end mt-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setChips(parseEmailTokens(ev.inviteEmails ?? '')); setInputText(''); setOpen(false); }} type="button">
            <X className="w-3 h-3" /> Cancelar
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={async () => { await save(); setOpen(false); }}>
            <Check className="w-3 h-3" /> Guardar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EventsTable({ events, onEdit, onOpenInvite, onDelete, onBulkDelete, onSaveEventName, onQuickCreate, onCreateGroup, dynCols, childDynCols, groupDynCols, boardId, childLabel, onChildLabelChange, columnFilters, setColFilter, colUniqueValues, onRefresh, onEventsUpdate, onInviteStatusChanged, onGroupStructureChanged }: {
  events: CalEvent[]; onEdit: (e: CalEvent) => void; onOpenInvite: (e: CalEvent) => void; onDelete: (id: string) => void; onBulkDelete: (ids: string[]) => void;
  onSaveEventName: (id: string, name: string) => void;
  onQuickCreate: (name: string, parentId?: string, groupId?: string) => void;
  onCreateGroup: () => void;
  dynCols: DynCols; childDynCols: DynCols; groupDynCols: DynCols;
  boardId: string;
  childLabel: string; onChildLabelChange: (l: string) => void;
  columnFilters?: Record<string, Set<string>>;
  setColFilter?: (col: string, vals: Set<string>) => void;
  colUniqueValues?: (col: string) => string[];
  onRefresh?: () => void;
  onEventsUpdate?: (evId: string, field: 'location' | 'attendees', value: string) => void;
  onInviteStatusChanged?: (evId: string) => void;
  onGroupStructureChanged?: () => void;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['__none__']));
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [editingName,    setEditingName]    = useState<string | null>(null);
  const [addingChildTo,  setAddingChildTo]  = useState<string | null>(null);
  const [newChildName,   setNewChildName]   = useState('');
  const [newEventNames,  setNewEventNames]  = useState<Record<string, string>>({});
  const [selectedIds,    setSelectedIds]    = useState<Set<string>>(new Set());
  const [duplicating,    setDuplicating]    = useState(false);

  const showBulkConfirm = (label: string, applyAll: () => void) => {
    if (selectedIds.size <= 1) return;
    toast(`¿Aplicar a las ${selectedIds.size} filas seleccionadas?`, {
      description: `"${label}"`,
      action: { label: 'Aplicar a todas', onClick: applyAll },
      cancel: { label: 'Solo esta fila', onClick: () => {} },
      duration: 5000,
    });
  };
  const [dragGroupId,    setDragGroupId]    = useState<string | null>(null);
  const [dropTargetId,   setDropTargetId]   = useState<string | null>(null);
  const [localFields,    setLocalFields]    = useState<Map<string, { location?: string; attendees?: string }>>(new Map());
  const [localReenvio,   setLocalReenvio]   = useState<Map<string, boolean>>(new Map());
  const [bulkSyncing,    setBulkSyncing]    = useState(false);
  const [quickSyncingId, setQuickSyncingId] = useState<string | null>(null);
  const [zoomSyncingId, setZoomSyncingId] = useState<string | null>(null);
  const nameCol = useResizableCol('pm-events-name-col', 250, 120);

  const EVT_LOCS = ['Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C', 'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F', 'Sala 6-G', 'Sala 6-H', 'Otro'];
  const locCol    = dynCols.columns.find(c => c.columnName === 'Ubicación Interna') ?? dynCols.columns.find(c => c.columnName === 'Ubicación (interna)') ?? dynCols.columns.find(c => c.columnName === 'Espacio');
  const personCol = dynCols.columns.find(c => c.columnName === 'Moderador') ?? dynCols.columns.find(c => c.columnName === 'Persona/Moderador');
  // locCol ya tiene su propia columna fija ("Ubic. Interna", más abajo) — sin
  // esto, DynamicColumnHeaders/Cells la vuelve a mostrar con su nombre real
  // ("Ubicación Interna"/"Ubicación (interna)"), duplicada.
  const visibleColIds = useMemo(
    () => new Set(dynCols.columns.filter(c => c.id !== locCol?.id).map(c => c.id)),
    [dynCols.columns, locCol?.id],
  );
  // Zoom se ancla junto a "Crear stream" (columna dinámica creada junto con
  // "Link Zoom"/"Link de observación" — ver add-observation-board-columns.ts).
  // El orden de columnas dinámicas es POR TABLERO, no fijo (aquí, p.ej.,
  // "Responsable" va antes que "Crear stream") — poner el pill antes/después
  // del bloque completo no lo deja junto a esa columna en particular. Por eso
  // el bloque se parte en dos llamadas a DynamicColumnHeaders/Cells, usando
  // `hiddenColumns` (que omite la celda por completo, a diferencia de
  // `visibleColIds`, que deja un placeholder) para que cada mitad renderice
  // solo lo suyo, con el pill de Zoom insertado exactamente entre las dos.
  const dynColsSorted = useMemo(
    () => [...dynCols.columns].sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0)),
    [dynCols.columns],
  );
  const crearStreamIdx = dynColsSorted.findIndex(c => c.columnName === 'Crear stream');
  const dynColsBeforeZoom = crearStreamIdx === -1 ? dynColsSorted : dynColsSorted.slice(0, crearStreamIdx + 1);
  const dynColsAfterZoom = crearStreamIdx === -1 ? [] : dynColsSorted.slice(crearStreamIdx + 1);
  const beforeZoomIds = useMemo(() => new Set(dynColsBeforeZoom.map(c => c.id)), [dynColsBeforeZoom]);
  const afterZoomIds = useMemo(() => new Set(dynColsAfterZoom.map(c => c.id)), [dynColsAfterZoom]);
  const getField = (evId: string, field: 'location' | 'attendees', fallback?: string | null) => {
    const local = localFields.get(evId)?.[field];
    if (local !== undefined) return local;
    const col = field === 'location' ? locCol : personCol;
    if (col) { const v = dynCols.getCellVal(evId, col.id)?.textValue; if (v) return v; }
    return fallback ?? '';
  };
  const saveField = async (evId: string, field: 'location' | 'attendees', value: string) => {
    setLocalFields(prev => { const m = new Map(prev); m.set(evId, { ...m.get(evId), [field]: value }); return m; });
    try {
      const res = await saveCalendarEvent({ id: evId, [field]: value || undefined });
      if (res.inviteStatusChanged) onInviteStatusChanged?.(evId);
      const col = field === 'location' ? locCol : personCol;
      if (col && boardId) {
        // setCellVal handles both the optimistic cell-map update and backend persistence —
        // calling saveCellValue separately would race against it and risk reverting the map.
        await dynCols.setCellVal(evId, col.id, { textValue: value || undefined });
      }
      // Notify parent so ev.location / ev.attendees stays in sync (fallback when localFields is cleared on remount)
      onEventsUpdate?.(evId, field, value);
    }
    catch { toast.error('Error al guardar'); }
  };

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
  const groups       = groupDynCols.columns;
  const topLevel     = events.filter(e => !e.parentEventId);
  const getChildEvts = (id: string) => events.filter(e => e.parentEventId === id);
  const totalCols    = 8 + dynCols.columns.filter(c => visibleColIds.has(c.id)).length + 1;

  const getEvtGroupId = (evId: string) =>
    groups.find(g => groupDynCols.getCellVal(evId, g.id)?.textValue === '1')?.id ?? null;

  const recentColors = useMemo(() => {
    const colorCols = dynCols.columns.filter(c => c.columnType === 'Color');
    if (!colorCols.length) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ev of events) {
      for (const col of colorCols) {
        const hex = dynCols.getCellVal(ev.id, col.id)?.textValue;
        if (hex && !seen.has(hex)) { seen.add(hex); result.push(hex); }
        if (result.length >= 10) return result;
      }
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynCols.columns, dynCols.getCellVal, events]);

  // Igual que recentColors arriba, pero para los dos colores (texto/fondo)
  // de las columnas "Texto con color".
  const { recentTextColors, recentBgColors } = useMemo(() => {
    const txtColorCols = dynCols.columns.filter(c => c.columnType === 'TextoColor');
    if (!txtColorCols.length) return { recentTextColors: [] as string[], recentBgColors: [] as string[] };
    const seenText = new Set<string>(); const textResult: string[] = [];
    const seenBg = new Set<string>(); const bgResult: string[] = [];
    for (const ev of events) {
      for (const col of txtColorCols) {
        const fileUrl = dynCols.getCellVal(ev.id, col.id)?.fileUrl;
        if (!fileUrl) continue;
        try {
          const meta = JSON.parse(fileUrl);
          if (meta?.textColor && !seenText.has(meta.textColor) && textResult.length < 10) { seenText.add(meta.textColor); textResult.push(meta.textColor); }
          if (meta?.bgColor && !seenBg.has(meta.bgColor) && bgResult.length < 10) { seenBg.add(meta.bgColor); bgResult.push(meta.bgColor); }
        } catch { /* fileUrl inválido para este tipo — se ignora */ }
      }
      if (textResult.length >= 10 && bgResult.length >= 10) break;
    }
    return { recentTextColors: textResult, recentBgColors: bgResult };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynCols.columns, dynCols.getCellVal, events]);

  const grouped: Record<string, CalEvent[]> = { __none__: [] };
  for (const g of groups) grouped[g.id] = [];
  for (const ev of topLevel) {
    const gid = getEvtGroupId(ev.id);
    if (gid && grouped[gid]) grouped[gid].push(ev);
    else grouped.__none__.push(ev);
  }

  const toggleGroup = (id: string) => setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleEvent = (id: string) => setExpandedEvents(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleGroupDrop = async (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    if (!dragGroupId || dragGroupId === targetGroupId || targetGroupId === '__none__') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientY < rect.top + rect.height / 2 ? 'left' : 'right';
    await groupDynCols.reorderColumns(dragGroupId, targetGroupId, side);
    setDragGroupId(null); setDropTargetId(null);
  };

  const renderEventRow = (ev: CalEvent) => {
    const children   = getChildEvts(ev.id);
    const isExpanded = expandedEvents.has(ev.id);
    const showNested = isExpanded && (children.length > 0 || addingChildTo === ev.id);
    const evtGroupId = getEvtGroupId(ev.id);
    const evtGroupColorId = evtGroupId ? groups.find(g => g.id === evtGroupId)?.columnType : undefined;
    const rowColor = evtGroupId ? getGroupColor(evtGroupColorId) : undefined;
    return (
      <React.Fragment key={ev.id}>
        <tr className={`${selectedIds.has(ev.id) ? 'bg-primary/5' : 'bg-card'} hover:bg-muted/20 border-b border-border/30 group`}>
          <td className={`pl-2 pr-0 py-1.5 w-8 sticky left-0 z-10 ${selectedIds.has(ev.id) ? 'bg-primary/5' : 'bg-card'} group-hover:bg-muted transition-colors`} style={{ borderLeft: rowColor ? `3px solid ${rowColor}` : '3px solid transparent' }}>
            <Checkbox checked={selectedIds.has(ev.id)} onCheckedChange={() => toggleSelect(ev.id)} className="h-3.5 w-3.5" />
          </td>
          <td className={`px-2 py-1.5 sticky z-10 ${selectedIds.has(ev.id) ? 'bg-primary/5' : 'bg-card'} group-hover:bg-muted transition-colors border-r border-border/40`} style={{ width: nameCol.width, maxWidth: nameCol.width, left: 35 }}>
            <div className="flex items-center gap-1.5">
              <button onClick={() => toggleEvent(ev.id)} className="text-muted-foreground flex-shrink-0 hover:text-foreground w-4">
                {(children.length > 0 || isExpanded) ? (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3 inline-block" />}
              </button>
              {editingName === ev.id ? (
                <InlineInput value={ev.eventName ?? ''} className="font-medium text-foreground flex-1"
                  onSave={val => {
                    if (val.trim()) {
                      onSaveEventName(ev.id, val.trim());
                      if (selectedIds.has(ev.id)) showBulkConfirm(val.trim(), () => [...selectedIds].filter(id => id !== ev.id).forEach(id => onSaveEventName(id, val.trim())));
                    }
                    setEditingName(null);
                  }}
                  onCancel={() => setEditingName(null)} />
              ) : (
                <span className="text-sm font-medium cursor-pointer hover:text-primary flex-1 truncate" onClick={() => setEditingName(ev.id)}>{ev.eventName}</span>
              )}
              <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button title={`Agregar ${childLabel}`} onClick={() => { setAddingChildTo(ev.id); setNewChildName(''); setExpandedEvents(p => new Set([...p, ev.id])); }} className="text-muted-foreground hover:text-primary p-0.5 rounded hover:bg-primary/10"><Plus className="w-3 h-3" /></button>
                <button onClick={() => onEdit(ev)} className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"><Pencil className="w-3 h-3" /></button>
                <button onClick={() => onDelete(ev.id)} className="text-muted-foreground hover:text-destructive p-0.5 rounded hover:bg-destructive/10"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          </td>
          {/* Ubicación inline select */}
          <td style={{ width: 128, maxWidth: 128, padding: '2px 6px', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: getLocationColor(getField(ev.id, 'location', ev.location) || undefined) }} />
              <select
                value={getField(ev.id, 'location', ev.location)}
                onChange={e2 => saveField(ev.id, 'location', e2.target.value)}
                style={{ flex: 1, fontSize: 11, background: 'transparent', border: 'none', outline: 'none', cursor: 'pointer', color: 'inherit', padding: '1px 0', minWidth: 0 }}
              >
                <option value="">—</option>
                {EVT_LOCS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </td>

          {/* Emails asistentes popover */}
          <td style={{ width: 160, maxWidth: 160, padding: '2px 6px', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)', cursor: 'pointer' }}>
            <EmailsCell ev={ev} onRefresh={onRefresh} onInviteStatusChanged={onInviteStatusChanged} />
          </td>
          {/* Invite status badge */}
          <td style={{ width: 96, maxWidth: 96, padding: '2px 6px', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)' }}>
            {ev.inviteStatus ? (() => {
              const statusColors: Record<string, string> = {
                'Enviado': 'bg-green-100 text-green-700',
                'Por actualizar': 'bg-amber-100 text-amber-700',
                'Por crear': 'bg-blue-100 text-blue-700',
                'Cancelado': 'bg-red-100 text-red-700',
              };
              const cls = statusColors[ev.inviteStatus] ?? 'bg-muted text-muted-foreground';
              return (
                <button
                  onClick={() => onOpenInvite(ev)}
                  title="Ver invitación de Outlook"
                  className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity ${cls}`}
                >
                  {ev.inviteStatus}
                </button>
              );
            })() : null}
          </td>
          {/* Outlook quick action: crea/actualiza directo, sin abrir el modal de vista previa */}
          <td style={{ width: 90, maxWidth: 90, padding: '2px 6px', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)', textAlign: 'center' }}>
            <button
              onClick={async () => {
                if (quickSyncingId) return;
                setQuickSyncingId(ev.id);
                const action = ev.outlookEventId ? 'update' : 'create';
                try {
                  const result = await syncOutlookInvite({ eventId: ev.id, action });
                  if (result.success) {
                    toast.success(action === 'create' ? 'Invitación creada en Outlook' : 'Invitación actualizada en Outlook');
                    // Encadenado: si el horario cambió, "Actualizar invitación" es
                    // justo el momento en que alguien ya está resolviendo eso mismo
                    // — no tiene sentido pedirle un segundo clic aparte para Zoom.
                    if (action === 'update' && (ev as any).zoomNeedsUpdate) {
                      try { await syncZoomMeeting({ calendarEventId: ev.id }); } catch { /* se ve el aviso en la lista si sigue pendiente */ }
                    }
                    onRefresh?.();
                  } else {
                    toast.error('Error al sincronizar con Outlook');
                  }
                } catch { toast.error('Error al sincronizar con Outlook'); }
                finally { setQuickSyncingId(null); }
              }}
              disabled={quickSyncingId === ev.id}
              title={ev.outlookEventId ? 'Actualizar invitación' : 'Crear invitación'}
              className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              {quickSyncingId === ev.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </td>
          {/* Restringir reenvío checkbox */}
          <td style={{ width: 44, maxWidth: 44, padding: '2px 0', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)', textAlign: 'center' }}>
            <Checkbox
              checked={localReenvio.has(ev.id) ? localReenvio.get(ev.id)! : !!(ev as any).restringirReenvio}
              onCheckedChange={(checked) => {
                const val = !!checked;
                setLocalReenvio(prev => { const m = new Map(prev); m.set(ev.id, val); return m; });
                saveCalendarEvent({ id: ev.id, restringirReenvio: val }).catch(() => {
                  setLocalReenvio(prev => { const m = new Map(prev); m.set(ev.id, !val); return m; });
                  toast.error('Error al guardar');
                });
              }}
              className="h-3.5 w-3.5"
            />
          </td>
          <DynamicColumnCells rowId={ev.id} dynCols={dynCols} recentColors={recentColors}
            recentTextColors={recentTextColors} recentBgColors={recentBgColors}
            colUniqueValues={colUniqueValues}
            selectedIds={selectedIds}
            visibleColIds={visibleColIds}
            hiddenColumns={afterZoomIds}
            hideAddButton
            onBulkSave={(colId, value, label) => showBulkConfirm(label, () => {
              const ops = [...selectedIds].filter(id => id !== ev.id).map(id => ({ rowId: id, colId, value }));
              if (ops.length > 0) dynCols.batchSetCellVals(ops);
            })} />
          {/* Zoom status — pegado a "Crear stream" (ver add-observation-board-columns.ts).
              Si el invite de Outlook YA está "Por actualizar", ese mismo cambio de
              fecha/hora también ensució Zoom (es subconjunto exacto de lo que
              dispara el invite) — arreglar el invite ya arregla Zoom de rebote
              (ver el encadenado en el handler de Outlook), así que no hace falta
              una segunda pastilla ámbar duplicando la misma alerta. Solo se
              muestra cuando de verdad es la ÚNICA señal: no hay invite pendiente
              (sin invitación enviada, o cancelada) que lo vaya a resolver solo. */}
          <td style={{ width: 96, maxWidth: 96, padding: '2px 6px', borderBottom: '1px solid hsl(var(--border) / 0.3)', borderRight: '1px solid hsl(var(--border) / 0.3)' }}>
            {(ev as any).hasZoom && ev.inviteStatus !== 'Por actualizar' ? (
              (ev as any).zoomNeedsUpdate ? (
                <button
                  onClick={async () => {
                    if (zoomSyncingId) return;
                    setZoomSyncingId(ev.id);
                    try {
                      await syncZoomMeeting({ calendarEventId: ev.id });
                      toast.success('Horario de Zoom actualizado');
                      onRefresh?.();
                    } catch { toast.error('Error al actualizar Zoom'); }
                    finally { setZoomSyncingId(null); }
                  }}
                  disabled={zoomSyncingId === ev.id}
                  title="El horario cambió — clic para actualizar el meeting de Zoom"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity bg-amber-100 text-amber-700 disabled:opacity-50"
                >
                  {zoomSyncingId === ev.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Desactualizado
                </button>
              ) : (
                <span
                  title="El meeting de Zoom está al día con la fecha/hora del evento"
                  className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-green-100 text-green-700"
                >
                  Al día
                </span>
              )
            ) : null}
          </td>
          <DynamicColumnCells rowId={ev.id} dynCols={dynCols} recentColors={recentColors}
            recentTextColors={recentTextColors} recentBgColors={recentBgColors}
            colUniqueValues={colUniqueValues}
            selectedIds={selectedIds}
            visibleColIds={visibleColIds}
            hiddenColumns={beforeZoomIds}
            onBulkSave={(colId, value, label) => showBulkConfirm(label, () => {
              const ops = [...selectedIds].filter(id => id !== ev.id).map(id => ({ rowId: id, colId, value }));
              if (ops.length > 0) dynCols.batchSetCellVals(ops);
            })} />
        </tr>
        {showNested && (
          <tr className="border-b border-border/20">
            <td colSpan={totalCols} className="p-0">
              <ChildSubTable childDynCols={childDynCols} childLabel={childLabel} onLabelChange={onChildLabelChange}
                addingName={addingChildTo === ev.id ? newChildName : ''}
                onAddingNameChange={v => { setAddingChildTo(ev.id); setNewChildName(v); }}
                onCommit={() => { if (newChildName.trim()) { onQuickCreate(newChildName.trim(), ev.id); setNewChildName(''); setAddingChildTo(null); } }}
                onCancel={() => { setAddingChildTo(null); setNewChildName(''); }}>
                {children.map(child => (
                  <tr key={child.id} className="hover:bg-muted/20 border-t border-border/20 group/child">
                    <td className="pl-2 pr-0 py-1.5 w-8"><Checkbox checked={selectedIds.has(child.id)} onCheckedChange={() => toggleSelect(child.id)} className="h-3.5 w-3.5" /></td>
                    <td className="px-3 py-1.5 min-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <CornerDownRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                        {editingName === child.id ? (
                          <InlineInput value={child.eventName ?? ''} className="flex-1"
                            onSave={val => { if (val.trim()) onSaveEventName(child.id, val.trim()); setEditingName(null); }}
                            onCancel={() => setEditingName(null)} />
                        ) : (
                          <span className="text-sm cursor-pointer hover:text-primary flex-1 truncate" onClick={() => setEditingName(child.id)}>{child.eventName}</span>
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

  const groupOrder = [...groups, { id: '__none__', columnName: 'Sin grupo', columnType: undefined as string | undefined }];

  return (
    <>
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl shadow-lg animate-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-medium">{selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-1 ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"><FolderPlus className="w-3 h-3" /> Mover a...</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={async () => { for (const id of selectedIds) { const g = getEvtGroupId(id); if (g) await groupDynCols.setCellVal(id, g, { textValue: undefined }); } setSelectedIds(new Set()); toast.success('Movido a Sin grupo'); }} className="text-xs gap-2">
                  <div className="w-2.5 h-2.5 rounded-full border border-dashed border-muted-foreground/40 flex-shrink-0" />Sin grupo
                </DropdownMenuItem>
                <div className="my-1 border-t border-border/30" />
                {groups.map(g => (
                  <DropdownMenuItem key={g.id} onClick={async () => { for (const id of selectedIds) { const cg = getEvtGroupId(id); if (cg) await groupDynCols.setCellVal(id, cg, { textValue: undefined }); await groupDynCols.setCellVal(id, g.id, { textValue: '1' }); } setSelectedIds(new Set()); toast.success(`Movido a ${g.columnName}`); }} className="text-xs gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getGroupColor(g.columnType) }} />
                    <span className="truncate">{g.columnName}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Outlook bulk actions */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25" disabled={bulkSyncing}>
                  {bulkSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Outlook
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  className="text-xs gap-2"
                  onClick={async () => {
                    const toCreate = [...selectedIds].filter(id => {
                      const ev = events.find(e => e.id === id);
                      return ev && !ev.outlookEventId;
                    });
                    if (toCreate.length === 0) { toast.info('No hay eventos sin invitación de Outlook en la selección'); return; }
                    setBulkSyncing(true);
                    let ok = 0; let fail = 0;
                    for (const id of toCreate) {
                      try {
                        await syncOutlookInvite({ eventId: id, action: 'create' });
                        ok++;
                        toast.success(`Creando invitaciones... (${ok}/${toCreate.length})`);
                      } catch { fail++; }
                    }
                    setBulkSyncing(false);
                    toast.success(`${ok} invitación${ok !== 1 ? 'es' : ''} creada${ok !== 1 ? 's' : ''}${fail > 0 ? ` (${fail} error${fail !== 1 ? 'es' : ''})` : ''}`);
                    setSelectedIds(new Set());
                    onRefresh?.();
                  }}
                >
                  <Plus className="w-3.5 h-3.5" /> Crear invitaciones
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs gap-2"
                  onClick={async () => {
                    const toUpdate = [...selectedIds].filter(id => {
                      const ev = events.find(e => e.id === id);
                      return ev && ev.outlookEventId;
                    });
                    if (toUpdate.length === 0) { toast.info('No hay eventos con invitación existente en la selección'); return; }
                    setBulkSyncing(true);
                    let ok = 0; let fail = 0;
                    for (const id of toUpdate) {
                      try {
                        await syncOutlookInvite({ eventId: id, action: 'update' });
                        ok++;
                        const ev = events.find(e => e.id === id);
                        if ((ev as any)?.zoomNeedsUpdate) {
                          try { await syncZoomMeeting({ calendarEventId: id }); } catch { /* se ve el aviso en la lista si sigue pendiente */ }
                        }
                      } catch { fail++; }
                    }
                    setBulkSyncing(false);
                    toast.success(`${ok} invitación${ok !== 1 ? 'es' : ''} actualizada${ok !== 1 ? 's' : ''}${fail > 0 ? ` (${fail} error${fail !== 1 ? 'es' : ''})` : ''}`);
                    setSelectedIds(new Set());
                    onRefresh?.();
                  }}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Actualizar invitaciones
                </DropdownMenuItem>
                <div className="my-1 border-t border-border/30" />
                <DropdownMenuItem
                  className="text-xs gap-2 text-destructive focus:text-destructive"
                  onClick={async () => {
                    const toCancel = [...selectedIds].filter(id => {
                      const ev = events.find(e => e.id === id);
                      return ev && ev.outlookEventId;
                    });
                    if (toCancel.length === 0) { toast.info('No hay eventos con invitación de Outlook en la selección'); return; }
                    setBulkSyncing(true);
                    let ok = 0; let fail = 0;
                    for (const id of toCancel) {
                      try {
                        await syncOutlookInvite({ eventId: id, action: 'cancel' });
                        ok++;
                      } catch { fail++; }
                    }
                    setBulkSyncing(false);
                    toast.success(`${ok} invitación${ok !== 1 ? 'es' : ''} cancelada${ok !== 1 ? 's' : ''}${fail > 0 ? ` (${fail} error${fail !== 1 ? 'es' : ''})` : ''}`);
                    setSelectedIds(new Set());
                    onRefresh?.();
                  }}
                >
                  <X className="w-3.5 h-3.5" /> Cancelar invitaciones
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" variant="outline"
              className="h-7 text-xs gap-1 bg-primary-foreground/15 border-primary-foreground/25 text-primary-foreground hover:bg-primary-foreground/25"
              disabled={duplicating}
              onClick={async () => {
                setDuplicating(true);
                try {
                  await duplicateRows({ ids: [...selectedIds], tableType: 'calendarEvent' });
                  toast.success(`${selectedIds.size} evento${selectedIds.size !== 1 ? 's' : ''} duplicado${selectedIds.size !== 1 ? 's' : ''}`);
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
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 bg-destructive/80 text-destructive-foreground hover:bg-destructive border-0" onClick={() => { onBulkDelete([...selectedIds]); setSelectedIds(new Set()); }}><Trash2 className="w-3 h-3" /> Eliminar</Button>
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
      <div className="bg-card border rounded-lg overflow-auto max-h-[calc(100vh-360px)]">
        <table style={{ tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0, width: 32 + nameCol.width + 128 + 128 + 96 + 90 + 96 + 44 + dynCols.columns.filter(c => visibleColIds.has(c.id)).reduce((sum, c) => sum + dynCols.getColWidth(c.id), 0) + 60, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: nameCol.width }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 44 }} />
            {/* Un <col> por CADA columna dinámica, sin filtrar por visibleColIds —
                DynamicColumnHeaders/Cells sí renderizan un <th>/<td> placeholder
                para la columna excluida (Ubicación Interna, duplicada con la
                columna fija "Ubic. Interna"), no la omiten del todo. Con
                table-layout:fixed el <colgroup> se empareja con las celdas
                reales por POSICIÓN — filtrar aquí pero no allá desalineaba un
                <col> de menos contra una celda de más a partir de esa columna,
                y la última columna real (la que fuera, o una recién agregada)
                se quedaba sin ancho declarado y colapsaba a ~30px. La columna
                excluida sigue ocupando su posición, pero con ancho 0 para no
                gastar espacio real. */}
            {dynColsBeforeZoom.map(c => { const w = visibleColIds.has(c.id) ? dynCols.getColWidth(c.id) : 0; return <col key={c.id} data-col-id={c.id} style={{ width: w, minWidth: w, maxWidth: w }} />; })}
            {/* Zoom va pegado a "Crear stream" (la última columna del bloque de
                arriba) — no tiene sentido que compita por atención con
                Invite/Outlook al inicio de la fila. */}
            <col style={{ width: 96 }} />
            {dynColsAfterZoom.map(c => { const w = visibleColIds.has(c.id) ? dynCols.getColWidth(c.id) : 0; return <col key={c.id} data-col-id={c.id} style={{ width: w, minWidth: w, maxWidth: w }} />; })}
            <col />
          </colgroup>
          <thead className="bg-muted sticky top-0 z-30">
            <tr>
              <th className="pl-2 pr-0 py-1 w-8 sticky left-0 z-40 bg-muted" />
              <th className="relative text-left px-2 py-1 text-xs font-semibold whitespace-nowrap group/nth sticky z-40 bg-muted border-r border-border/40"
                  style={{ width: nameCol.width, minWidth: 120, left: 35 }}>
                <div className="flex items-center" title="Calendario / Evento">
                  Calendario / Evento
                  {setColFilter && (
                    <ColumnFilterPopover allValues={colUniqueValues?.('eventName') ?? []} activeValues={columnFilters?.['eventName'] ?? new Set()} onApply={v => setColFilter('eventName', v)} />
                  )}
                </div>
                <div className="absolute top-0 right-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 opacity-0 group-hover/nth:opacity-100 transition-opacity z-10"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); nameCol.startResize(e.clientX); }} />
              </th>
              <th className="text-left px-2 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 128 }} title="Ubicación Interna">Ubic. Interna</th>
              <th className="text-left px-2 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 160 }} title="Emails asistentes">Emails asist.</th>
              <th className="text-left px-2 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 96 }} title="Estatus de la invitación">Invite</th>
              <th className="text-center px-2 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 90 }} title="Crear/actualizar la invitación en Outlook">Outlook</th>
              <th className="text-center px-0 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 44 }}>
                <TooltipProvider delayDuration={200}><Tooltip><TooltipTrigger asChild><span className="inline-flex items-center justify-center w-full"><Lock className="w-3.5 h-3.5 text-muted-foreground" /></span></TooltipTrigger><TooltipContent side="top"><p className="text-xs">Restringir reenvío de invitación</p></TooltipContent></Tooltip></TooltipProvider>
              </th>
              <DynamicColumnHeaders dynCols={dynCols} columnFilters={columnFilters} setColFilter={setColFilter} colUniqueValues={colUniqueValues} visibleColIds={visibleColIds} hiddenColumns={afterZoomIds} hideAddButton />
              <th className="text-left px-2 py-1 text-xs font-semibold whitespace-nowrap bg-muted border-r border-border/40" style={{ width: 96 }} title="Estatus del meeting de Zoom">Zoom</th>
              <DynamicColumnHeaders dynCols={dynCols} columnFilters={columnFilters} setColFilter={setColFilter} colUniqueValues={colUniqueValues} visibleColIds={visibleColIds} hiddenColumns={beforeZoomIds} />
            </tr>
          </thead>
          <tbody>
            {groupOrder.map((g, idx) => {
              const eventsInGroup = grouped[g.id] ?? [];
              const isExpanded    = expandedGroups.has(g.id);
              const isNone        = g.id === '__none__';
              return (
                <React.Fragment key={g.id}>
                  {idx > 0 && (
                    <tr aria-hidden="true">
                      <td colSpan={totalCols} style={{ height: 12, padding: 0, border: 'none', background: 'transparent' }} />
                    </tr>
                  )}
                  <GroupSectionHeader
                    groupId={g.id} name={g.columnName ?? 'Sin grupo'} colorId={g.columnType}
                    optionsJson={isNone ? undefined : groupDynCols.columns.find(c => c.id === g.id)?.optionsJson}
                    itemCount={eventsInGroup.length} isExpanded={isExpanded} isNone={isNone}
                    onToggle={() => toggleGroup(g.id)} groupDynCols={groupDynCols}
                    colSpan={totalCols}
                    itemIds={eventsInGroup.map(e => e.id)} selectedIds={selectedIds}
                    onToggleSelectAll={(ids, select) => setSelectedIds(prev => { const n = new Set(prev); ids.forEach(id => select ? n.add(id) : n.delete(id)); return n; })}
                    onDragStart={id => setDragGroupId(id)}
                    onDragOver={(e, id) => { e.preventDefault(); setDropTargetId(id); }}
                    onDragEnd={() => { setDragGroupId(null); setDropTargetId(null); }}
                    onDrop={handleGroupDrop}
                    isDragOver={dropTargetId === g.id && dragGroupId !== g.id}
                    onGroupStructureChanged={!isNone ? onGroupStructureChanged : undefined}
                  />
                  {isExpanded && eventsInGroup.length === 0 && (
                    <tr>
                      <td colSpan={totalCols} className="px-10 py-3 text-xs text-muted-foreground/50 italic">
                        {isNone ? 'Todos los eventos están en un grupo.' : 'Grupo vacío.'}
                      </td>
                    </tr>
                  )}
                  {isExpanded && eventsInGroup.map(e => renderEventRow(e))}
                  {isExpanded && (
                    <tr className="border-b border-dashed border-border/30">
                      <td colSpan={totalCols} className="px-10 py-2">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Plus className="w-3 h-3 opacity-40 flex-shrink-0" />
                          <input value={newEventNames[g.id] ?? ''} onChange={e => setNewEventNames(p => ({ ...p, [g.id]: e.target.value }))}
                            onKeyDown={e => {
                              const v = newEventNames[g.id] ?? '';
                              if (e.key === 'Enter' && v.trim()) { onQuickCreate(v.trim(), undefined, isNone ? undefined : g.id); setNewEventNames(p => ({ ...p, [g.id]: '' })); }
                              if (e.key === 'Escape') setNewEventNames(p => ({ ...p, [g.id]: '' }));
                            }}
                            placeholder="Nuevo evento...  (Enter para crear)"
                            className="flex-1 bg-transparent outline-none border-0 text-sm placeholder:text-muted-foreground/40 focus:text-foreground transition-colors"
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            <tr>
              <td colSpan={totalCols} className="px-3 py-2" style={{ borderTop: '1px dashed hsl(var(--border) / 0.3)' }}>
                <button onClick={onCreateGroup} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/5 px-2 py-1.5 rounded-md transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" /> Nuevo grupo
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
