import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { consultarSesionTalks, TalksError } from '../../server/talks/client';
import { esEventoGuardado } from '../lib/talksSesion';
import { guardarTalks, leerTalksGuardado } from '../serverUtils/talksSession';

export default createEndpoint({
  authenticated: true,
  description: 'Consulta (sin crear nada) la sesión de Talks de un evento: lo guardado junto a la Sala de observación y, si falta, lo que Talks tenga',
  inputSchema: z.object({ calendarEventId: z.string().refine((id) => esEventoGuardado(id), 'Este evento todavía no está guardado.') }),
  outputSchema: z.object({
    existe: z.boolean(),
    talksSessionId: z.string().optional(),
    linkEquipo: z.string().optional(),
    linkParticipantes: z.string().optional(),
    /** Solo cuando se le preguntó a Talks en esta llamada. «sin-llave»: Talks no tiene la llave de Mux de la sesión. */
    transmision: z.enum(['lista', 'sin-llave']).optional(),
    /** No se pudo preguntar a Talks (no está conectado, no respondió...): frase en español llano, no es un error de la pantalla. */
    aviso: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const guardado = await leerTalksGuardado(input.calendarEventId);

    // Sin sala no puede haber sesión de Talks nacida del Hub (crear siempre arma la sala primero): ni se le pregunta a Talks.
    if (!guardado) return { existe: false };

    // Lo normal: ya está guardado. Se responde con lo guardado, sin red.
    if (guardado.talksSessionId && guardado.linkEquipo && guardado.linkParticipantes) {
      return { existe: true, talksSessionId: guardado.talksSessionId, linkEquipo: guardado.linkEquipo, linkParticipantes: guardado.linkParticipantes };
    }

    // Hay sala pero nada guardado: ¿Talks ya tiene la sesión de este evento (por ejemplo se creó y se perdió la copia)?
    try {
      const sesion = await consultarSesionTalks(input.calendarEventId);
      if (!sesion) return { existe: false };
      await guardarTalks(guardado.salaId, sesion);
      return {
        existe: true,
        talksSessionId: sesion.id,
        linkEquipo: sesion.linkEquipo,
        linkParticipantes: sesion.linkParticipantes,
        transmision: sesion.transmision,
      };
    } catch (err) {
      // Consultar nunca debe romper la pantalla: se cuenta qué pasó y el botón de crear sigue disponible.
      if (err instanceof TalksError) return { existe: false, aviso: err.message };
      throw err;
    }
  },
});
