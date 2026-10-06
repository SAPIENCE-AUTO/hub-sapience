import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';

// "Compartir con cliente": link público /grabacion/<token> a un archivo del
// archivo de grabaciones, con vigencia y revocable (revokeArchivedFileShare).
export default createEndpoint({
  authenticated: true,
  description: 'Crea un link temporal para que un externo vea un archivo archivado',
  inputSchema: z.object({
    fileId: z.string().uuid(),
    days: z.number().int().min(1).max(365),
    nota: z.string().max(200).optional(),
    allowDownload: z.boolean().optional(),
  }),
  outputSchema: z.object({ id: z.string(), token: z.string(), expiresAt: z.string() }),
  execute: async ({ input, context }) => {
    const exists = await pool.query('select 1 from archived_files where id = $1', [input.fileId]);
    if (!exists.rowCount) throw new ZiteError({ code: 'NOT_FOUND', message: 'Archivo no encontrado' });

    // 24 bytes → 32 caracteres base64url: no adivinable.
    const token = randomBytes(24).toString('base64url');
    const r = await pool.query(
      `insert into archived_file_shares (archived_file_id, token, nota, allow_download, expires_at, created_by_email)
       values ($1, $2, $3, $4, now() + make_interval(days => $5), $6)
       returning id, expires_at`,
      [input.fileId, token, input.nota?.trim() || null, input.allowDownload ?? false, input.days, context.user!.email],
    );
    return { id: r.rows[0].id, token, expiresAt: r.rows[0].expires_at };
  },
});
