import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getPreworkRespuestas, getPreworkSeguimientos, createPreworkSeguimiento, updatePreworkAsignacion } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RespuestaDetailDialog, type Respuesta } from './RespuestaDetailDialog';

export interface ParticipanteFila {
  participanteId: string;
  nombre: string;
  email: string;
  incluido: boolean;
  estadoParticipacion: string;
  fechaInicio?: string;
  misionesAsignadas: number;
  misionesCompletadas: number;
  ultimaActividad?: string;
}

const ESTADOS = ['activo', 'pausado', 'completado', 'abandono'] as const;

const RESPUESTA_ESTADO_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  pendiente: 'secondary', entregada: 'default', revisada: 'outline',
};

/**
 * Vista de una sola persona: status + progreso, todas sus respuestas por
 * misión (una entrada abre RespuestaDetailDialog para tags/transcripción/
 * análisis) y el historial de follow-ups + mandar uno nuevo — todo junto en
 * vez de repartido entre pestañas separadas.
 */
export function ParticipanteDetailDialog({
  participante, open, onClose, estudioId, onUpdated,
}: {
  participante: ParticipanteFila | null;
  open: boolean;
  onClose: () => void;
  estudioId: string;
  onUpdated: () => void;
}) {
  const [respuestas, setRespuestas] = useState<Respuesta[]>([]);
  const [seguimientos, setSeguimientos] = useState<{ id: string; misionTitulo?: string; mensaje: string; respuestaParticipante?: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRespuesta, setSelectedRespuesta] = useState<Respuesta | null>(null);
  const [nuevoMensaje, setNuevoMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = async () => {
    if (!participante) return;
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        getPreworkRespuestas({ estudioId, participanteId: participante.participanteId }),
        getPreworkSeguimientos({ estudioId, participanteId: participante.participanteId }),
      ]);
      setRespuestas(r.respuestas ?? []);
      setSeguimientos(s.seguimientos ?? []);
    } finally {
      setLoading(false);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) cargar(); }, [open, participante?.participanteId]);

  if (!participante) return null;

  const handleEstadoChange = async (estadoParticipacion: string) => {
    try {
      await updatePreworkAsignacion({ estudioId, participanteId: participante.participanteId, estadoParticipacion });
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo actualizar el status');
    }
  };

  const handleIncluidoChange = async (incluido: boolean) => {
    try {
      await updatePreworkAsignacion({ estudioId, participanteId: participante.participanteId, incluido });
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo actualizar');
    }
  };

  const handleEnviarSeguimiento = async () => {
    if (!nuevoMensaje.trim()) return;
    setEnviando(true);
    try {
      await createPreworkSeguimiento({ estudioId, participanteId: participante.participanteId, mensaje: nuevoMensaje.trim() });
      setNuevoMensaje('');
      toast.success('Follow-up enviado');
      cargar();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo enviar el follow-up');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Dialog open={open && !selectedRespuesta} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{participante.nombre}</DialogTitle></DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{participante.email}</p>
                <p className="text-xs text-muted-foreground">
                  {participante.fechaInicio ? `Día 1: ${participante.fechaInicio.slice(0, 10)}` : 'sin iniciar sesión'}
                  {' · '}{participante.misionesCompletadas}/{participante.misionesAsignadas} misiones
                  {participante.ultimaActividad ? ` · última actividad ${new Date(participante.ultimaActividad).toLocaleDateString('es-MX')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={participante.incluido} onCheckedChange={(v) => handleIncluidoChange(v === true)} />
                  Incluido
                </label>
                <Select value={participante.estadoParticipacion} onValueChange={handleEstadoChange}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Respuestas</p>
              {loading && <p className="text-sm text-muted-foreground">Cargando…</p>}
              {!loading && respuestas.length === 0 && <p className="text-sm text-muted-foreground">Todavía no ha entregado nada.</p>}
              <div className="rounded-md border divide-y">
                {respuestas.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRespuesta(r)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.misionTitulo}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.contenido?.texto || (r.archivos?.length ? `${r.archivos.length} archivo(s)` : 'Sin texto')}
                      </p>
                    </div>
                    <Badge variant={RESPUESTA_ESTADO_VARIANT[r.estado] ?? 'default'}>{r.estado}</Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Follow-ups</p>
              {seguimientos.map(s => (
                <div key={s.id} className="rounded-md border p-2 text-sm">
                  <p>{s.mensaje}</p>
                  {s.misionTitulo && <p className="text-[11px] text-muted-foreground">sobre: {s.misionTitulo}</p>}
                  {s.respuestaParticipante && (
                    <p className="mt-1 text-xs text-muted-foreground">↳ {s.respuestaParticipante}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground">{new Date(s.createdAt).toLocaleString('es-MX')}</p>
                </div>
              ))}
              <Textarea
                value={nuevoMensaje}
                onChange={(e) => setNuevoMensaje(e.target.value)}
                placeholder="Escribe un mensaje…"
                rows={2}
              />
              <Button size="sm" onClick={handleEnviarSeguimiento} disabled={enviando || !nuevoMensaje.trim()}>
                {enviando ? 'Enviando…' : 'Enviar follow-up'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RespuestaDetailDialog
        respuesta={selectedRespuesta}
        open={!!selectedRespuesta}
        onClose={() => setSelectedRespuesta(null)}
        estudioId={estudioId}
        onUpdated={() => cargar()}
      />
    </>
  );
}
