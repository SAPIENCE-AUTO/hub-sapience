import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Links de cliente de un archivo (activos, vencidos y revocados), para el
// panel "Compartir con cliente" del reproductor.
export default createEndpoint({
  authenticated: true,
  description: 'Lista los links de cliente de un archivo archivado',
  inputSchema: z.object({ fileId: z.string().uuid() }),
  outputSchema: z.object({
    shares: z.array(z.object({
      id: z.string(),
      token: z.string(),
      nota: z.string().optional(),
      allowDownload: z.boolean(),
      expiresAt: z.string(),
      revokedAt: z.string().optional(),
      createdByEmail: z.string(),
      accessCount: z.number(),
      lastAccessedAt: z.string().optional(),
      createdAt: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    const r = await pool.query(
      `select id, token, nota, allow_download, expires_at, revoked_at, created_by_email,
              access_count, last_accessed_at, created_at
         from archived_file_shares where archived_file_id = $1 order by created_at desc`,
      [input.fileId],
    );
    return {
      shares: r.rows.map((s) => ({
        id: s.id,
        token: s.token,
        nota: s.nota ?? undefined,
        allowDownload: s.allow_download,
        expiresAt: s.expires_at,
        revokedAt: s.revoked_at ?? undefined,
        createdByEmail: s.created_by_email,
        accessCount: s.access_count,
        lastAccessedAt: s.last_accessed_at ?? undefined,
        createdAt: s.created_at,
      })),
    };
  },
});
