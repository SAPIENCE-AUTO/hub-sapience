import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { deleteArchiveBlob } from '../../server/azure/blobSas';

// Revoca un link de cliente.
// - 'page': deja de abrir de inmediato (getSharedArchivedFile lo rechaza). Un
//   link de reproducción ya entregado al navegador sigue sirviendo hasta que
//   vence su SAS (máx. 2 h).
// - 'direct' de carpeta/proyecto: se borra la página índice en Blob, así que
//   el link deja de abrir. Los links por video que contenía siguen valiendo
//   hasta su vencimiento, pero solo los tiene quien los copió de la página.
// - 'direct' de un video: es un SAS suelto, no hay nada que borrar — no se
//   puede revocar.
export default createEndpoint({
  authenticated: true,
  description: 'Revoca un link de cliente de un archivo, carpeta o proyecto archivado',
  inputSchema: z.object({ id: z.string().uuid() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `update archived_file_shares set revoked_at = now()
        where id = $1 and revoked_at is null and (kind = 'page' or scope <> 'file')
       returning kind, token`,
      [input.id],
    );
    const row = r.rows[0];
    if (row?.kind === 'direct') await deleteArchiveBlob(`_compartidos/${row.token}.html`);
    return { ok: !!row };
  },
});
