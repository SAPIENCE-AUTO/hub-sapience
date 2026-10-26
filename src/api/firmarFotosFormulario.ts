import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { getSupabaseAdmin } from '../../server/supabaseAdmin';
import { BUCKET } from '../serverUtils/formularios/storage';

/**
 * Enlaces temporales (10 min) para ver las fotos de los participantes de un
 * filtro desde el tablero de Reclutamiento (la celda guarda «hubfoto:<ruta>»,
 * ver lib/formularios/fotoTablero.ts). Solo con sesión del Hub: en un enlace
 * compartido del tablero no se ven. Solo rutas de fotos de respuestas
 * («<id del filtro>/<archivo>»), nunca los insumos de la misma carpeta.
 */
const RUTA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i;

export default createEndpoint({
  authenticated: true,
  description: 'Enlaces temporales para ver fotos de participantes de un filtro',
  inputSchema: z.object({ rutas: z.array(z.string().regex(RUTA)).min(1).max(20) }),
  outputSchema: z.object({ urls: z.record(z.string(), z.string()) }),
  execute: async ({ input }) => {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrls(input.rutas, 600);
    if (error || !data) return { urls: {} };
    return { urls: Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl])) };
  },
});
