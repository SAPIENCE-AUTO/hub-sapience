import { z } from 'zod';
import { randomBytes } from 'crypto';
import { createEndpoint, ZiteError, pool, Projects } from '../../server/compat';
import { hashPassword } from '../../server/preworkAuth';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';
const PREWORK_SEND_AS_EMAIL = 'sesiones@sapience.com.mx';
// Mismo criterio que server/index.ts (CORS) y send-prework-reminders.ts para
// resolver la URL pública del front — ZITE_APP_URL puede traer varios
// dominios separados por coma, se usa el primero.
const APP_URL = (process.env.ZITE_APP_URL ?? 'http://localhost:5173').split(',')[0].trim();

function buildInviteHtml(opts: { nombre: string; proyectoNombre: string; estudioNombre: string; esNuevo: boolean; tempPassword?: string }): string {
  const { nombre, proyectoNombre, estudioNombre, esNuevo, tempPassword } = opts;
  const credencialesHtml = esNuevo && tempPassword
    ? `<p style="margin:16px 0 0; color:#374151; font-size:15px;">Tu contraseña temporal es: <b>${tempPassword}</b></p>`
    : `<p style="margin:16px 0 0; color:#374151; font-size:15px;">Entra con tu correo y la contraseña que ya tienes.</p>`;

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0; padding:0; background:#eef1f5; font-family:Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:12px; overflow:hidden; border:1px solid #E4E9F0;">
        <tr><td style="background:#0e4b5a; padding:24px 32px;">
          <div style="color:#fff; font-size:20px; font-weight:700;">Tienes una nueva actividad</div>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0; color:#111827; font-size:15px;">Hola ${nombre},</p>
          <p style="margin:12px 0 0; color:#374151; font-size:15px;">
            Fuiste invitado(a) a participar en <b>${estudioNombre}</b> (${proyectoNombre}). Ahí encontrarás las
            actividades que te iremos compartiendo durante el estudio.
          </p>
          ${credencialesHtml}
          <div style="text-align:center; padding:20px 0 4px;">
            <a href="${APP_URL}/prework/login" style="display:inline-block; background:#F1A34F; color:#fff; text-decoration:none; font-weight:700; padding:12px 28px; border-radius:8px;">Entrar</a>
          </div>
        </td></tr>
        <tr><td style="background:#F9FAFB; padding:20px 32px; text-align:center; border-top:1px solid #E9EDF3;">
          <img src="${LOGO_URL}" alt="Sapience" width="120" style="display:block; margin:0 auto;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Invitación básica de participantes a Prework (Fase 1: lista explícita
 * nombre+email). Traer la lista desde los grupos de reclutamiento
 * (`{boardId}::groups`, ver analyzeRecruitmentStatus.ts) es Fase 2 — ese
 * picker alimenta este mismo endpoint con la misma forma de entrada.
 */
export default createEndpoint({
  authenticated: true,
  description: 'Crea/asigna participantes a un estudio de Prework y les envía la invitación por correo',
  inputSchema: z.object({
    estudioId: z.string(),
    participantes: z.array(z.object({
      nombre: z.string().min(1),
      email: z.string().email(),
      recruitmentRowId: z.string().optional(),
    })).min(1),
  }),
  outputSchema: z.object({
    invitadosNuevos: z.number(),
    yaExistian: z.number(),
    fallosEnvio: z.array(z.string()),
  }),
  execute: async ({ input }) => {
    const { rows: estudioRows } = await pool.query<{ proyecto_id: string; nombre: string }>(
      `select proyecto_id, nombre from prework_estudios where id = $1`,
      [input.estudioId],
    );
    if (!estudioRows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Estudio no encontrado' });
    const { proyecto_id: proyectoId, nombre: estudioNombre } = estudioRows[0];

    const proyecto = await Projects.findOne({ id: proyectoId, fields: ['fullName', 'projectCode'] });
    if (!proyecto) throw new ZiteError({ code: 'NOT_FOUND', message: 'Proyecto no encontrado' });
    const proyectoNombre = proyecto.fullName || proyecto.projectCode || 'tu estudio';

    let invitadosNuevos = 0;
    let yaExistian = 0;
    const fallosEnvio: string[] = [];

    for (const p of input.participantes) {
      const email = p.email.trim().toLowerCase();

      const { rows: existentes } = await pool.query<{ id: string }>(
        `select id from prework_participantes where lower(email) = lower($1) limit 1`,
        [email],
      );

      let participanteId: string;
      let tempPassword: string | undefined;
      const esNuevo = !existentes[0];

      if (esNuevo) {
        tempPassword = randomBytes(6).toString('base64url');
        const { hash, salt } = hashPassword(tempPassword);
        const { rows } = await pool.query<{ id: string }>(
          `insert into prework_participantes (email, password_hash, password_salt, nombre)
           values ($1, $2, $3, $4)
           returning id`,
          [email, hash, salt, p.nombre],
        );
        participanteId = rows[0].id;
        invitadosNuevos++;
      } else {
        participanteId = existentes[0].id;
        yaExistian++;
      }

      await pool.query(
        `insert into prework_asignaciones (prework_participante_id, prework_estudio_id, recruitment_row_id, invitado_at)
         values ($1, $2, $3, now())
         on conflict (prework_participante_id, prework_estudio_id)
         do update set incluido = true, invitado_at = now(),
           recruitment_row_id = coalesce(excluded.recruitment_row_id, prework_asignaciones.recruitment_row_id)`,
        [participanteId, input.estudioId, p.recruitmentRowId ?? null],
      );

      try {
        // Buzón propio de Prework, no el de compras (graphMailboxBase() sin
        // argumento cae en MS_SEND_AS_EMAIL — "el buzón desde el que se
        // envían las OCs y comprobantes", ver server/microsoft/graph.ts).
        // "De momento" hardcodeado (Sergio, 2026-09-03) — si más módulos
        // necesitan su propio remitente, vale la pena una variable de
        // entorno por módulo en vez de repetir el string.
        const graphResp = await graphFetch(`${graphMailboxBase(PREWORK_SEND_AS_EMAIL)}/sendMail`, {
          method: 'POST',
          body: JSON.stringify({
            message: {
              subject: `Nueva actividad — ${estudioNombre}`,
              body: { contentType: 'HTML', content: buildInviteHtml({ nombre: p.nombre, proyectoNombre, estudioNombre, esNuevo, tempPassword }) },
              toRecipients: [{ emailAddress: { address: email } }],
            },
            saveToSentItems: true,
          }),
        });
        if (!graphResp.ok) fallosEnvio.push(email);
      } catch {
        fallosEnvio.push(email);
      }
    }

    return { invitadosNuevos, yaExistian, fallosEnvio };
  },
});
