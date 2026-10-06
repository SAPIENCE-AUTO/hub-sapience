import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { archiveBlobSasUrl } from '../../server/azure/blobSas';

// Link de reproducción (SAS de 2 h) de un video dentro de un link de cliente.
// Valida que el video esté dentro del alcance del link y registra la vista.
export default createEndpoint({
  authenticated: false,
  description: 'Link temporal de reproducción de un video dentro de un link de cliente (por token)',
  inputSchema: z.object({ token: z.string().min(20).max(64), fileId: z.string().uuid() }),
  outputSchema: z.object({ url: z.string(), downloadUrl: z.string().optional() }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `select s.id as share_id, s.allow_download, a.blob_name, a.file_name
         from archived_file_shares s
         join archived_files a on a.id = $2
        where s.token = $1 and s.kind = 'page' and s.revoked_at is null and s.expires_at > now()
          and (s.archived_file_id = a.id
               or (s.path_prefix is not null
                   and left(a.sharepoint_path, length(s.path_prefix) + 1) = s.path_prefix || '/'))`,
      [input.token, input.fileId],
    );
    const row = r.rows[0];
    if (!row) throw new ZiteError({ code: 'NOT_FOUND', message: 'Este link no existe o ya no está disponible.' });
    await pool.query('insert into archived_file_share_views (share_id, archived_file_id) values ($1, $2)', [row.share_id, input.fileId]);
    return {
      url: archiveBlobSasUrl(row.blob_name),
      downloadUrl: row.allow_download ? archiveBlobSasUrl(row.blob_name, { downloadName: row.file_name }) : undefined,
    };
  },
});
