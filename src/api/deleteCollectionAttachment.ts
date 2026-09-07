import { z } from 'zod';
import { createEndpoint, ZiteError, pool } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Elimina un documento de un proceso de cobranza — restringido a Owner o Finanzas',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const role = context.user!.role;
    const level = context.user!.purchaseLevel ?? 'Creador';
    if (role !== 'Owner' && level !== 'Finanzas') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para eliminar documentos de Cobranza' });
    }

    const { rows } = await pool.query(
      `select collection_process_id, doc_type, name from collection_attachments where id = $1`,
      [input.id],
    );
    const att = rows[0];
    if (!att) throw new ZiteError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });

    await pool.query(`delete from collection_attachments where id = $1`, [input.id]);

    const userName = [context.user!.firstName, context.user!.lastName].filter(Boolean).join(' ') || context.user!.email;
    await pool.query(
      `insert into collection_audit_log (collection_process_id, action, user_email, user_name, comments)
       values ($1, 'Adjunto eliminado', $2, $3, $4)`,
      [att.collection_process_id, context.user!.email, userName, `${att.doc_type}: ${att.name ?? ''}`],
    );

    return { success: true };
  },
});
