import { useState, useEffect } from 'react';

import { Pencil, Trash2, ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Copy, BarChart2, Loader2, ExternalLink, Eye, RefreshCw, CalendarDays, Unlink, Plus } from 'lucide-react';
import { LinkEventDialog } from './LinkEventDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getGroupColor } from './tableUtils';
import { ColorSwatches } from './ColorSwatches';
import type { DynCols } from '../DynamicColumns';

interface Props {
  groupId: string;
  name: string;
  colorId?: string;
  optionsJson?: string | null;
  itemCount: number;
  isExpanded: boolean;
  isNone: boolean;
  onToggle: () => void;
  groupDynCols: DynCols;
  /** Total column count in the parent <table>. When provided, renders as <tr><td colSpan> (table mode).
   *  When omitted, renders as a plain sticky <div> (legacy CSS Grid mode). */
  colSpan?: number;
  itemIds?: string[];
  selectedIds?: Set<string>;
  onToggleSelectAll?: (ids: string[], select: boolean) => void;
  onDragStart?: (groupId: string) => void;
  onDragOver?: (e: React.DragEvent, groupId: string) => void;
  onDragEnd?: () => void;
  onDrop?: (e: React.DragEvent, groupId: string) => void;
  isDragOver?: boolean;
  onDuplicateGroup?: () => void;
  onGroupStructureChanged?: () => void;
  linkedEventInfo?: { eventName?: string; eventDate?: string; durationHours?: number; location?: string };
  projectCode?: string;
  onLinkEvent?: (calBoardId: string, eventId: string) => Promise<void>;
  onUnlinkEvent?: () => Promise<void>;
  onCreateEventForGroup?: () => Promise<void>;
  onSendTimeline?: () => void;
  onPreviewTimeline?: () => void;
  timelineStatus?: string;
  timelineUrl?: string;
  timelineLoading?: boolean;
  showPublicName?: boolean;
}

export function GroupSectionHeader({
  groupId, name, colorId, optionsJson, itemCount, isExpanded, isNone,
  onToggle, groupDynCols, colSpan, itemIds, selectedIds, onToggleSelectAll,
  onDragStart, onDragOver, onDragEnd, onDrop, isDragOver, onDuplicateGroup, onGroupStructureChanged,
  linkedEventInfo, projectCode, onLinkEvent, onUnlinkEvent, onCreateEventForGroup,
  onSendTimeline, onPreviewTimeline, timelineStatus, timelineUrl, timelineLoading,
  showPublicName = false,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [editVal, setEditVal] = useState('');
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const color = isNone ? 'hsl(var(--muted-foreground))' : getGroupColor(colorId);

  // ── Public name (alias for external shared views) ──────────────────────────
  const parseOptions = (json?: string | null): Record<string, unknown> => {
    if (!json) return {};
    try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
  };

  const existingOptions = parseOptions(optionsJson);
  const initialPubName = typeof existingOptions.publicName === 'string' ? existingOptions.publicName : '';
  const linkedCalEvent = existingOptions.linkedCalEvent as { calBoardId?: string; eventId?: string } | undefined;
  const [pubName, setPubName] = useState(initialPubName);

  // Sync when parent updates optionsJson (e.g. after save propagates back)
  useEffect(() => {
    const opts = parseOptions(optionsJson);
    setPubName(typeof opts.publicName === 'string' ? opts.publicName : '');
  }, [optionsJson]);

  const savePublicName = (val: string) => {
    const opts = parseOptions(optionsJson);
    const trimmed = val.trim();
    if (trimmed) {
      opts.publicName = trimmed;
    } else {
      delete opts.publicName;
    }
    groupDynCols.updateColumn(groupId, { optionsJson: JSON.stringify(opts) });
  };

  const COLOR_ID_TO_VAR: Record<string, string> = {
    'red-1': '--group-red-1', 'red-2': '--group-red-2', 'red-3': '--group-red-3', 'red-4': '--group-red-4', 'red-5': '--group-red-5',
    'orange-1': '--group-orange-1', 'orange-2': '--group-orange-2', 'orange-3': '--group-orange-3', 'orange-4': '--group-orange-4', 'orange-5': '--group-orange-5',
    'yellow-1': '--group-yellow-1', 'yellow-2': '--group-yellow-2', 'yellow-3': '--group-yellow-3', 'yellow-4': '--group-yellow-4', 'yellow-5': '--group-yellow-5',
    'green-1': '--group-green-1', 'green-2': '--group-green-2', 'green-3': '--group-green-3', 'green-4': '--group-green-4', 'green-5': '--group-green-5',
    'blue-1': '--group-blue-1', 'blue-2': '--group-blue-2', 'blue-3': '--group-blue-3', 'blue-4': '--group-blue-4', 'blue-5': '--group-blue-5',
    'purple-1': '--group-purple-1', 'purple-2': '--group-purple-2', 'purple-3': '--group-purple-3', 'purple-4': '--group-purple-4', 'purple-5': '--group-purple-5',
    chart1: '--group-blue-2', chart2: '--group-green-2', chart3: '--group-orange-2',
    chart4: '--group-purple-2', chart5: '--group-blue-1', primary: '--group-blue-3',
    destructive: '--group-red-3', muted: '--group-blue-5',
    'group-pink': '--group-red-1', 'group-yellow': '--group-yellow-2', 'group-lime': '--group-green-1',
    'group-teal': '--group-green-3', 'group-indigo': '--group-blue-4', 'group-amber': '--group-orange-2',
    'group-rose': '--group-red-2', 'group-emerald': '--group-green-2', 'group-sky': '--group-blue-1',
    'group-violet': '--group-purple-2', 'group-fuchsia': '--group-purple-1', 'group-slate': '--group-blue-5',
  };
  const cssVar = COLOR_ID_TO_VAR[colorId ?? ''] ?? '--muted-foreground';
  const pastelBg = isNone
    ? 'hsl(var(--card))'
    : `color-mix(in srgb, hsl(var(${cssVar})) 12%, hsl(var(--card)))`;

  // ── Linked event schedule line ─────────────────────────────────────────────
  const CDMX_TZ = 'America/Mexico_City';
  const eventScheduleLine = (() => {
    if (!linkedEventInfo?.eventDate) return null;
    try {
      const d = new Date(linkedEventInfo.eventDate);
      // Force CDMX timezone for consistent display across all users
      const rawDate = new Intl.DateTimeFormat('es-MX', {
        timeZone: CDMX_TZ, weekday: 'short', day: 'numeric', month: 'short',
      }).format(d);
      const datePart = rawDate.replace(/\./g, '').replace(/\s+/g, ' ').trim();
      const rawTime = new Intl.DateTimeFormat('es-MX', {
        timeZone: CDMX_TZ, hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(d);
      const timePart = rawTime
        .replace(/\s*a\.\s*m\./i, ' AM')
        .replace(/\s*p\.\s*m\./i, ' PM')
        .trim();
      const durPart = linkedEventInfo.durationHours != null
        ? (linkedEventInfo.durationHours < 1
          ? `${Math.round(linkedEventInfo.durationHours * 60)} min`
          : `${linkedEventInfo.durationHours} hrs`)
        : null;
      const locPart = linkedEventInfo.location?.trim() || null;
      return ['📅 ' + datePart, timePart, durPart, locPart].filter(Boolean).join(' · ');
    } catch { return null; }
  })();

  const commitRename = async () => {
    const n = editVal.trim();
    if (n && n !== name) {
      try {
        await groupDynCols.renameColumn(groupId, n);
        onGroupStructureChanged?.();
      } catch { /* keep existing behavior */ }
    }
    setRenaming(false);
  };

  // ── Link event dialog ──────────────────────────────────────────────────────
  const linkDialog = projectCode && !isNone ? (
    <LinkEventDialog
      open={linkDialogOpen}
      onOpenChange={setLinkDialogOpen}
      projectCode={projectCode}
      currentLink={linkedCalEvent?.calBoardId && linkedCalEvent?.eventId
        ? { calBoardId: linkedCalEvent.calBoardId, eventId: linkedCalEvent.eventId }
        : undefined}
      onLink={async (calBoardId, eventId) => { await onLinkEvent?.(calBoardId, eventId); }}
      onUnlink={async () => { await onUnlinkEvent?.(); }}
    />
  ) : null;

  // Inner content is shared between both rendering modes
  const inner = (
    <div
      className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none w-full min-w-0"
      onClick={onToggle}
    >
      {/* Drag handle */}
      {!isNone && (
        <div
          draggable
          onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(groupId); }}
          onDragEnd={() => onDragEnd?.()}
          onClick={e => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors flex-shrink-0"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Select-all checkbox */}
      {itemIds && selectedIds && onToggleSelectAll && itemIds.length > 0 && (
        <div onClick={e => e.stopPropagation()} className="flex-shrink-0">
          <Checkbox
            checked={itemIds.length > 0 && itemIds.every(id => selectedIds.has(id))}
            onCheckedChange={checked => onToggleSelectAll(itemIds, !!checked)}
            className="h-3.5 w-3.5"
          />
        </div>
      )}

      <span className="text-muted-foreground flex-shrink-0">
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </span>
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />

      {/* Name + alias stacked */}
      <div className="flex flex-col min-w-0 overflow-hidden flex-1">
        {renaming ? (
          <input
            autoFocus
            value={editVal}
            onChange={e => setEditVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
            onClick={e => e.stopPropagation()}
            className="bg-transparent border-0 outline-none font-black text-sm min-w-[200px] leading-tight"
          />
        ) : (
          <span
            className={`font-black text-sm truncate leading-tight ${!isNone ? 'cursor-text hover:opacity-70 transition-opacity' : ''}`}
            title={name}
            onClick={!isNone ? e => { e.stopPropagation(); setEditVal(name); setRenaming(true); } : undefined}
          >
            {name}
          </span>
        )}
        {showPublicName && pubName && !renaming && (
          <span className="text-[10px] text-muted-foreground/55 truncate leading-tight" title={`Alias público: ${pubName}`}>
            🔗 {pubName}
          </span>
        )}
      </div>

      <span className="text-xs text-muted-foreground bg-background border border-border/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
        {itemCount}
      </span>

      {/* Event schedule badge — shown inline to the right of the count */}
      {!isNone && eventScheduleLine && !renaming && (
        <span
          className="text-xs font-bold text-foreground whitespace-nowrap flex-shrink truncate min-w-0 px-2 py-0.5 rounded-full bg-background/60 border border-border/30"
          title={eventScheduleLine}
        >
          {eventScheduleLine}
        </span>
      )}



      {/* ── Timeline button ── */}
      {!isNone && onSendTimeline && (
        <div className="opacity-0 group-hover/gh:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
          {timelineLoading ? (
            <div className="p-1 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /></div>
          ) : timelineStatus === 'Listo' && timelineUrl ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors">
                  <BarChart2 className="w-3.5 h-3.5" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1.5">
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => window.open(timelineUrl, '_blank')}>
                  <ExternalLink className="w-3.5 h-3.5" /> Ver archivo
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onPreviewTimeline?.()}>
                  <Eye className="w-3.5 h-3.5" /> Preview
                </DropdownMenuItem>
                <div className="my-1 border-t border-border/40" />
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onSendTimeline}>
                  <RefreshCw className="w-3.5 h-3.5" /> Actualizar timeline
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : timelineStatus === 'Error' ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="relative p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors" onClick={onSendTimeline}>
                    <BarChart2 className="w-3.5 h-3.5" />
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Error al generar — click para reintentar</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors" onClick={onSendTimeline}>
                    <BarChart2 className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">Crear / actualizar timeline</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {/* ── 3-dot action menu ── */}
      {!isNone && (
        <div className="opacity-0 group-hover/gh:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 p-1.5">
              {/* Color picker */}
              <div className="px-2 pb-2 pt-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Color del grupo</p>
                <ColorSwatches currentId={colorId} onPick={id => groupDynCols.updateColumn(groupId, { columnType: id })} />
              </div>

              {/* Nombre público — solo en tablero de reclutamiento */}
              {showPublicName && (
                <>
                  <div className="my-1 border-t border-border/40" />
                  <div className="px-2 py-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Nombre público</p>
                    <input
                      type="text"
                      value={pubName}
                      onChange={e => setPubName(e.target.value)}
                      onBlur={() => savePublicName(pubName)}
                      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      onClick={e => e.stopPropagation()}
                      placeholder="Ej: Grupo 1 - Jue 23 mayo"
                      className="w-full text-xs bg-muted/50 border border-border/50 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/40"
                    />
                    <p className="text-[9px] text-muted-foreground/50 mt-1 leading-tight">
                      Nombre visible para reclutadores externos (oculta el perfil)
                    </p>
                  </div>
                </>
              )}

              {/* Vincular / desvincular evento */}
              {(onLinkEvent || onUnlinkEvent) && (
                <>
                  <div className="my-1 border-t border-border/40" />
                  {linkedCalEvent?.eventId ? (
                    <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => setLinkDialogOpen(true)}>
                      <Unlink className="w-3.5 h-3.5 text-muted-foreground" /> Desvincular evento 📅
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => setLinkDialogOpen(true)}>
                        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" /> Vincular a evento 📅
                      </DropdownMenuItem>
                      {onCreateEventForGroup && (
                        <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => onCreateEventForGroup()}>
                          <Plus className="w-3.5 h-3.5 text-muted-foreground" /> Crear evento nuevo 📅
                        </DropdownMenuItem>
                      )}
                    </>
                  )}
                </>
              )}

              <div className="my-1 border-t border-border/40" />
              <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => { setEditVal(name); setRenaming(true); }}>
                <Pencil className="w-3.5 h-3.5" /> Renombrar
              </DropdownMenuItem>
              {onDuplicateGroup && (
                <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={onDuplicateGroup}>
                  <Copy className="w-3.5 h-3.5" /> Duplicar grupo
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive"
                onClick={async () => { try { await groupDynCols.removeColumn(groupId); onGroupStructureChanged?.(); } catch { /* keep existing behavior */ } }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Eliminar grupo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  // ── Table mode: renders as <tr><td colSpan> with sticky top:33px ─────────
  if (colSpan !== undefined) {
    return (
      <>
        <tr
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); onDragOver?.(e, groupId); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); onDrop?.(e, groupId); }}
        >
          <td
            colSpan={colSpan}
            className={`group/gh p-0 transition-all duration-150${isDragOver ? ' ring-2 ring-inset ring-primary' : ''}`}
            style={{
              position: 'sticky',
              top: 33,
              zIndex: 20,
              background: isDragOver ? `color-mix(in srgb, hsl(var(--primary)) 10%, ${pastelBg})` : pastelBg,
              borderLeft: isDragOver ? `4px solid hsl(var(--primary))` : `4px solid ${color}`,
              borderBottom: '1px solid hsl(var(--border) / 0.2)',
              boxShadow: isDragOver ? 'inset 0 0 0 1px hsl(var(--primary) / 0.4)' : undefined,
            }}
          >
            <div style={{ position: 'sticky', left: 0, width: 'fit-content', maxWidth: '100vw' }}>
              {inner}
            </div>
          </td>
        </tr>
        {linkDialog}
      </>
    );
  }

  // ── Legacy mode: renders as a sticky <div> (CSS Grid / PMPage) ───────────
  return (
    <>
      <div
        className={`sticky top-[33px] z-20 border-b border-border/20 group/gh${isDragOver ? ' ring-2 ring-inset ring-primary' : ''}`}
        style={{ borderLeft: `4px solid ${color}`, background: pastelBg }}
        onDragOver={e => { e.preventDefault(); onDragOver?.(e, groupId); }}
        onDrop={e => { e.preventDefault(); onDrop?.(e, groupId); }}
      >
        {inner}
      </div>
      {linkDialog}
    </>
  );
}
