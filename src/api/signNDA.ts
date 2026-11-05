import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { firmarEnvio } from '../serverUtils/nda/servicio';

// Público (sin login): firma con el token de la liga personal. Guarda la firma, la fecha, el dispositivo y la IP; el PDF y la copia por correo se hacen enseguida, ya sin hacer esperar a la persona.
export default createEndpoint({
  authenticated: false,
  description: 'Sign the NDA from a personal link (public endpoint, validated by token)',
  inputSchema: z.object({
    token: z.string().min(20).max(100),
    nombre: z.string().max(300),
    // PNG de la firma como data URL o base64
    firma: z.string().max(600_000),
    acepta: z.boolean(),
  }),
  outputSchema: z.object({ firmadoAt: z.string() }),
  execute: async ({ input, context }) =>
    firmarEnvio(input.token, { nombre: input.nombre, firma: input.firma, acepta: input.acepta }, { ip: context.ip, userAgent: context.userAgent }),
});
