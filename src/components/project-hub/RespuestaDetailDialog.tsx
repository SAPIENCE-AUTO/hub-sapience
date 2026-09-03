import { useState } from 'react';
import { toast } from 'sonner';
import {
  transcribirPreworkRespuesta, analizarPreworkRespuesta, tagPreworkRespuesta,
  updatePreworkRespuestaEstado, createPreworkSeguimiento,
} from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { X } from 'lucide-react';

export interface Respuesta {
  id: string;
  misionId: string;
  misionTitulo: string;
  misionTipo: string;
  participanteId: string;
  participanteNombre: string;
  participanteEmail: string;
  contenido: { texto?: string };
  archivos: { url: string; name?: string; mimeType?: string }[];
  estado: string;
  transcripcion?: string;
  analisisAi?: { resumen: string; sentimiento: string; tagsSugeridos: string[] };
  tags: { id: string; nombre: string; color?: string }[];
}

const SENTIMIENTO_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  positivo: 'default', neutral: 'secondary', negativo: 'destructive',
};

export function RespuestaDetailDialog({
  respuesta, open, onClose, estudioId, onUpdated,
}: {
  respuesta: Respuesta | null;
  open: boolean;
  onClose: () => void;
  estudioId: string;
  onUpdated: () => void;
}) {
  const [transcribiendo, setTranscribiendo] = useState(false);
  const [analizando, setAnalizando] = useState(false);
  const [nuevoTag, setNuevoTag] = useState('');
  const [seguimiento, setSeguimiento] = useState('');
  const [enviandoSeguimiento, setEnviandoSeguimiento] = useState(false);

  if (!respuesta) return null;

  const tieneArchivoMedia = respuesta.archivos?.some(a => a.mimeType?.startsWith('audio/') || a.mimeType?.startsWith('video/'));

  const handleTranscribir = async () => {
    setTranscribiendo(true);
    try {
      await transcribirPreworkRespuesta({ respuestaId: respuesta.id });
      toast.success('Transcripción lista');
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo transcribir');
    } finally {
      setTranscribiendo(false);
    }
  };

  const handleAnalizar = async () => {
    setAnalizando(true);
    try {
      await analizarPreworkRespuesta({ respuestaId: respuesta.id });
      toast.success('Análisis generado');
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo analizar');
    } finally {
      setAnalizando(false);
    }
  };

  const handleToggleTag = async (nombre: string) => {
    try {
      await tagPreworkRespuesta({ respuestaId: respuesta.id, estudioId, nombre });
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo actualizar el tag');
    }
  };

  const handleAddTag = async () => {
    if (!nuevoTag.trim()) return;
    await handleToggleTag(nuevoTag.trim());
    setNuevoTag('');
  };

  const handleEstadoChange = async (estado: string) => {
    try {
      await updatePreworkRespuestaEstado({ respuestaId: respuesta.id, estado });
      onUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo actualizar el estado');
    }
  };

  const handleEnviarSeguimiento = async () => {
    if (!seguimiento.trim()) return;
    setEnviandoSeguimiento(true);
    try {
      await createPreworkSeguimiento({
        estudioId, participanteId: respuesta.participanteId, misionId: respuesta.misionId, mensaje: seguimiento.trim(),
      });
      toast.success('Follow-up enviado');
      setSeguimiento('');
    } catch (err) {
      toast.error((err as Error).message || 'No se pudo enviar el follow-up');
    } finally {
      setEnviandoSeguimiento(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{respuesta.misionTitulo}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{respuesta.participanteNombre}</p>
              <p className="text-xs text-muted-foreground">{respuesta.participanteEmail}</p>
            </div>
            <Select value={respuesta.estado} onValueChange={handleEstadoChange}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="entregada">Entregada</SelectItem>
                <SelectItem value="revisada">Revisada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {respuesta.contenido?.texto && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{respuesta.contenido.texto}</div>
          )}

          {respuesta.archivos?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {respuesta.archivos.map((a, i) => (
                a.mimeType?.startsWith('image/')
                  ? <img key={i} src={a.url} alt={a.name ?? 'foto'} className="h-32 w-32 rounded-md object-cover border" />
                  : a.mimeType?.startsWith('audio/')
                    ? <audio key={i} src={a.url} controls className="w-full" />
                    : a.mimeType?.startsWith('video/')
                      ? <video key={i} src={a.url} controls className="max-h-48 rounded-md border" />
                      : <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">{a.name ?? 'archivo'}</a>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Transcripción</p>
            {respuesta.transcripcion ? (
              <p className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">{respuesta.transcripcion}</p>
            ) : tieneArchivoMedia ? (
              <Button size="sm" variant="outline" onClick={handleTranscribir} disabled={transcribiendo}>
                {transcribiendo ? 'Transcribiendo…' : 'Transcribir audio/video'}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">No aplica (esta respuesta no tiene audio/video).</p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Tags</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {respuesta.tags.map(t => (
                <Badge key={t.id} variant="secondary" className="gap-1">
                  {t.nombre}
                  <button onClick={() => handleToggleTag(t.nombre)}><X className="h-3 w-3" /></button>
                </Badge>
              ))}
              <input
                value={nuevoTag}
                onChange={(e) => setNuevoTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                placeholder="Agregar tag…"
                className="h-7 w-32 rounded-md border bg-transparent px-2 text-xs outline-none focus:border-primary"
              />
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleAddTag} disabled={!nuevoTag.trim()}>
                Agregar
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Análisis IA</p>
              <Button size="sm" variant="outline" onClick={handleAnalizar} disabled={analizando}>
                {analizando ? 'Analizando…' : respuesta.analisisAi ? 'Re-analizar' : 'Analizar con IA'}
              </Button>
            </div>
            {respuesta.analisisAi && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant={SENTIMIENTO_VARIANT[respuesta.analisisAi.sentimiento] ?? 'secondary'}>
                    {respuesta.analisisAi.sentimiento}
                  </Badge>
                </div>
                <p className="text-sm">{respuesta.analisisAi.resumen}</p>
                {respuesta.analisisAi.tagsSugeridos?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {respuesta.analisisAi.tagsSugeridos.map(s => (
                      <button key={s} onClick={() => handleToggleTag(s)}>
                        <Badge variant="outline" className="cursor-pointer hover:bg-muted">+ {s}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Enviar follow-up al participante</p>
            <Textarea
              value={seguimiento}
              onChange={(e) => setSeguimiento(e.target.value)}
              placeholder="Escribe un mensaje…"
              rows={2}
            />
            <Button size="sm" onClick={handleEnviarSeguimiento} disabled={enviandoSeguimiento || !seguimiento.trim()}>
              {enviandoSeguimiento ? 'Enviando…' : 'Enviar follow-up'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
