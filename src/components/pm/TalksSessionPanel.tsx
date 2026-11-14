import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Copy, ExternalLink, Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, createTalksSession, getTalksSession } from 'zite-endpoints-sdk';
import { esEventoGuardado, etiquetaBotonTalks, type TalksSesionVista } from '@/lib/talksSesion';

/**
 * Bloque «Talks» del evento del calendario (dentro de la Sala de observación): la primera vez «Crear links de sesión»
 * (arma la transmisión de Mux y la sesión en Talks); después «Abrir en Talks» y los links con botón de copiar.
 * Los otros dos datos que se comparten (link de observación del cliente y datos de la transmisión de Mux) ya los
 * muestra la Sala justo debajo. Servidor: createTalksSession.ts / getTalksSession.ts.
 */

async function copiar(valor: string, etiqueta: string) {
  try {
    await navigator.clipboard.writeText(valor);
    toast.success(`${etiqueta} copiado`);
  } catch {
    toast.error('No se pudo copiar. Selecciona el link y cópialo a mano.');
  }
}

/** La frase del servidor si viene en español llano; si no (sin conexión, «Error interno»...), una genérica. */
function motivo(err: unknown, generico: string): string {
  if (err instanceof ApiError && err.message && err.message !== 'Error interno' && !/ falló \(\d+\)$/.test(err.message)) return err.message;
  return generico;
}

function FilaLink({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground w-32 flex-shrink-0">{etiqueta}</span>
      <code className="flex-1 truncate bg-muted px-1.5 py-0.5 rounded text-[11px]" title={valor}>{valor}</code>
      <button
        type="button"
        onClick={() => copiar(valor, etiqueta)}
        className="text-muted-foreground hover:text-foreground flex-shrink-0"
        title={`Copiar ${etiqueta.toLowerCase()}`}
        aria-label={`Copiar ${etiqueta.toLowerCase()}`}
      >
        <Copy className="w-3 h-3" />
      </button>
      <a
        href={valor}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground flex-shrink-0"
        title="Abrir"
        aria-label={`Abrir ${etiqueta.toLowerCase()}`}
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

export function TalksSessionPanel({ calendarEventId, onCreada }: { calendarEventId: string; onCreada?: () => void }) {
  const [talks, setTalks] = useState<TalksSesionVista | null | undefined>(undefined); // undefined = cargando, null = todavía no hay
  const [aviso, setAviso] = useState<string | null>(null); // no se pudo comprobar con Talks (no es un error de la pantalla)
  const [error, setError] = useState<string | null>(null); // falló al crear
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (!esEventoGuardado(calendarEventId)) return;
    let vivo = true;
    setTalks(undefined);
    setAviso(null);
    setError(null);
    getTalksSession({ calendarEventId })
      .then((res) => {
        if (!vivo) return;
        setTalks(res.existe
          ? { talksSessionId: res.talksSessionId, linkEquipo: res.linkEquipo, linkParticipantes: res.linkParticipantes, transmision: res.transmision }
          : null);
        setAviso(res.aviso ?? null);
      })
      .catch((err) => {
        if (!vivo) return;
        setTalks(null);
        setAviso(motivo(err, 'No se pudo comprobar si este evento ya tiene links de Talks.'));
      });
    return () => { vivo = false; };
  }, [calendarEventId]);

  // El botón solo existe en un evento ya guardado (con su id real).
  if (!esEventoGuardado(calendarEventId)) return null;

  const crear = async () => {
    if (creando) return;
    setCreando(true);
    setError(null);
    try {
      const res = await createTalksSession({ calendarEventId });
      setTalks({ talksSessionId: res.talksSessionId, linkEquipo: res.linkEquipo, linkParticipantes: res.linkParticipantes, transmision: res.transmision });
      setAviso(null);
      onCreada?.(); // la Sala recarga y muestra los datos de la transmisión de Mux
      toast.success(res.yaExistia ? 'Talks ya tenía esta sesión: links recuperados' : 'Links de sesión creados');
    } catch (err) {
      setError(motivo(err, 'No se pudieron crear los links. Revisa tu conexión e inténtalo de nuevo.'));
    }
    setCreando(false);
  };

  return (
    <div className="space-y-1.5 text-xs pb-2 border-b border-border/30">
      <div className="flex items-center gap-1.5">
        <Video className="w-3.5 h-3.5 text-muted-foreground" />
        <Label className="text-xs font-semibold">Talks</Label>
      </div>

      {talks === undefined ? (
        <div className="text-xs text-muted-foreground/60 italic">Cargando...</div>
      ) : talks === null ? (
        <>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={crear} disabled={creando}>
            {creando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Video className="w-3 h-3" />}
            {etiquetaBotonTalks(talks)}
          </Button>
          <p className="text-[11px] text-muted-foreground/60">Crea la transmisión de Mux y la sesión en Talks. Si ya existen, no se duplican.</p>
          {aviso && <p className="text-[11px] text-muted-foreground">{aviso}</p>}
          {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
        </>
      ) : (
        <>
          <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
            <a href={talks.linkEquipo} target="_blank" rel="noopener noreferrer">
              <Video className="w-3 h-3" />
              {etiquetaBotonTalks(talks)}
            </a>
          </Button>
          <div className="space-y-1.5">
            <FilaLink etiqueta="Link del equipo" valor={talks.linkEquipo} />
            <FilaLink etiqueta="Link de participantes" valor={talks.linkParticipantes} />
          </div>
          {talks.transmision === 'sin-llave' && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" /> Talks no tiene la llave de transmisión de este evento: EN VIVO no podrá transmitir. Avisa a quien administra el Hub.
            </p>
          )}
        </>
      )}
    </div>
  );
}
