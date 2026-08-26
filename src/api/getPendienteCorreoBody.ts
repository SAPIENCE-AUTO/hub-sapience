import { z } from 'zod';
import { createEndpoint, pool, ZiteError } from '../../server/compat';
import { graphFetch, GraphAuthError } from '../../server/microsoft/graph';

export default createEndpoint({
  authenticated: true,
  description: 'Trae en vivo el contenido del correo (Graph) del que salió un pendiente con fuente=correo. Best-effort: si Graph falla (permiso de buzón personal aún no propagado en la Application Access Policy de Exchange, mensaje borrado, etc.) regresa available=false con el motivo, no truena.',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    available: z.boolean(),
    errorMessage: z.string().nullable(),
    subject: z.string().nullable(),
    from: z.string().nullable(),
    receivedAt: z.string().nullable(),
    bodyText: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    const userId = context.user!.id;
    const userEmail = context.user!.email;

    const { rows } = await pool.query(
      `select correo_message_id, correo_asunto, correo_remitente, correo_recibido_at
         from pendientes_personales
        where id = $1 and user_id = $2`,
      [input.id, userId],
    );
    if (rows.length === 0) throw new ZiteError({ code: 'NOT_FOUND', message: 'Pendiente no encontrado' });
    const row = rows[0];
    if (!row.correo_message_id) {
      return { available: false, errorMessage: 'Este pendiente no viene de un correo.', subject: null, from: null, receivedAt: null, bodyText: null };
    }

    try {
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/messages/${encodeURIComponent(row.correo_message_id)}?$select=subject,from,receivedDateTime,body`;
      const res = await graphFetch(url, { headers: { Prefer: 'outlook.body-content-type="text"' } });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          available: false,
          errorMessage: res.status === 403
            ? 'Microsoft bloquea el acceso a este buzón para la app (falta agregarlo a la Application Access Policy de Exchange).'
            : `Graph respondió ${res.status}.`,
          subject: row.correo_asunto,
          from: row.correo_remitente,
          receivedAt: row.correo_recibido_at ? new Date(row.correo_recibido_at).toISOString() : null,
          bodyText: null,
        };
      }
      const msg = await res.json() as { subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; receivedDateTime?: string; body?: { content?: string } };
      return {
        available: true,
        errorMessage: null,
        subject: msg.subject ?? row.correo_asunto,
        from: msg.from?.emailAddress?.address ?? row.correo_remitente,
        receivedAt: msg.receivedDateTime ?? (row.correo_recibido_at ? new Date(row.correo_recibido_at).toISOString() : null),
        bodyText: msg.body?.content ?? null,
      };
    } catch (err) {
      return {
        available: false,
        errorMessage: err instanceof GraphAuthError ? err.message : 'No se pudo cargar el correo.',
        subject: row.correo_asunto,
        from: row.correo_remitente,
        receivedAt: row.correo_recibido_at ? new Date(row.correo_recibido_at).toISOString() : null,
        bodyText: null,
      };
    }
  },
});
