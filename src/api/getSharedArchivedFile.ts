import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { filesInScope, scopeLabel } from '../serverUtils/archivedShares';

// Página pública /grabacion/<token> (link de cliente). Sin sesión: el token es
// la única autorización. Devuelve qué se compartió (un video, o la lista de
// una carpeta/proyecto, calculada en vivo); el link de reproducción de cada
// video se pide aparte con getSharedArchivedFileUrl. Cada apertura suma a
// access_count.
export default createEndpoint({
  authenticated: false,
  description: 'Contenido de un link de cliente del archivo de grabaciones (por token)',
  inputSchema: z.object({ token: z.string().min(20).max(64) }),
  outputSchema: z.object({
    scope: z.string(),
    title: z.string(),
    allowDownload: z.boolean(),
    expiresAt: z.string(),
    files: z.array(z.object({
      id: z.string(),
      fileName: z.string(),
      folder: z.string(),
      sizeBytes: z.number(),
      contentType: z.string().optional(),
    })),
  }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `update archived_file_shares
          set access_count = access_count + 1, last_accessed_at = now()
        where token = $1 and kind = 'page' and revoked_at is null and expires_at > now()
       returning scope, archived_file_id, path_prefix, allow_download, expires_at`,
      [input.token],
    );
    const share = r.rows[0];
    // Mismo mensaje para inexistente, vencido o revocado: no se revela cuál.
    const gone = () => new ZiteError({ code: 'NOT_FOUND', message: 'Este link no existe o ya no está disponible.' });
    if (!share) throw gone();

    const files = await filesInScope({ archivedFileId: share.archived_file_id, pathPrefix: share.path_prefix });
    if (files.length === 0) throw gone();
    const prefixLen = share.path_prefix ? share.path_prefix.length + 1 : 0;

    return {
      scope: share.scope,
      title: scopeLabel(share.scope, share.path_prefix, files[0].fileName),
      allowDownload: share.allow_download,
      expiresAt: share.expires_at,
      files: files.map((f) => ({
        id: f.id,
        fileName: f.fileName,
        // subcarpeta relativa a lo compartido ('' = raíz de lo compartido)
        folder: prefixLen ? f.sharepointPath.slice(prefixLen).split('/').slice(0, -1).join(' / ') : '',
        sizeBytes: f.sizeBytes,
        contentType: f.contentType,
      })),
    };
  },
});
