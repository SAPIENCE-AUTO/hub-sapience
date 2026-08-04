import { useState, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarUI } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Clock } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface EventFormValues {
  eventDate: string;
  durationHours: number;
  location: string;
  locationCustom: boolean;
  inviteEmails: string;
  dinamica: string;
  perfil: string;
  descripcion: string;
  detallesAdicionales: string;
  detallesAdicionales2: string;
  direccion: string;
  link: string;
  notes: string;
  restringirReenvio: boolean;
}

export const EMPTY_EVENT_FORM: EventFormValues = {
  eventDate: '',
  durationHours: 1,
  location: '',
  locationCustom: false,
  inviteEmails: '',
  dinamica: '',
  perfil: '',
  descripcion: '',
  detallesAdicionales: '',
  detallesAdicionales2: '',
  direccion: '',
  link: '',
  notes: '',
  restringirReenvio: false,
};

export const PRESET_LOCS = [
  'Online', 'Sala 5-A', 'Sala 5-B', 'Sala 5-C',
  'Sala 6-A', 'Sala 6-B', 'Sala 6-D', 'Sala 6-F',
  'Sala 6-G', 'Sala 6-H', 'Otro',
];

// ── Datetime helpers ──────────────────────────────────────────────────────────
function fmtDatetime(isoStr: string): string {
  const d = new Date(isoStr);
  const day = d.getDate();
  const mon = d.toLocaleDateString('es', { month: 'short' }).replace('.', '');
  const year = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}', ${hh}:${mm}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

// ── DatetimePicker ────────────────────────────────────────────────────────────
export function DatetimePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | undefined>(undefined);
  const [draftHour, setDraftHour] = useState(0);
  const [draftMinute, setDraftMinute] = useState(0);

  const parseInit = useCallback(() => {
    if (value) {
      const d = new Date(value);
      setDraftDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      setDraftHour(d.getHours());
      setDraftMinute(Math.round(d.getMinutes() / 5) * 5 % 60);
    } else {
      const now = new Date();
      setDraftDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      setDraftHour(now.getHours());
      setDraftMinute(Math.round(now.getMinutes() / 5) * 5 % 60);
    }
  }, [value]);

  const handleOpenChange = (o: boolean) => { if (o) parseInit(); setOpen(o); };

  const handleSave = () => {
    if (!draftDate) { onChange(''); setOpen(false); return; }
    const d = new Date(draftDate);
    d.setHours(draftHour, draftMinute, 0, 0);
    onChange(d.toISOString());
    setOpen(false);
  };

  const previewIso = draftDate
    ? (() => { const d = new Date(draftDate); d.setHours(draftHour, draftMinute, 0, 0); return d.toISOString(); })()
    : '';

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 h-9 rounded-md border border-input bg-background px-3 text-sm text-left hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        >
          <Clock className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
          {value
            ? <span className="text-foreground">{fmtDatetime(value)}</span>
            : <span className="text-muted-foreground">Seleccionar fecha y hora…</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <CalendarUI mode="single" selected={draftDate} onSelect={d => setDraftDate(d)} initialFocus className="border-b border-border/30" />
        <div className="flex gap-0 border-b border-border/30">
          <div className="flex-1 border-r border-border/30">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">Hora</p>
            <div className="grid grid-cols-4 gap-0.5 px-2 pb-2 max-h-[100px] overflow-y-auto">
              {HOURS.map(h => (
                <button key={h} type="button" onClick={() => setDraftHour(h)}
                  className={`text-[11px] font-mono py-0.5 rounded transition-colors ${draftHour === h ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted text-foreground'}`}>
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">Min</p>
            <div className="grid grid-cols-3 gap-0.5 px-2 pb-2">
              {MINUTES.map(m => (
                <button key={m} type="button" onClick={() => setDraftMinute(m)}
                  className={`text-[11px] font-mono py-0.5 rounded transition-colors ${draftMinute === m ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted text-foreground'}`}>
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="text-xs text-muted-foreground font-mono">{previewIso ? fmtDatetime(previewIso) : '—'}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { onChange(''); setOpen(false); }}>Borrar</Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave}>Guardar</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── EventFormFields ───────────────────────────────────────────────────────────
interface EventFormFieldsProps {
  values: EventFormValues;
  onChange: (field: keyof EventFormValues, value: string | boolean | number) => void;
  presetLocs?: string[];
}

export function EventFormFields({ values, onChange, presetLocs = PRESET_LOCS }: EventFormFieldsProps) {
  return (
    <div className="space-y-3">
      {/* Fecha y hora */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Fecha y hora</Label>
        <DatetimePicker value={values.eventDate} onChange={v => onChange('eventDate', v)} />
      </div>

      {/* Duración */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Duración (horas)</Label>
        <Input type="number" step="0.25" min="0" className="h-9 text-sm"
          value={values.durationHours || ''}
          onChange={e => onChange('durationHours', parseFloat(e.target.value) || 0)}
          placeholder="Ej: 2.5" />
      </div>

      {/* Ubicación Interna */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Ubicación Interna</Label>
        <Select
          value={values.locationCustom ? 'otro' : (values.location || undefined)}
          onValueChange={v => {
            if (v === 'otro') { onChange('locationCustom', true); onChange('location', ''); }
            else { onChange('locationCustom', false); onChange('location', v); }
          }}
        >
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar espacio…" /></SelectTrigger>
          <SelectContent>
            {presetLocs.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
            <SelectItem value="otro">✏️ Otro (escribir)</SelectItem>
          </SelectContent>
        </Select>
        {values.locationCustom && (
          <Input className="h-9 text-sm mt-1.5" placeholder="Escribe el lugar…"
            value={values.location} onChange={e => onChange('location', e.target.value)} />
        )}
      </div>

      {/* Attendees */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">
          Asistentes <span className="text-muted-foreground font-normal">(emails para invite)</span>
        </Label>
        <Input className="h-9 text-sm" placeholder="correo1@mail.com, correo2@mail.com…"
          value={values.inviteEmails} onChange={e => onChange('inviteEmails', e.target.value)} />
      </div>

      {/* Dinámica */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Dinámica</Label>
        <Input className="h-9 text-sm" placeholder="Ej: Grupo focal, Entrevista, Inmersión…"
          value={values.dinamica} onChange={e => onChange('dinamica', e.target.value)} />
      </div>

      {/* Perfil */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Perfil</Label>
        <Input className="h-9 text-sm" placeholder="Perfil del participante…"
          value={values.perfil} onChange={e => onChange('perfil', e.target.value)} />
      </div>

      {/* Descripción */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Descripción</Label>
        <Textarea className="text-sm resize-none min-h-[56px]" placeholder="Descripción del evento…"
          value={values.descripcion} onChange={e => onChange('descripcion', e.target.value)} />
      </div>

      {/* Detalles adicionales 1 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Detalles adicionales</Label>
        <Input className="h-9 text-sm" placeholder="Detalles adicionales…"
          value={values.detallesAdicionales} onChange={e => onChange('detallesAdicionales', e.target.value)} />
      </div>

      {/* Detalles adicionales 2 */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Detalles adicionales 2</Label>
        <Input className="h-9 text-sm" placeholder="Más detalles…"
          value={values.detallesAdicionales2} onChange={e => onChange('detallesAdicionales2', e.target.value)} />
      </div>

      {/* Dirección */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Dirección</Label>
        <Input className="h-9 text-sm" placeholder="Dirección física o lugar externo…"
          value={values.direccion} onChange={e => onChange('direccion', e.target.value)} />
      </div>

      {/* Link */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Link</Label>
        <Input className="h-9 text-sm" placeholder="https://zoom.us/j/… o link de conexión"
          value={values.link} onChange={e => onChange('link', e.target.value)} />
      </div>

      {/* Notas */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold">Notas</Label>
        <Textarea className="text-sm resize-none min-h-[56px]" placeholder="Notas adicionales, contexto…"
          value={values.notes} onChange={e => onChange('notes', e.target.value)} />
      </div>

      {/* Permitir reenvío */}
      <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
        <div className="space-y-0.5">
          <Label className="text-xs font-semibold">Restringir reenvío</Label>
          <p className="text-[11px] text-muted-foreground leading-tight">Bloquear que los asistentes reenvíen la invitación de Outlook a terceros</p>
        </div>
        <Switch checked={values.restringirReenvio} onCheckedChange={v => onChange('restringirReenvio', v)} />
      </div>
    </div>
  );
}
