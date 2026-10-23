import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { sugerirDirecciones } from '../serverUtils/formularios/direcciones';

/**
 * Público — «Busca tu dirección» del formulario del participante: sugerencias
 * de Google mientras escribe. Con texto vacío solo dice si el buscador está
 * disponible. Solo para filtros en prueba o en vivo (o quien entra al Hub).
 */
export default createEndpoint({
  authenticated: false,
  description: 'Sugerencias de dirección (Google) para el formulario del participante',
  inputSchema: z.object({
    codigo: z.string().min(1).max(40),
    sesion: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    texto: z.string().max(150),
  }),
  outputSchema: z.object({
    disponible: z.boolean(),
    sugerencias: z.array(z.object({ id: z.string(), principal: z.string(), secundario: z.string() })),
  }),
  execute: async ({ input, context }) => sugerirDirecciones({ ...input, delHub: !!context.user }),
});
