import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Revoca un link de cliente: deja de abrir de inmediato (getSharedArchivedFile
// lo rechaza). Un link de reproducción ya entregado al navegador del cliente
// sigue sirviendo hasta que vence su SAS (máx. 2 h).
export default createEndpoint({
  authenticated: true,
  description: 'Revoca un link de cliente de un archivo archivado',
  inputSchema: z.object({ id: z.string().uuid() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    await pool.query('update archived_file_shares set revoked_at = now() where id = $1 and revoked_at is null', [input.id]);
    return { ok: true };
  },
});
