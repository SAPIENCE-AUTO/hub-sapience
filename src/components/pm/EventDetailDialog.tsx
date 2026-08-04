import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Eye, ExternalLink, RefreshCw, Loader2, Link2, Unlink, X } from 'lucide-react';
import { toast } from 'sonner';
import { saveCalendarEvent, linkGroupToEvent, GetRecruitmentGroupsOutputType } from 'zite-endpoints-sdk';
import type { CalEvent } from './pmTypes';
import type { DynCols } from '../DynamicColumns';
import { EventFormFields, EventFormValues, EMPTY_EVENT_FORM, PRESET_LOCS } from './EventFormFields';

type RecGroup = GetRecruitmentGroupsOutputType['groups'][0];

const invStatusColors: Record<string, string> = {
  'Enviado': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Por actualizar': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'Por crear': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Cancelado': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

interface EventDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingEvent: CalEvent | null;
  calBoardId: string;
  presetLocs?: string[];
  calDynCols: DynCols;
  recGroups: RecGroup[];
  recGroupsLoading: boolean;
  linkingGroup: boolean;
  setLinkingGroup: (v: boolean) => void;
  outlookSyncing: boolean;
  htmlPreviewOpen: boolean;
  setHtmlPreviewOpen: (v: boolean) => void;
  onOutlookSync: (action: 'create' | 'update' | 'cancel') => void;
  onRecGroupsRefresh: () => void;
  onInviteStatusChanged?: (evId: string) => void;
  onSaved: () => void;
}

export function EventDetailDialog({
  open, onOpenChange,
  editingEvent,
  calBoardId,
  presetLocs = PRESET_LOCS,
  calDynCols,
  recGroups, recGroupsLoading,
  linkingGroup, setLinkingGroup,
  outlookSyncing,
  htmlPreviewOpen, setHtmlPreviewOpen,
  onOutlookSync,
  onRecGroupsRefresh,
  onInviteStatusChanged,
  onSaved,
}: EventDetailDialogProps) {
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  const [saving, setSaving] = useState(false);

  // ── Initialize form from event + calDynCols when opening ─────────────────
  useEffect(() => {
    if (!open || !editingEvent) return;
    const ev = editingEvent;

    const colByName = (name: string, excludeType?: string) =>
      calDynCols.columns.find(c => c.columnName === name && (!excludeType || c.columnType !== excludeType));

    const getTextVal = (name: string, excludeType?: string): string => {
      const col = colByName(name, excludeType);
      return (col ? calDynCols.getCellVal(ev.id, col.id)?.textValue : undefined) ?? '';
    };

    // Native first, CellValue as fallback
    const dateCol = colByName('Fecha y hora');
    const dateVal = ev.eventDate ?? (dateCol ? calDynCols.getCellVal(ev.id, dateCol.id)?.dateValue : undefined) ?? '';

    // Native first, CellValue as fallback
    const durCol = colByName('Duración (hrs)');
    const durVal = ev.durationHours ?? (durCol ? calDynCols.getCellVal(ev.id, durCol.id)?.numberValue : undefined) ?? 1;

    // Native first, CellValue as fallback
    const locCol =
      colByName('Ubicación Interna') ??
      colByName('Ubicación (interna)') ??
      colByName('Espacio');
    const locationVal = ev.location ?? (locCol ? calDynCols.getCellVal(ev.id, locCol.id)?.textValue : undefined) ?? '';
    const isCustomLoc = !!locationVal && !presetLocs.slice(0, -1).includes(locationVal); // exclude 'Otro'

    setForm({
      eventDate: dateVal,
      durationHours: durVal,
      location: locationVal,
      locationCustom: isCustomLoc,
      inviteEmails: ev.inviteEmails ?? '',
      dinamica: getTextVal('Dinámica'),
      perfil: getTextVal('Perfil'),
      descripcion: getTextVal('Descripción'),
      detallesAdicionales: getTextVal('Detalles adicionales'),
      detallesAdicionales2: getTextVal('Detalles adicionales 2'),
      direccion: getTextVal('Ubicación', 'Select'),
      link: getTextVal('Link'),
      notes: ev.notes ?? '',
      restringirReenvio: (ev as any).restringirReenvio ?? false,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingEvent?.id]);

  const handleChange = (field: keyof EventFormValues, value: string | boolean | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!editingEvent) return;
    setSaving(true);
    try {
      const res = await saveCalendarEvent({
        id: editingEvent.id,
        eventDate: form.eventDate || undefined,
        durationHours: form.durationHours > 0 ? form.durationHours : undefined,
        location: form.location || undefined,
        inviteEmails: form.inviteEmails || undefined,
        notes: form.notes || undefined,
        dinamica: form.dinamica || undefined,
        perfil: form.perfil || undefined,
        descripcion: form.descripcion || undefined,
        detallesAdicionales: form.detallesAdicionales || undefined,
        detallesAdicionales2: form.detallesAdicionales2 || undefined,
        direccion: form.direccion || undefined,
        link: form.link || undefined,
        restringirReenvio: form.restringirReenvio,
      });
      if (res.inviteStatusChanged) onInviteStatusChanged?.(editingEvent.id);
      toast.success('Guardado ✓');
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error('Error al guardar');
    }
    setSaving(false);
  };

  const linkedGroup = recGroups.find(g => g.linkedEventId === editingEvent?.id);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="truncate pr-4 text-base">{editingEvent?.eventName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-0 py-1 max-h-[60vh] overflow-y-auto pr-1">
            {/* ── Form Fields ── */}
            <EventFormFields values={form} onChange={handleChange} presetLocs={presetLocs} />

            {/* ── Grupo de reclutamiento ── */}
            <div className="border-t border-border/40 pt-3 mt-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                <Label className="text-xs font-semibold">Grupo de reclutamiento</Label>
              </div>
              {recGroupsLoading ? (
                <div className="text-xs text-muted-foreground/60 italic">Cargando grupos...</div>
              ) : linkedGroup ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/8 border border-primary/20">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{linkedGroup.groupName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{linkedGroup.boardName}</p>
                  </div>
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                    disabled={linkingGroup}
                    onClick={async () => {
                      if (!editingEvent) return;
                      setLinkingGroup(true);
                      try {
                        await linkGroupToEvent({
                          groupColumnId: linkedGroup.groupId,
                          recruitmentBoardId: linkedGroup.recruitmentBoardId,
                          calendarBoardId: linkedGroup.linkedCalBoardId ?? calBoardId,
                          eventId: editingEvent.id,
                          unlink: true,
                        });
                        onRecGroupsRefresh();
                        toast.success('Grupo desvinculado');
                      } catch { toast.error('Error al desvincular'); }
                      setLinkingGroup(false);
                    }}
                  >
                    <Unlink className="w-3 h-3" /> Desvincular
                  </button>
                </div>
              ) : recGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 italic">No hay grupos en este proyecto.</p>
              ) : (
                <Select
                  value=""
                  onValueChange={async (groupId) => {
                    if (!groupId || !editingEvent) return;
                    const group = recGroups.find(g => g.groupId === groupId);
                    if (!group) return;
                    setLinkingGroup(true);
                    try {
                      await linkGroupToEvent({
                        groupColumnId: group.groupId,
                        recruitmentBoardId: group.recruitmentBoardId,
                        calendarBoardId: calBoardId,
                        eventId: editingEvent.id,
                      });
                      onRecGroupsRefresh();
                      toast.success(`Vinculado a "${group.groupName}"`);
                    } catch { toast.error('Error al vincular'); }
                    setLinkingGroup(false);
                  }}
                >
                  <SelectTrigger className="text-sm h-8" disabled={linkingGroup}>
                    <SelectValue placeholder={linkingGroup ? 'Vinculando...' : 'Seleccionar grupo...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {recGroups.map(g => (
                      <SelectItem key={g.groupId} value={g.groupId}>
                        <span className="text-muted-foreground text-xs mr-1">{g.boardName} ›</span>
                        {g.groupName}
                        {g.linkedEventId && g.linkedEventId !== editingEvent?.id && (
                          <span className="ml-1 text-[10px] text-muted-foreground/50">(vinculado)</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* ── Outlook sync ── */}
            <div className="border-t border-border/40 pt-3 mt-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Outlook</span>
                  {editingEvent?.inviteStatus && (() => {
                    const cls = invStatusColors[editingEvent.inviteStatus] ?? 'bg-muted text-muted-foreground';
                    return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{editingEvent.inviteStatus}</span>;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  {editingEvent?.inviteBodyHtml && (
                    <button onClick={() => setHtmlPreviewOpen(true)}
                      className="text-[11px] font-medium text-primary hover:underline flex items-center gap-1">
                      <Eye className="w-3 h-3" /> Vista previa
                    </button>
                  )}
                  {editingEvent?.outlookEventLink && (
                    <a href={editingEvent.outlookEventLink} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <ExternalLink className="w-3 h-3" /> Ver en Outlook
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1"
                  onClick={() => onOutlookSync(editingEvent?.outlookEventId ? 'update' : 'create')}
                  disabled={outlookSyncing}>
                  {outlookSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  {editingEvent?.outlookEventId ? 'Actualizar invitación' : 'Crear invitación'}
                </Button>
                {editingEvent?.outlookEventId && (
                  <Button size="sm" variant="ghost"
                    className="h-7 text-xs gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => onOutlookSync('cancel')} disabled={outlookSyncing}>
                    <X className="w-3 h-3" /> Cancelar invitación
                  </Button>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Guardando…</> : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HTML invite preview dialog */}
      <Dialog open={htmlPreviewOpen} onOpenChange={setHtmlPreviewOpen}>
        <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
            <DialogTitle className="text-sm font-semibold">Vista previa del email — {editingEvent?.eventName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            {editingEvent?.inviteBodyHtml ? (
              <iframe srcDoc={editingEvent.inviteBodyHtml} className="w-full h-full border-0"
                title="Vista previa del email de Outlook" sandbox="allow-same-origin" />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Sin contenido HTML disponible</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
