import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { archiveBlobSasUrl } from '../../server/azure/blobSas';
import { filesInScope, publishDirectIndex, scopeLabel } from '../serverUtils/archivedShares';

// "Compartir con cliente": link público /grabacion/<token> a un video, una
// carpeta o un proyecto del archivo de grabaciones, con vigencia y revocable
// (revokeArchivedFileShare). Los de carpeta/proyecto son dinámicos: lo que se
// archive después bajo esa ruta también aparece.
//
// direct: true es el respaldo para clientes cuya red corporativa bloquea el
// dominio del Hub: un SAS directo a blob.core.windows.net (dominio de
// Microsoft). Para carpeta/proyecto es una página índice estática subida a
// Blob (publishDirectIndex). No se puede revocar ni cuenta aperturas, por eso
// se limita a 7 días; la fila queda como registro.
const DIRECT_MAX_DAYS = 7;

export default createEndpoint({
  authenticated: true,
  description: 'Crea un link temporal para que un externo vea un video, carpeta o proyecto archivado',
  inputSchema: z.object({
    scope: z.enum(['file', 'folder', 'project']).default('file'),
    fileId: z.string().uuid().optional(),
    pathPrefix: z.string().min(1).max(1000).optional(),
    days: z.number().int().min(1).max(365),
    nota: z.string().max(200).optional(),
    allowDownload: z.boolean().optional(),
    direct: z.boolean().optional(),
  }),
  outputSchema: z.object({ id: z.string(), token: z.string(), expiresAt: z.string(), directUrl: z.string().optional() }),
  execute: async ({ input, context }) => {
    if (input.scope === 'file' && !input.fileId) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Falta el archivo' });
    if (input.scope !== 'file' && !input.pathPrefix) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Falta la carpeta' });
    const pathPrefix = input.scope === 'file' ? null : input.pathPrefix!.replace(/^\/+|\/+$/g, '');

    const files = await filesInScope({ archivedFileId: input.fileId, pathPrefix });
    if (files.length === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'No hay archivos archivados ahí' });

    const days = input.direct ? Math.min(input.days, DIRECT_MAX_DAYS) : input.days;
    const allowDownload = input.allowDownload ?? false;
    // 24 bytes → 32 caracteres base64url: no adivinable.
    const token = randomBytes(24).toString('base64url');

    let directUrl: string | undefined;
    if (input.direct) {
      directUrl = input.scope === 'file'
        ? archiveBlobSasUrl(files[0].blobName, { minutes: days * 24 * 60, downloadName: allowDownload ? files[0].fileName : undefined })
        : await publishDirectIndex({ token, title: scopeLabel(input.scope, pathPrefix), pathPrefix: pathPrefix!, files, days, allowDownload });
    }

    const r = await pool.query(
      `insert into archived_file_shares
         (archived_file_id, path_prefix, scope, token, nota, allow_download, expires_at, created_by_email, kind)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8, $9)
       returning id, expires_at`,
      [input.scope === 'file' ? input.fileId : null, pathPrefix, input.scope, token, input.nota?.trim() || null,
        allowDownload, days, context.user!.email, input.direct ? 'direct' : 'page'],
    );
    return { id: r.rows[0].id, token, expiresAt: r.rows[0].expires_at, directUrl };
  },
});
