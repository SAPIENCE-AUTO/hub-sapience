import { pool } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';

interface GraphMessage {
  id: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
}

/** Trae los correos marcados (bandera de seguimiento) del buzón del usuario vía
 * Microsoft Graph (permiso de aplicación Mail.Read, acotado a su buzón con una
 * Application Access Policy en Exchange) y los vuelca como pendientes nuevos
 * — dedupe por (user_id, correo_message_id), ver el índice único parcial en
 * add-personal-pendientes-table.ts. Best-effort a propósito: si Graph falla
 * (permiso aún no propagado, buzón no encontrado, etc.) no debe tumbar
 * getMisPendientes — el usuario sigue viendo sus pendientes manuales igual. */
export async function syncFlaggedEmails(userId: string, userEmail: string): Promise<number> {
  // Sin $orderby: combinarlo con $filter sobre flag/flagStatus dispara
  // "InefficientFilter" (400) en Graph — el filtro y el orden tienen que
  // ser sobre la misma propiedad. Se ordena aquí mismo en JS en su lugar.
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/messages` +
    `?$filter=${encodeURIComponent("flag/flagStatus eq 'flagged'")}` +
    `&$select=id,subject,from,receivedDateTime&$top=50`;

  const res = await graphFetch(url);
  if (!res.ok) {
    console.log('[graphMailSync] Graph respondió', res.status, 'para', userEmail);
    return 0;
  }
  const body = await res.json() as { value?: GraphMessage[] };
  const messages = (body.value ?? []).sort((a, b) =>
    (b.receivedDateTime ?? '').localeCompare(a.receivedDateTime ?? ''));
  if (messages.length === 0) return 0;

  let imported = 0;
  for (const msg of messages) {
    const remitente = msg.from?.emailAddress?.address ?? null;
    const result = await pool.query(
      `insert into pendientes_personales (user_id, titulo, status, fuente, correo_message_id, correo_asunto, correo_remitente, correo_recibido_at)
       values ($1, $2, 'Pendiente', 'correo', $3, $4, $5, $6)
       on conflict (user_id, correo_message_id) where correo_message_id is not null do nothing
       returning id`,
      [userId, msg.subject || '(sin asunto)', msg.id, msg.subject ?? null, remitente, msg.receivedDateTime ?? null],
    );
    if ((result.rowCount ?? 0) > 0) imported++;
  }
  return imported;
}

/** Refleja en el correo real de Outlook el estado que se marcó en el Hub —
 * "Resuelto" pone el flag como completado (✓), cualquier otro estado lo
 * regresa a marcado (🚩). Best-effort: si Graph falla, quien llama debe
 * atraparlo — nunca debe tumbar el guardado en la base, que es lo que
 * importa de verdad. */
export async function setEmailFlagStatus(userEmail: string, messageId: string, flagStatus: 'complete' | 'flagged'): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userEmail)}/messages/${encodeURIComponent(messageId)}`;
  const res = await graphFetch(url, {
    method: 'PATCH',
    body: JSON.stringify({ flag: { flagStatus } }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Graph respondió ${res.status} al actualizar el flag: ${detail.slice(0, 300)}`);
  }
}
