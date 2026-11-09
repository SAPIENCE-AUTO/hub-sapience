import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { detalleDeFila } from '../serverUtils/nda/servicio';

// El detalle del NDA de una fila: todos sus envíos (el más reciente primero) con la línea de tiempo, la constancia (IP, dispositivo) y la liga personal para copiarla.
export default createEndpoint({
  authenticated: true,
  description: 'NDA detail of a recruitment row: every send with its timeline, evidence and personal link',
  inputSchema: z.object({ rowId: z.string() }),
  outputSchema: z.object({
    envios: z.array(z.object({
      id: z.string(),
      estado: z.enum(['enviado', 'abierto', 'firmado', 'rechazado']),
      nombre: z.string(),
      nombreFirmado: z.string().optional(),
      correo: z.string(),
      enlace: z.string(),
      envios: z.number(),
      tienePdf: z.boolean(),
      enviadoAt: z.string().optional(),
      ultimoEnvioAt: z.string().optional(),
      abiertoAt: z.string().optional(),
      firmadoAt: z.string().optional(),
      rechazadoAt: z.string().optional(),
      motivoRechazo: z.string().optional(),
      enviadoPor: z.string().optional(),
      ip: z.string().optional(),
      userAgent: z.string().optional(),
      sesion: z.string().optional(),
      sesionAt: z.string().optional(),
      sesionLugar: z.string().optional(),
      rebote: z.object({ at: z.string(), motivo: z.string(), codigo: z.string().optional() }).optional(),
      eventos: z.array(z.object({ tipo: z.string(), at: z.string(), actor: z.string().optional(), detalle: z.string().optional() })),
    })),
  }),
  execute: async ({ input }) => ({ envios: await detalleDeFila(input.rowId) }),
});
