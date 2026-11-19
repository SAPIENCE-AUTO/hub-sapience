import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { pedirAccesoEquipoTalks } from '../../server/talks/client';
import { esEventoGuardado } from '../lib/talksSesion';
import { leerTalksGuardado } from '../serverUtils/talksSession';

// «Abrir en Talks» sin volver a pedir el correo. El Hub y Talks son dos sitios distintos y el navegador no comparte el inicio de sesión entre ellos, así que el
// Hub (que ya sabe quién es) le pide a Talks un pase de UN solo uso (60 segundos) para ese correo y la pantalla abre la dirección que Talks devuelve.
// Contrato: docs/integracion-hub.md del repositorio de Talks («Acceso directo»). Cliente: server/talks/client.ts (pedirAccesoEquipoTalks).
//
// Reglas que esta pieza hace cumplir:
//  - El correo sale SIEMPRE de la sesión ya verificada del Hub (context.user.email). La entrada no trae ningún correo: aunque la petición lo mandara, se ignora.
//  - Un pase nuevo en cada llamada: no se guarda en la base, no se guarda en memoria y no se escribe en registros (ni la dirección ni la respuesta de Talks).
//  - Un problema de Talks NUNCA es un error de la pantalla: se responde con el `motivo` y la pantalla abre el link normal del equipo con un aviso en español llano.
//    Tampoco sale como 401 hacia el navegador (parecería que se venció la sesión de quien aprieta el botón).
//  - El botón de copiar el «link del equipo» no pasa por aquí: copia el `linkEquipo` normal, que es para compartirlo.
//  - QUIÉN ENTRA A TALKS DESDE ESTE BOTÓN LO DECIDE EL HUB, NO TALKS. Talks ya no tiene otra lista para quien llega con un pase (no revisa EQUIPO_PERMITIDO):
//    cualquier persona con sesión verificada y dada de alta en la tabla de usuarios del Hub (lo que ya garantiza `authenticated: true`) que pase por aquí entra a la
//    consola de Talks (crear y abrir sesiones). Si algún día solo ciertos roles deben usar Talks, el filtro se pone AQUÍ, antes de pedir el pase: este endpoint sí
//    conoce los datos de `context.user`. EQUIPO_PERMITIDO sigue mandando solo para quien escribe la dirección de Talks y entra con su correo.
export default createEndpoint({
  authenticated: true,
  description: 'Pide a Talks un pase de un solo uso (60 segundos) para que quien ya inició sesión en el Hub entre directo a la sesión de un evento sin volver a escribir su correo; si no se puede, devuelve el motivo y la pantalla abre el link normal',
  // Misma regla que los otros dos endpoints de Talks: el id de la base de un evento ya guardado.
  inputSchema: z.object({ calendarEventId: z.string().refine((id) => esEventoGuardado(id), 'Este evento todavía no está guardado.') }),
  outputSchema: z.object({
    /** La dirección que hay que abrir (trae el pase). Vale 60 segundos y sirve una sola vez. */
    url: z.string().optional(),
    /**
     * Por qué no hay pase: «no-encontrada» (Talks no conoce la sesión), «sin-sesion» (este evento no tiene sesión de Talks guardada) o
     * «no-disponible» (Talks caído, sin responder, llave mala...). En todos los casos la pantalla abre el link normal con el mismo aviso.
     */
    motivo: z.enum(['no-encontrada', 'sin-sesion', 'no-disponible']).optional(),
  }),
  execute: async ({ input, context }) => {
    const email = (context.user?.email ?? '').trim().toLowerCase();

    const guardado = await leerTalksGuardado(input.calendarEventId);
    // Sin sesión de Talks guardada no hay a dónde entrar (ni se le pregunta nada a Talks).
    if (!guardado?.talksSessionId) return { motivo: 'sin-sesion' as const };

    const nombre = [context.user?.firstName, context.user?.lastName].filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' ');
    const r = await pedirAccesoEquipoTalks({
      email,
      nombre: nombre || undefined,
      sesionId: guardado.talksSessionId,
      // Los links que Talks ya dio para esta sesión también son «de Talks» (por si TALKS_URL y su dirección pública no son la misma).
      direccionesDeTalks: [guardado.linkEquipo, guardado.linkParticipantes].filter((d): d is string => !!d),
    });

    if (r.ok === false) {
      // Un renglón en el registro para quien administra el Hub (una llave mala, Talks caído...): solo el motivo y un código, nunca la dirección del pase,
      // el correo ni lo que Talks haya contestado.
      console.warn(`[getTalksAccessLink] Talks no dio el pase: ${r.motivo} (${r.estado})`);
      return { motivo: r.motivo };
    }
    return { url: r.url };
  },
});
