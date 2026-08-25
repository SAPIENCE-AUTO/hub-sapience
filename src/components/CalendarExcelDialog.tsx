import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CalendarDays, CheckSquare, Square, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { getCalendarExcelColumns, sendCalendarToWebhook, GetCalendarExcelColumnsOutputType } from 'zite-endpoints-sdk';

type Column = GetCalendarExcelColumnsOutputType['columns'][0];

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

const COL_TYPE_LABELS: Record<string, string> = {
  datetime:     '📅 Fecha',
  date:         '📅 Fecha',
  time:         '🕐 Hora',
  numbers:      '🔢 Número',
  number:       '🔢 Número',
  text:         '📝 Texto',
  status:       '🏷️ Status',
  dropdown:     '▾ Select',
  people:       '👤 Persona',
  color_picker: '🎨 Color',
};

function colTypeLabel(type: string) {
  return COL_TYPE_LABELS[type] ?? type;
}

function buildFileName(fullName: string, tematica: string, docName: string, version: string): string {
  const parts = [fullName, tematica, docName].filter(Boolean);
  return `${parts.join(' - ')} - V${version || '?'}`;
}

export function CalendarExcelDialog({ open, onOpenChange, projectCode, calendarName, boardId, projectFullName = '', projectTematica = '', onSuccess }: Props) {
  const [loadingCols, setLoadingCols] = useState(false);
  const [columns, setColumns]         = useState<Column[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sending, setSending]         = useState(false);
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [versionInput, setVersionInput] = useState('');

  useEffect(() => {
    if (!open || !projectCode || (!calendarName && !boardId)) return;
    setLoadingCols(true);
    getCalendarExcelColumns({ projectCode, calendarName, ...(boardId ? { boardId } : {}) })
      .then(res => {
        setColumns(res.columns);
        setSelectedIds(new Set(res.selectedIds));
        setNextVersion(res.nextVersion);
        setVersionInput(String(res.nextVersion));
      })
      .catch(() => toast.error('Error al cargar las columnas'))
      .finally(() => setLoadingCols(false));
  }, [open, projectCode, calendarName]);

  // ── Selection ──────────────────────────────────────────────────────────
  const toggleAll = () => {
    if (selectedIds.size === columns.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(columns.map(c => c.id)));
    }
  };

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Reorder ────────────────────────────────────────────────────────────
  const moveUp = (index: number) => {
    if (index === 0) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    setColumns(prev => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  };

  // ── Send ───────────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (selectedIds.size === 0) {
      toast.error('Selecciona al menos una columna');
      return;
    }
    setSending(true);
    try {
      const res = await sendCalendarToWebhook({
        projectCode,
        calendarName,
        ...(boardId ? { boardId } : {}),
        columnOrder:       columns.map(c => c.id),
        selectedColumnIds: [...selectedIds],
        overrideVersion:   versionInput.trim() || undefined,
      });
      if (res.calendarStatus === 'Listo') {
        if (res.excelBase64) {
          const a = document.createElement('a');
          a.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${res.excelBase64}`;
          a.download = `${previewName}.xlsx`;
          a.click();
        }
        toast.success(`✅ Calendario V${res.version} listo — ${res.eventCount} evento${res.eventCount !== 1 ? 's' : ''}${res.fileUrl ? ' · subido a SharePoint' : ''}`);
        onSuccess({ status: res.calendarStatus, fileUrl: res.fileUrl, eventCount: res.eventCount, version: res.version });
        onOpenChange(false);
      } else {
        toast.error('n8n procesó el calendario pero reportó un error.');
        onSuccess({ status: res.calendarStatus, eventCount: res.eventCount, version: res.version });
        onOpenChange(false);
      }
    } catch {
      toast.error('Error al enviar el calendario');
    } finally {
      setSending(false);
    }
  };

  const allSelected  = columns.length > 0 && selectedIds.size === columns.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < columns.length;
  const previewName  = buildFileName(projectFullName, projectTematica, calendarName, versionInput || String(nextVersion ?? '?'));

  return (
    <Dialog open={open} onOpenChange={v => { if (!sending) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="w-4 h-4 text-primary" />
            Crear calendario Excel
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* File preview */}
          <div className="rounded-lg bg-muted px-3 py-2.5 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Vista previa del nombre
            </p>
            <p className="text-[13px] font-mono text-foreground break-all leading-snug">
              📄 {previewName}
            </p>
          </div>

          {/* Version input */}
          <div className="space-y-1">
            <Label className="text-xs">Versión</Label>
            <Input
              value={versionInput}
              onChange={e => setVersionInput(e.target.value)}
              placeholder={String(nextVersion ?? 1)}
              className="h-8 text-sm"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Selecciona y ordena las columnas. Usa ▲▼ para cambiar el orden en el Excel.
          </p>

          {loadingCols ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {/* Select all header */}
              <button
                className="w-full flex items-center gap-3 px-3 py-2 bg-muted/50 hover:bg-muted transition-colors border-b border-border text-left"
                onClick={toggleAll}
              >
                {allSelected
                  ? <CheckSquare className="w-4 h-4 text-primary flex-shrink-0" />
                  : someSelected
                    ? <div className="w-4 h-4 rounded border-2 border-primary bg-primary/20 flex-shrink-0" />
                    : <Square className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                <span className="text-xs font-semibold text-foreground">
                  {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {selectedIds.size}/{columns.length}
                </span>
              </button>

              {/* Column list */}
              <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
                {columns.map((col, index) => (
                  <div
                    key={col.id}
                    className="flex items-center gap-2 px-2 py-2 hover:bg-muted/30 transition-colors"
                  >
                    {/* Order buttons */}
                    <div className="flex flex-col flex-shrink-0">
                      <button
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveDown(index)}
                        disabled={index === columns.length - 1}
                        className="p-0.5 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Order number */}
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums w-4 text-right flex-shrink-0">
                      {index + 1}
                    </span>

                    {/* Checkbox + label */}
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <Checkbox
                        checked={selectedIds.has(col.id)}
                        onCheckedChange={() => toggle(col.id)}
                        className="h-3.5 w-3.5 flex-shrink-0"
                      />
                      <span className={`text-sm flex-1 truncate ${selectedIds.has(col.id) ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {col.title}
                      </span>
                    </label>

                    {/* Type badge */}
                    <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                      {colTypeLabel(col.type)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || loadingCols || selectedIds.size === 0}
            className="gap-1.5"
          >
            {sending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Procesando...</>
              : <><CalendarDays className="w-3.5 h-3.5" /> Generar Excel V{versionInput || nextVersion}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
