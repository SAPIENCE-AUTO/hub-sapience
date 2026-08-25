import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CalendarDays, CheckSquare, Square, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { getCalendarExcelPreview, sendCalendarToWebhook } from 'zite-endpoints-sdk';
import { getGroupColor } from './table/tableUtils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  calendarName: string;
  boardId?: string;
  projectFullName?: string;
  projectTematica?: string;
  onSuccess: (result: { status?: string; fileUrl?: string; eventCount: number; version?: string }) => void;
}

interface PreviewColumn { id: string; key: string; title: string; type: string; optionsJson?: string | null }
interface PreviewGroup { groupId: string; groupName: string; colorId: string | null; rows: Record<string, string | number>[] }

const COL_TYPE_LABELS: Record<string, string> = {
  datetime: '📅 Fecha', date: '📅 Fecha', time: '🕐 Hora', numbers: '🔢 Número', number: '🔢 Número',
  text: '📝 Texto', status: '🏷️ Status', dropdown: '▾ Select', people: '👤 Persona', color_picker: '🎨 Color',
};
const colTypeLabel = (t: string) => COL_TYPE_LABELS[t] ?? t;

// Mismo código de color que el .xlsx real (calendarExcelBuilder.ts) — aquí en hex plano
// porque es solo CSS, no ARGB de ExcelJS.
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Por realizar': { bg: '#DBEAFE', text: '#1D4ED8' },
  'Realizada': { bg: '#E5E7EB', text: '#6B7280' },
  'Reprogramada': { bg: '#FEF3C7', text: '#92400E' },
  'Caída': { bg: '#FEE2E2', text: '#991B1B' },
  'Cancelada': { bg: '#FEE2E2', text: '#B91C1C' },
  'Reposición': { bg: '#EDE9FE', text: '#5B21B6' },
};

function buildFileName(fullName: string, tematica: string, docName: string, version: string): string {
  const parts = [fullName, tematica, docName].filter(Boolean);
  return `${parts.join(' - ')} - V${version || '?'}`;
}

export function CalendarExcelDialog({ open, onOpenChange, projectCode, calendarName, boardId, projectFullName = '', projectTematica = '', onSuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [calendarTitle, setCalendarTitle] = useState('');
  const [allColumns, setAllColumns] = useState<PreviewColumn[]>([]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<PreviewGroup[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [versionInput, setVersionInput] = useState('');
  const [sending, setSending] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectCode || (!calendarName && !boardId)) return;
    setLoading(true);
    getCalendarExcelPreview({ projectCode, calendarName, ...(boardId ? { boardId } : {}) })
      .then(res => {
        setCalendarTitle(res.calendarTitle);
        setAllColumns(res.columns);
        setOrderedIds(res.order);
        setSelectedIds(new Set(res.selectedIds));
        setGroups(res.groups);
        setEventCount(res.eventCount);
        setNextVersion(res.nextVersion);
        setVersionInput(String(res.nextVersion));
      })
      .catch(() => toast.error('Error al cargar el preview del calendario'))
      .finally(() => setLoading(false));
  }, [open, projectCode, calendarName, boardId]);

  const colById = useMemo(() => new Map(allColumns.map(c => [c.id, c])), [allColumns]);
  const orderedColumns = useMemo(
    () => orderedIds.map(id => colById.get(id)).filter((c): c is PreviewColumn => !!c),
    [orderedIds, colById],
  );
  const visibleColumns = useMemo(() => orderedColumns.filter(c => selectedIds.has(c.id)), [orderedColumns, selectedIds]);

  // ── Selección ──────────────────────────────────────────────────────────
  const toggleAll = () => setSelectedIds(prev => (prev.size === allColumns.length ? new Set() : new Set(allColumns.map(c => c.id))));
  const toggle = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Reordenar por drag — mismo patrón nativo (draggable + onDragStart/Over/Drop)
  // que ya usa GroupSectionHeader.tsx para arrastrar grupos en Reclutamiento/PM. ──
  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    setOrderedIds(prev => {
      const next = [...prev];
      const from = next.indexOf(dragId);
      const to = next.indexOf(targetId);
      if (from === -1 || to === -1) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragId);
      return next;
    });
    setDragId(null);
    setDragOverId(null);
  };

  // ── Enviar ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (selectedIds.size === 0) { toast.error('Selecciona al menos una columna'); return; }
    setSending(true);
    try {
      const res = await sendCalendarToWebhook({
        projectCode,
        calendarName,
        ...(boardId ? { boardId } : {}),
        columnOrder: orderedIds,
        selectedColumnIds: [...selectedIds],
        overrideVersion: versionInput.trim() || undefined,
      });
      if (res.calendarStatus === 'Listo') {
        // Solo se descarga local cuando no hay canal de Teams al cual subirlo.
        if (res.excelBase64 && !res.fileUrl) {
          const a = document.createElement('a');
          a.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${res.excelBase64}`;
          a.download = `${previewName}.xlsx`;
          a.click();
        }
        toast.success(`✅ Calendario V${res.version} listo — ${res.eventCount} evento${res.eventCount !== 1 ? 's' : ''}${res.fileUrl ? ' · subido a SharePoint' : ''}`);
        onSuccess({ status: res.calendarStatus, fileUrl: res.fileUrl, eventCount: res.eventCount, version: res.version });
        onOpenChange(false);
      } else {
        toast.error('Hubo un error generando el calendario.');
        onSuccess({ status: res.calendarStatus, eventCount: res.eventCount, version: res.version });
        onOpenChange(false);
      }
    } catch {
      toast.error('Error al generar el calendario');
    } finally {
      setSending(false);
    }
  };

  const allSelected = allColumns.length > 0 && selectedIds.size === allColumns.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < allColumns.length;
  const previewName = buildFileName(projectFullName, projectTematica, calendarName, versionInput || String(nextVersion ?? '?'));
  const namedGroupCount = groups.filter(g => g.groupId !== 'ungrouped' && g.rows.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-4 h-4 text-primary" />
            Crear calendario Excel
          </DialogTitle>
          <DialogDescription>Elige, ordena y arrastra las columnas — el preview de la derecha se actualiza al instante.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid grid-cols-[320px_1fr] gap-4">
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
            <Skeleton className="h-[60vh] w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-[320px_1fr] gap-4 min-w-0">
            {/* ── Columna izquierda: picker ── */}
            <div className="flex flex-col gap-3 min-w-0">
              <div className="rounded-lg bg-muted px-3 py-2.5 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vista previa del nombre</p>
                <p className="text-[12px] font-mono text-foreground break-all leading-snug">📄 {previewName}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Versión</Label>
                <Input value={versionInput} onChange={e => setVersionInput(e.target.value)} placeholder={String(nextVersion ?? 1)} className="h-8 text-sm" />
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 px-3 py-2 bg-muted/50 hover:bg-muted transition-colors border-b border-border text-left"
                  onClick={toggleAll}
                >
                  {allSelected
                    ? <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                    : someSelected
                      ? <div className="w-4 h-4 rounded border-2 border-primary bg-primary/20 flex-shrink-0" />
                      : <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                  <span className="text-xs font-semibold text-foreground">{allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{selectedIds.size}/{allColumns.length}</span>
                </button>

                <div className="max-h-[52vh] overflow-y-auto divide-y divide-border/50">
                  {orderedColumns.map(col => (
                    <div
                      key={col.id}
                      draggable
                      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragId(col.id); }}
                      onDragOver={e => { e.preventDefault(); setDragOverId(col.id); }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                      onDrop={e => { e.preventDefault(); handleDrop(col.id); }}
                      className={`flex items-center gap-2 px-2 py-2 hover:bg-muted/30 transition-colors ${dragOverId === col.id && dragId !== col.id ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : ''} ${dragId === col.id ? 'opacity-40' : ''}`}
                    >
                      <span className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground flex-shrink-0">
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                        <Checkbox checked={selectedIds.has(col.id)} onCheckedChange={() => toggle(col.id)} className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className={`text-sm flex-1 truncate ${selectedIds.has(col.id) ? 'text-foreground' : 'text-muted-foreground'}`}>{col.title}</span>
                      </label>
                      <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">{colTypeLabel(col.type)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Columna derecha: preview en vivo ── */}
            <div className="border border-border rounded-lg overflow-hidden bg-white min-w-0">
              <div className="max-h-[70vh] overflow-auto">
                <CalendarPreviewPane calendarTitle={calendarTitle} eventCount={eventCount} groupCount={namedGroupCount} groups={groups} columns={visibleColumns} version={versionInput || String(nextVersion ?? 1)} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button size="sm" onClick={handleSend} disabled={sending || loading || selectedIds.size === 0} className="gap-1.5">
            {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando...</> : <><CalendarDays className="w-3.5 h-3.5" /> Generar Excel V{versionInput || nextVersion}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Preview en vivo — replica visual del .xlsx real (mismo masthead, secciones
// de grupo con su color real, texto envuelto, dropdown/código de color en Status). ──
function CalendarPreviewPane({ calendarTitle, eventCount, groupCount, groups, columns, version }: {
  calendarTitle: string; eventCount: number; groupCount: number; version: string;
  groups: PreviewGroup[]; columns: PreviewColumn[];
}) {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
  const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' });
  const font = "'Aptos', 'Calibri', 'Segoe UI', Arial, sans-serif";

  if (columns.length === 0) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Selecciona al menos una columna para ver el preview.</div>;
  }

  return (
    <table style={{ fontFamily: font, borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
      <colgroup>{columns.map(c => <col key={c.id} style={{ minWidth: 130 }} />)}</colgroup>
      <tbody>
        <tr>
          <td colSpan={columns.length} style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <img
                src="https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png"
                alt="Sapience"
                style={{ width: 150, height: 150 / (816 / 203), display: 'block' }}
              />
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F3D4C' }}>Calendario de Actividades — {calendarTitle}</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B7280' }}>
                  Actualizado el {fecha} a las {hora} · {eventCount} actividad{eventCount === 1 ? '' : 'es'}{groupCount > 0 ? ` · ${groupCount} grupo${groupCount === 1 ? '' : 's'}` : ''} · v{version}
                </p>
              </div>
            </div>
          </td>
        </tr>
        <tr><td colSpan={columns.length} style={{ padding: 0, height: 3, background: '#0F3D4C' }} /></tr>
        <tr>
          {columns.map(c => (
            <td key={c.id} style={{ background: '#0F3D4C', color: '#fff', fontWeight: 700, fontSize: 12, padding: '7px 10px', whiteSpace: 'nowrap' }}>
              {c.title}{c.optionsJson ? ' ▾' : ''}
            </td>
          ))}
        </tr>
        {groups.filter(g => g.rows.length > 0).map(g => (
          <PreviewGroupBlock key={g.groupId} group={g} columns={columns} />
        ))}
      </tbody>
    </table>
  );
}

function PreviewGroupBlock({ group, columns }: { group: PreviewGroup; columns: PreviewColumn[] }) {
  const color = group.colorId ? getGroupColor(group.colorId) : 'hsl(var(--muted-foreground))';
  const statusCol = columns.find(c => c.title === 'Status');
  return (
    <>
      <tr>
        <td colSpan={columns.length} style={{ background: color, padding: '6px 10px' }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 11, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>● {group.groupName}</span>
          <span style={{ color: '#fff', fontSize: 10, marginLeft: 6, opacity: 0.9, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>
            · {group.rows.length} actividad{group.rows.length === 1 ? '' : 'es'}
          </span>
        </td>
      </tr>
      {group.rows.map((row, i) => {
        const statusVal = statusCol ? row[statusCol.key] : undefined;
        const isDone = statusVal === 'Realizada';
        return (
          <tr key={i}>
            {columns.map(c => {
              const v = row[c.key] ?? '';
              const isStatus = c.id === statusCol?.id;
              const statusStyle = isStatus && typeof v === 'string' ? STATUS_STYLES[v] : undefined;
              return (
                <td
                  key={c.id}
                  style={{
                    fontSize: 9.5,
                    padding: '6px 10px',
                    border: '1px solid #E5E7EB',
                    background: statusStyle?.bg ?? '#fff',
                    color: statusStyle?.text ?? (isDone ? '#94A3B8' : '#2A3A41'),
                    fontWeight: c.key === 'dinamica' || statusStyle ? 700 : 400,
                    whiteSpace: 'normal',
                    overflowWrap: 'break-word',
                    verticalAlign: 'middle',
                  }}
                >
                  {v}
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
