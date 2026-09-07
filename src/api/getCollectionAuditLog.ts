import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Bitácora de un proceso de cobranza — restringido a Owner o Finanzas',
  inputSchema: z.object({ collectionProcessId: z.string() }),
  outputSchema: z.object({
    entries: z.array(z.object({
      id: z.string(),
      timestamp: z.string().optional(),
      action: z.string(),
      userEmail: z.string().optional(),
      userName: z.string().optional(),
      comments: z.string().optional(),
    })),
  }),
  execute: async ({ input, context }) => {
    const role = context.user!.role;
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para ver Cobranza' });
    }

    const { rows } = await pool.query(
      `select id, "timestamp", action, user_email, user_name, comments
       from collection_audit_log
       where collection_process_id = $1
       order by "timestamp" desc nulls last`,
      [input.collectionProcessId],
    );

    return {
      entries: rows.map(row => ({
        id: row.id as string,
        timestamp: (row.timestamp ?? undefined) as string | undefined,
        action: row.action as string,
        userEmail: (row.user_email ?? undefined) as string | undefined,
        userName: (row.user_name ?? undefined) as string | undefined,
        comments: (row.comments ?? undefined) as string | undefined,
      })),
    };
  },
});
