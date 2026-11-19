import { useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { createTalksSession } from 'zite-endpoints-sdk';
import { esEventoGuardado, motivoDeError, talksParaFila } from '@/lib/talksSesion';
import { publicarTalks, suscribirTalks, talksCompartido } from '@/lib/talksCompartido';
import { abrirEnTalksDesdeHub } from './abrirEnTalksReal';
import type { CalEvent } from './pmTypes';
import { TalksFilaVista } from './TalksFilaVista';

/**
 * Celda «Talks» de la fila de cada evento en la lista del calendario (EventsTable.tsx), pegada a las columnas de Zoom y de observación.
 * La primera vez: «Crear links de sesión» (el mismo createTalksSession que usa la ventana de edición: arma la transmisión de Mux y la sesión
 * en Talks, y apretarlo dos veces no crea nada doble). Después: «Abrir en Talks» (entra directo a la consola de la sesión con un pase de un solo
 * uso, sin volver a pedir el correo; si no se puede, abre el link del moderador de siempre y avisa; ver abrirEnTalksReal.ts) y los tres links con
 * botón de copiar (esos copian los links normales, sin pase: son para compartirlos). Cómo se ve: TalksFilaVista.tsx.
 *
 * Los datos de todos los eventos llegan en la misma carga de la lista (getTasks: talksSessionId, talksLinkEquipo, talksLinkParticipantes y
 * observationUrl), así que la fila no le pregunta nada al servidor por su cuenta. Lo que se crea aquí o en la ventana del evento se pasa de
 * un lugar al otro por talksCompartido.ts, sin esperar a que se recargue la lista.
 */
export function TalksFilaCell({ ev }: { ev: CalEvent }) {
  const id: string = ev.id;
  const compartido = useSyncExternalStore(suscribirTalks, () => talksCompartido(id), () => talksCompartido(id));
  const [creando, setCreando] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const enCurso = useRef(false); // el estado tarda un dibujo en llegar: dos clics muy seguidos no deben mandar dos peticiones
  const abriendoEnCurso = useRef(false); // igual para «Abrir en Talks»: cada clic pide un pase, y dos clics seguidos abrirían dos ventanas

  // El botón solo existe en un evento ya guardado (con su id real): uno recién escrito todavía trae un id provisional.
  if (!esEventoGuardado(id)) return null;

  const talks = talksParaFila(ev, compartido);

  // «Abrir en Talks»: entra directo (sin volver a pedir el correo) con un pase de un solo uso; si no se puede, abre el link normal del moderador y avisa.
  // Se llama directo desde el clic, sin ningún `await` antes: el navegador solo deja abrir la ventana en ese instante.
  const abrir = () => {
    if (abriendoEnCurso.current || !talks) return;
    abriendoEnCurso.current = true;
    setAbriendo(true);
    abrirEnTalksDesdeHub(id, talks.linkEquipo).finally(() => {
      abriendoEnCurso.current = false;
      setAbriendo(false);
    });
  };

  const crear = async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    setCreando(true);
    try {
      const res = await createTalksSession({ calendarEventId: id });
      publicarTalks(id, {
        talksSessionId: res.talksSessionId,
        linkEquipo: res.linkEquipo,
        linkParticipantes: res.linkParticipantes,
        observationUrl: res.observationUrl,
        transmision: res.transmision,
      });
      toast.success(res.yaExistia ? 'Talks ya tenía esta sesión: links recuperados' : 'Links de sesión creados');
      if (res.transmision === 'sin-llave') {
        toast.warning('Talks no tiene la llave de transmisión de este evento: EN VIVO no podrá transmitir. Avisa a quien administra el Hub.', { duration: 10000 });
      }
    } catch (err) {
      // En la fila no hay lugar para el error: va en un aviso que dura lo suficiente para leerse.
      toast.error(motivoDeError(err, 'No se pudieron crear los links. Revisa tu conexión e inténtalo de nuevo.'), { duration: 8000 });
    }
    enCurso.current = false;
    setCreando(false);
  };

  return <TalksFilaVista talks={talks} creando={creando} onCrear={crear} abriendo={abriendo} onAbrir={abrir} />;
}
