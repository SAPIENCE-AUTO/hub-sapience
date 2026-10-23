import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { detalleDeDireccion } from '../serverUtils/formularios/direcciones';

/** Público — la dirección que eligió el participante, en sus partes (calle, número, colonia, municipio, estado, código postal). */
export default createEndpoint({
  authenticated: false,
  description: 'Partes de la dirección elegida (Google) para el formulario del participante',
  inputSchema: z.object({
    codigo: z.string().min(1).max(40),
    sesion: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    id: z.string().min(1).max(300),
  }),
  outputSchema: z.object({
    disponible: z.boolean(),
    direccion: z.record(z.string(), z.string()).optional(),
  }),
  execute: async ({ input, context }) => detalleDeDireccion({ ...input, delHub: !!context.user }),
});
