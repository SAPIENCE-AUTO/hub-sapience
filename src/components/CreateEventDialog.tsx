import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CalendarPlus } from 'lucide-react';
import { getTasks, saveCalendarEvent, linkGroupToEvent } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { EventFormFields, EventFormValues, EMPTY_EVENT_FORM } from './pm/EventFormFields';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCode: string;
  groupId: string;
  groupName: string;
  recruitmentBoardId: string;
  onSuccess: () => void;
  calBoardObjects?: { id: string; name: string }[];
}

export function CreateEventDialog({ open, onOpenChange, projectCode, groupId, groupName, recruitmentBoardId, onSuccess, calBoardObjects: externalCalBoardObjects }: Props) {
  const [calBoardObjects, setCalBoardObjects] = useState<{ id: string; name: string }[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [eventName, setEventName] = useState(groupName);
  const [form, setForm] = useState<EventFormValues>(EMPTY_EVENT_FORM);

  useEffect(() => {
    if (!open) return;
    setEventName(groupName);
    setSelectedBoardId('');
    setForm(EMPTY_EVENT_FORM);

    // If external calBoardObjects provided, use them directly
    if (externalCalBoardObjects && externalCalBoardObjects.length > 0) {
      setCalBoardObjects(externalCalBoardObjects);
      if (externalCalBoardObjects.length === 1) setSelectedBoardId(externalCalBoardObjects[0].id);
      return;
    }

    setLoadingBoards(true);
    getTasks({ projectCode })
      .then(data => {
        const objs: { id: string; name: string }[] = (data as any).calendarBoardObjects ?? [];
        setCalBoardObjects(objs);
        if (objs.length === 1) setSelectedBoardId(objs[0].id);
      })
      .catch(() => toast.error('Error al cargar calendarios'))
      .finally(() => setLoadingBoards(false));
  }, [open, projectCode, groupName, externalCalBoardObjects]);

  const handleChange = (field: keyof EventFormValues, value: string | boolean | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const selectedObj = calBoardObjects.find(b => b.id === selectedBoardId);

  const handleSave = async () => {
    if (!selectedBoardId || !selectedObj) { toast.error('Selecciona un calendario'); return; }
    if (!eventName.trim()) { toast.error('El nombre del evento es requerido'); return; }

    setSaving(true);
    try {
      const res = await saveCalendarEvent({
        eventName: eventName.trim(),
        projectCode,
        calendarName: selectedObj.name,
        boardId: selectedBoardId,
        ...(form.eventDate     ? { eventDate: form.eventDate }                     : {}),
        ...(form.durationHours ? { durationHours: form.durationHours }             : {}),
        ...(form.location      ? { location: form.location }                       : {}),
        ...(form.inviteEmails  ? { inviteEmails: form.inviteEmails }               : {}),
        ...(form.notes         ? { notes: form.notes }                             : {}),
        ...(form.dinamica      ? { dinamica: form.dinamica }                       : {}),
        ...(form.perfil        ? { perfil: form.perfil }                           : {}),
        ...(form.descripcion   ? { descripcion: form.descripcion }                 : {}),
        ...(form.detallesAdicionales  ? { detallesAdicionales: form.detallesAdicionales }   : {}),
        ...(form.detallesAdicionales2 ? { detallesAdicionales2: form.detallesAdicionales2 } : {}),
        ...(form.direccion     ? { direccion: form.direccion }                     : {}),
        ...(form.link          ? { link: form.link }                               : {}),
        restringirReenvio: form.restringirReenvio,
      });

      await linkGroupToEvent({
        groupColumnId: groupId,
        recruitmentBoardId,
        calendarBoardId: selectedBoardId,
        eventId: res.id,
      });

      toast.success('Evento creado y vinculado al grupo ✅');
      onOpenChange(false);
      onSuccess();
    } catch {
      toast.error('Error al crear el evento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="w-4 h-4 text-primary" />
            Crear evento para <span className="font-black">{groupName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[62vh] overflow-y-auto pr-1">
          {/* Calendario */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Calendario</Label>
            {loadingBoards ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando calendarios…
              </div>
            ) : calBoardObjects.length === 0 ? (
              <p className="text-xs text-destructive">No hay calendarios en este proyecto. Crea uno en la sección PM primero.</p>
            ) : calBoardObjects.length === 1 ? (
              <p className="text-xs text-muted-foreground bg-muted/50 border border-border/40 rounded-md px-3 py-2">
                📅 {calBoardObjects[0].name}
              </p>
            ) : (
              <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar calendario…" /></SelectTrigger>
                <SelectContent>
                  {calBoardObjects.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Nombre del evento */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Nombre del evento</Label>
            <Input className="h-9 text-sm" value={eventName}
              onChange={e => setEventName(e.target.value)} placeholder="Nombre del evento" />
          </div>

          {/* Shared form fields */}
          <EventFormFields values={form} onChange={handleChange} />

          {/* Grupo vinculado (informativo) */}
          <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Grupo vinculado</p>
            <p className="text-xs font-medium text-foreground">{groupName}</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave}
            disabled={saving || loadingBoards || calBoardObjects.length === 0}>
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Creando…</> : 'Crear evento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
