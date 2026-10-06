import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { archiveBlobSasUrl } from '../../server/azure/blobSas';

// Página pública /grabacion/<token> (link de cliente). Sin sesión: el token es
// la única autorización. Devuelve un SAS de 2 h para reproducir y, si el link
// lo permite, otro para descargar. Cada apertura suma a access_count.
export default createEndpoint({
  authenticated: false,
  description: 'Datos y link de reproducción de un archivo compartido con un cliente (por token)',
  inputSchema: z.object({ token: z.string().min(20).max(64) }),
  outputSchema: z.object({
    fileName: z.string(),
    contentType: z.string().optional(),
    url: z.string(),
    downloadUrl: z.string().optional(),
    expiresAt: z.string(),
  }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `update archived_file_shares s
          set access_count = s.access_count + 1, last_accessed_at = now()
         from archived_files a
        where s.token = $1 and a.id = s.archived_file_id
          and s.revoked_at is null and s.expires_at > now()
       returning a.file_name, a.content_type, a.blob_name, s.allow_download, s.expires_at`,
      [input.token],
    );
    const row = r.rows[0];
    // Mismo mensaje para inexistente, vencido o revocado: no se revela cuál.
    if (!row) throw new ZiteError({ code: 'NOT_FOUND', message: 'Este link no existe o ya no está disponible.' });
    return {
      fileName: row.file_name,
      contentType: row.content_type ?? undefined,
      url: archiveBlobSasUrl(row.blob_name),
      downloadUrl: row.allow_download ? archiveBlobSasUrl(row.blob_name, { downloadName: row.file_name }) : undefined,
      expiresAt: row.expires_at,
    };
  },
});
