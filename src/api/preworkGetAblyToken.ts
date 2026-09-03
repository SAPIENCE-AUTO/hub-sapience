import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { createSubscribeToken } from '../lib/ably';
import { verifySessionToken } from '../../server/preworkAuth';

/**
 * Token de Ably para el portal de participante — público, a diferencia de
 * getAblyToken.ts (authenticated: true, solo para el equipo interno). El
 * canal se deriva del token de sesión ya verificado, nunca de un parámetro
 * que mande el cliente — así un participante no puede pedir el canal de otro.
 */
export default createEndpoint({
  authenticated: false,
  description: 'Token de Ably (solo-suscripción) para el canal propio del participante de Prework',
  inputSchema: z.object({ token: z.string() }),
  outputSchema: z.object({ token: z.string(), expires: z.number(), channel: z.string() }),
  execute: async ({ input }) => {
    const session = verifySessionToken(input.token);
    if (!session) throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión inválida o expirada.' });

    const channel = `prework:participante:${session.participanteId}`;
    const result = await createSubscribeToken([channel]);
    if (!result) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo generar el token de realtime' });

    return { token: result.token, expires: result.expires, channel };
  },
});
