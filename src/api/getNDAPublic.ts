import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { verEnlace } from '../serverUtils/nda/servicio';

// Público (sin login): la persona entra con la liga personal de su correo. La primera vez deja constancia de que abrió la liga.
export default createEndpoint({
  authenticated: false,
  description: 'NDA signing page data for a personal link (public endpoint, validated by token); records the first open',
  inputSchema: z.object({ token: z.string().min(20).max(100) }),
  outputSchema: z.object({
    estado: z.enum(['pendiente', 'firmado', 'rechazado']),
    nombre: z.string(),
    // «jueves, 5 de noviembre de 2026, 18:00 h (hora de la Ciudad de México) · en línea»: va arriba del acuerdo; ausente si el envío no trae sesión.
    sesion: z.string().optional(),
    texto: z.object({
      version: z.string(),
      titulo: z.string(),
      aperturaAntes: z.string(),
      aperturaDespues: z.string(),
      secciones: z.array(z.object({ titulo: z.string(), parrafos: z.array(z.string()) })),
    }),
    firmadoAt: z.string().optional(),
    rechazadoAt: z.string().optional(),
    pdfUrl: z.string().optional(),
  }),
  execute: async ({ input, context }) => verEnlace(input.token, { ip: context.ip, userAgent: context.userAgent }),
});
