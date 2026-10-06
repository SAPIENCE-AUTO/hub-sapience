import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { EstadoGuiaZ } from '../serverUtils/guias/esquemas';

// Guardado automático (el front llama con un retraso de ~1 s tras cada cambio). `version` evita que
// dos personas se pisen: si otra guardó antes, error y el front pide recargar.
export default createEndpoint({
  authenticated: true,
  description: 'Guarda una guía de tópicos (con control de versión)',
  inputSchema: z.object({ id: z.string(), titulo: z.string().trim().min(1).max(200), estado: EstadoGuiaZ, version: z.number().int().min(1) }),
  outputSchema: z.object({ version: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const estado = { ...input.estado, guia: (input.estado.roadmap?.bloques ?? []).map((_, i) => input.estado.guia[i] ?? null) };
    const { rows } = await pool.query(
      `update guias_topicos set titulo = $2, estado = $3::jsonb, version = version + 1, updated_at = now()
        where id = $1 and version = $4 and deleted_at is null returning version`,
      [input.id, input.titulo, JSON.stringify(estado), input.version],
    );
    if (!rows[0]) {
      // Requiere 'CONFLICT' (409) en server/compat/errors.ts; ver README.
      throw new ZiteError({ code: 'CONFLICT' as any, message: 'Alguien más guardó cambios en esta guía mientras la editabas. Recarga para ver la última versión.' });
    }
    return { version: Number(rows[0].version) };
  },
});
