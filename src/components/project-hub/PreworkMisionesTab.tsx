import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { getPreworkMisiones, createPreworkMision, updatePreworkMision } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { Plus } from 'lucide-react';

const TIPOS = [
  'foto', 'video', 'texto', 'matching', 'swipe', 'voto', 'reaccion',
  'nota_voz', 'encuesta', 'ranking', 'reaccion_estimulo', 'heatmap', 'dibujar',
] as const;
type Tipo = typeof TIPOS[number];

const TIPO_LABEL: Record<Tipo, string> = {
  foto: 'Foto', video: 'Video', texto: 'Texto', matching: 'Matching', swipe: 'Swipe',
  voto: 'Voto', reaccion: 'Reacción', nota_voz: 'Nota de voz', encuesta: 'Encuesta / escala',
  ranking: 'Ranking', reaccion_estimulo: 'Reacción a estímulo', heatmap: 'Heatmap', dibujar: 'Dibujar',
};

// Portal de participante todavía solo sabe capturar estos dos tipos — el
// resto se puede crear (el modelo de datos ya los soporta todos) pero por
// ahora el participante vería "esta actividad no está disponible todavía".
const TIPOS_CON_UI = new Set<Tipo>(['texto', 'foto']);

const ESTADO_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  publicada: 'default', borrador: 'secondary', archivada: 'outline',
};

type ModoProgramacion = 'fecha_fija' | 'relativo_inicio';

interface Mision {
  id: string;
  titulo: string;
  descripcion?: string;
  tipo: string;
  visibilidad: string;
  modoProgramacion: string;
  fechaLanzamiento?: string;
  diaRelativo?: number;
  estado: string;
  totalRespuestas: number;
}

interface FormState {
  id?: string;
  titulo: string;
  descripcion: string;
  tipo: Tipo;
  visibilidad: 'privada' | 'social';
  modoProgramacion: ModoProgramacion;
  fechaLanzamiento: string;
  diaRelativo: number;
  estado: 'borrador' | 'publicada' | 'archivada';
}

// 'en-CA' da formato YYYY-MM-DD directo. toISOString() usaría UTC, que ya
// "adelanta" al día siguiente desde media tarde en México (UTC-6) — mismo
// criterio horario que ya se usa en inviteHtml.ts (America/Mexico_City).
const hoyMexico = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

const EMPTY_FORM: FormState = {
  titulo: '', descripcion: '', tipo: 'texto', visibilidad: 'privada',
  modoProgramacion: 'fecha_fija', fechaLanzamiento: hoyMexico(), diaRelativo: 1, estado: 'publicada',
};

function etiquetaProgramacion(m: Mision): string {
  return m.modoProgramacion === 'relativo_inicio'
    ? `Día ${m.diaRelativo}`
    : (m.fechaLanzamiento ?? '').slice(0, 10);
}

export function PreworkMisionesTab({ estudioId }: { estudioId?: string }) {
  const [misiones, setMisiones] = useState<Mision[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = async () => {
    if (!estudioId) return;
    setLoading(true);
    try {
      const res = await getPreworkMisiones({ estudioId });
      setMisiones(res.misiones ?? []);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [estudioId]);

  const openCreate = () => { setForm(EMPTY_FORM); setOpen(true); };
  const openEdit = (m: Mision) => {
    setForm({
      id: m.id,
      titulo: m.titulo,
      descripcion: m.descripcion ?? '',
      tipo: m.tipo as Tipo,
      visibilidad: m.visibilidad as 'privada' | 'social',
      modoProgramacion: (m.modoProgramacion as ModoProgramacion) ?? 'fecha_fija',
      fechaLanzamiento: (m.fechaLanzamiento ?? hoyMexico()).slice(0, 10),
      diaRelativo: m.diaRelativo ?? 1,
      estado: m.estado as 'borrador' | 'publicada' | 'archivada',
    });
    setOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!estudioId || !form.titulo.trim()) return;
    setSaving(true);
    try {
      const programacion = form.modoProgramacion === 'fecha_fija'
        ? { modoProgramacion: 'fecha_fija' as const, fechaLanzamiento: form.fechaLanzamiento }
        : { modoProgramacion: 'relativo_inicio' as const, diaRelativo: form.diaRelativo };

      if (form.id) {
        await updatePreworkMision({
          id: form.id, titulo: form.titulo, descripcion: form.descripcion || undefined,
          tipo: form.tipo, visibilidad: form.visibilidad, estado: form.estado, ...programacion,
        });
        toast.success('Misión actualizada');
      } else {
        await createPreworkMision({
          estudioId, titulo: form.titulo, descripcion: form.descripcion || undefined,
          tipo: form.tipo, visibilidad: form.visibilidad, estado: form.estado, ...programacion,
        });
        toast.success('Misión creada');
      }
      setOpen(false);
      load();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo guardar la misión');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Misiones</h3>
          <p className="text-xs text-muted-foreground">Fecha fija (todos el mismo día) o Día N desde que cada quien arranca.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Nueva misión</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? 'Editar misión' : 'Nueva misión'}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input required value={form.titulo} onChange={(e) => setForm(f => ({ ...f, titulo: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Descripción / instrucción</Label>
                <Textarea value={form.descripcion} onChange={(e) => setForm(f => ({ ...f, descripcion: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo de actividad</Label>
                  <Select value={form.tipo} onValueChange={(v) => setForm(f => ({ ...f, tipo: v as Tipo }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS.map(t => (
                        <SelectItem key={t} value={t}>
                          {TIPO_LABEL[t]}{!TIPOS_CON_UI.has(t) ? ' (próximamente)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Visibilidad</Label>
                  <Select value={form.visibilidad} onValueChange={(v) => setForm(f => ({ ...f, visibilidad: v as 'privada' | 'social' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="privada">Privada</SelectItem>
                      <SelectItem value="social">Social (otros la ven)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Cuándo se lanza</Label>
                <Select value={form.modoProgramacion} onValueChange={(v) => setForm(f => ({ ...f, modoProgramacion: v as ModoProgramacion }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fecha_fija">Fecha fija — todos el mismo día</SelectItem>
                    <SelectItem value="relativo_inicio">Día N — desde que cada participante arranca</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.modoProgramacion === 'fecha_fija' ? (
                <div className="space-y-1.5">
                  <Label>Fecha de lanzamiento</Label>
                  <Input
                    type="date" required value={form.fechaLanzamiento}
                    onChange={(e) => setForm(f => ({ ...f, fechaLanzamiento: e.target.value }))}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Día (1 = el día que el participante hace login por primera vez)</Label>
                  <Input
                    type="number" min={1} required value={form.diaRelativo}
                    onChange={(e) => setForm(f => ({ ...f, diaRelativo: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Cada participante tiene su propio "Día 1" — arranca solo en su primer login, no lo fijas tú.
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select value={form.estado} onValueChange={(v) => setForm(f => ({ ...f, estado: v as FormState['estado'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="borrador">Borrador</SelectItem>
                    <SelectItem value="publicada">Publicada</SelectItem>
                    <SelectItem value="archivada">Archivada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {!TIPOS_CON_UI.has(form.tipo) && (
                <p className="text-xs text-amber-600">
                  Este tipo todavía no tiene pantalla de captura en el portal del participante — se puede crear, pero no se podrá responder hasta que se construya.
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {!loading && misiones.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay misiones.</p>}

      <div className="rounded-md border divide-y">
        {misiones.map(m => (
          <button
            key={m.id}
            onClick={() => openEdit(m)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{m.titulo}</p>
              <p className="text-xs text-muted-foreground">
                {TIPO_LABEL[m.tipo as Tipo] ?? m.tipo} · {etiquetaProgramacion(m)} · {m.visibilidad === 'social' ? 'Social' : 'Privada'}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{m.totalRespuestas} entrega(s)</span>
            <Badge variant={ESTADO_VARIANT[m.estado] ?? 'default'}>{m.estado}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
