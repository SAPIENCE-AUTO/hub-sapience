import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';

// Links de cliente de un video (fileId) o de una carpeta/proyecto (pathPrefix)
// — activos, vencidos y revocados — para el panel "Compartir con cliente".
export default createEndpoint({
  authenticated: true,
  description: 'Lista los links de cliente de un video, carpeta o proyecto archivado',
  inputSchema: z.object({ fileId: z.string().uuid().optional(), pathPrefix: z.string().optional() }),
  outputSchema: z.object({
    shares: z.array(z.object({
      id: z.string(),
      token: z.string(),
      scope: z.string(),
      nota: z.string().optional(),
      allowDownload: z.boolean(),
      kind: z.string(),
      expiresAt: z.string(),
      revokedAt: z.string().optional(),
      createdByEmail: z.string(),
      accessCount: z.number(),
      filesViewed: z.number(),
      lastAccessedAt: z.string().optional(),
      createdAt: z.string(),
    })),
  }),
  execute: async ({ input }) => {
    if (!input.fileId && !input.pathPrefix) return { shares: [] };
    const r = await pool.query(
      `select s.id, s.token, s.scope, s.nota, s.allow_download, s.kind, s.expires_at, s.revoked_at,
              s.created_by_email, s.access_count, s.last_accessed_at, s.created_at,
              (select count(distinct v.archived_file_id)::int from archived_file_share_views v where v.share_id = s.id) as files_viewed
         from archived_file_shares s
        where ${input.fileId ? 's.archived_file_id = $1' : 's.path_prefix = $1'}
        order by s.created_at desc`,
      [input.fileId ?? input.pathPrefix!.replace(/^\/+|\/+$/g, '')],
    );
    return {
      shares: r.rows.map((s) => ({
        id: s.id,
        token: s.token,
        scope: s.scope,
        nota: s.nota ?? undefined,
        allowDownload: s.allow_download,
        kind: s.kind,
        expiresAt: s.expires_at,
        revokedAt: s.revoked_at ?? undefined,
        createdByEmail: s.created_by_email,
        accessCount: s.access_count,
        filesViewed: s.files_viewed,
        lastAccessedAt: s.last_accessed_at ?? undefined,
        createdAt: s.created_at,
      })),
    };
  },
});
