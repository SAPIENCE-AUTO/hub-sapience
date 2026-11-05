import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { enviarNdaDeFila } from '../serverUtils/nda/enviar';

export default createEndpoint({
  authenticated: true,
  description: 'Send the NDA (personal signing link) by email to the participant of a recruitment row and mark the row as sent',
  inputSchema: z.object({
    id: z.string(),
    // Mandar uno nuevo aunque el anterior ya esté firmado o rechazado.
    nuevo: z.boolean().optional(),
    // La sesión a la que se compromete la persona: fecha «AAAA-MM-DDTHH:mm» en hora de la Ciudad de México y lugar opcional. Sale arriba del acuerdo.
    sesion: z.object({ fecha: z.string().max(40), lugar: z.string().max(200).optional() }).optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    email: z.string().optional(),
    link: z.string().optional(),
    alreadySent: z.boolean().optional(),
  }),
  execute: async ({ input, context }) => {
    const r = await enviarNdaDeFila(input.id, { nuevo: input.nuevo, por: context.user?.email, sesion: input.sesion });
    return {
      success: r.enviado,
      message: r.mensaje,
      ...(r.correo ? { email: r.correo } : {}),
      ...(r.enlace ? { link: r.enlace } : {}),
      ...(r.yaEnviado ? { alreadySent: true } : {}),
    };
  },
});
