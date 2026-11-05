import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { rechazarEnvio } from '../serverUtils/nda/servicio';

// Público (sin login): «No acepto» desde la liga personal. Queda registrado con su motivo (opcional); para volver a mandarlo, el equipo crea un envío nuevo.
export default createEndpoint({
  authenticated: false,
  description: 'Reject the NDA from a personal link (public endpoint, validated by token)',
  inputSchema: z.object({ token: z.string().min(20).max(100), motivo: z.string().max(1000).optional() }),
  outputSchema: z.object({ rechazadoAt: z.string() }),
  execute: async ({ input, context }) => rechazarEnvio(input.token, input.motivo, { ip: context.ip, userAgent: context.userAgent }),
});
