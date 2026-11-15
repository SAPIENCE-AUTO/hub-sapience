// Lo que esta pantalla ya sabe de la sesión de Talks de cada evento, compartido entre los dos lugares donde se crea:
// la fila del evento en la lista del calendario (components/pm/TalksFilaCell.tsx) y el bloque «Talks» de la ventana de edición
// (components/pm/TalksSessionPanel.tsx). Quien crea o consulta publica aquí el resultado y el otro lo muestra al instante, sin esperar
// a que se recargue la lista. La verdad sigue siendo el servidor: al abrir la ventana o recargar la lista, lo guardado en la base
// manda; esto solo evita que uno de los dos lugares se quede mostrando «Crear links de sesión» cuando el otro ya los creó.
// Sin React, para poder probarlo (server/scripts/test-talks-fila.ts).
import type { TalksSesionVista } from './talksSesion';

const guardados = new Map<string, TalksSesionVista>();
const oyentes = new Set<() => void>();

/** Lo último que esta pantalla supo de la sesión de Talks del evento, o `undefined` si todavía no supo nada. */
export function talksCompartido(eventoId: string): TalksSesionVista | undefined {
  return guardados.get(eventoId);
}

/**
 * Anota lo que se supo de la sesión de Talks de un evento y avisa a quien esté mirando. Publicar lo mismo otra vez no avisa a nadie
 * (la fila no se vuelve a dibujar para nada). Si lo nuevo no trae el link de observación, se conserva el que ya había.
 */
export function publicarTalks(eventoId: string, sesion: TalksSesionVista): void {
  const previo = guardados.get(eventoId);
  const nuevo: TalksSesionVista = { ...sesion, observationUrl: sesion.observationUrl ?? previo?.observationUrl };
  if (
    previo &&
    previo.talksSessionId === nuevo.talksSessionId &&
    previo.linkEquipo === nuevo.linkEquipo &&
    previo.linkParticipantes === nuevo.linkParticipantes &&
    previo.observationUrl === nuevo.observationUrl &&
    previo.transmision === nuevo.transmision
  ) return;
  guardados.set(eventoId, nuevo);
  for (const aviso of [...oyentes]) aviso();
}

/** Para `useSyncExternalStore`: devuelve la función que deja de escuchar. */
export function suscribirTalks(aviso: () => void): () => void {
  oyentes.add(aviso);
  return () => { oyentes.delete(aviso); };
}

/** Solo para las pruebas: deja el almacén como recién abierto. */
export function olvidarTalksCompartido(): void {
  guardados.clear();
  oyentes.clear();
}
