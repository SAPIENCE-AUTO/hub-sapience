// Recordatorio por correo de misiones de Prework que se lanzan HOY.
//
// No hay cron en este repo hoy (mismo punto pendiente que
// cleanup-old-observation-streams.ts): correr a mano o programarlo como
// Render Cron Job / GitHub Action, una vez al día. El desbloqueo de la
// misión en el portal (que el participante la vea) NO depende de este
// script — eso ya lo resuelve preworkGetMisiones.ts comparando
// fecha_lanzamiento contra "hoy" en cada carga (ver preworkDate.ts). Este
// script solo manda el aviso proactivo por correo, y es opcional.
//
// Idempotente por día: cada envío se registra en
// prework_recordatorios_enviados (mision_id, participante_id) para que
// correrlo más de una vez el mismo día no duplique correos.
//
// Uso: npx tsx --env-file=../.env --env-file=../.env.local send-prework-reminders.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
if (!process.env.MS_CLIENT_ID) {
  console.error('Falta configuración de Microsoft Graph (MS_CLIENT_ID et al.) — ver server/microsoft/graph.ts.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });

// Mismo criterio horario que server/preworkDate.ts — duplicado aquí porque
// este script corre standalone (no pasa por el bundle de la app).
function fechaHoyMexico(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';
const APP_URL = (process.env.ZITE_APP_URL ?? 'http://localhost:5173').split(',')[0].trim();

function buildReminderHtml(nombre: string, misionTitulo: string, estudioNombre: string): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0; padding:0; background:#eef1f5; font-family:Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff; border-radius:12px; overflow:hidden; border:1px solid #E4E9F0;">
        <tr><td style="background:#0e4b5a; padding:24px 32px;">
          <div style="color:#fff; font-size:20px; font-weight:700;">Nueva actividad hoy</div>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0; color:#111827; font-size:15px;">Hola ${nombre},</p>
          <p style="margin:12px 0 0; color:#374151; font-size:15px;">
            Ya está disponible <b>${misionTitulo}</b> en <b>${estudioNombre}</b>.
          </p>
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

async function getGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const resp = await fetch(url, { method: 'POST', body });
  if (!resp.ok) throw new Error(`No se pudo autenticar con Graph (${resp.status})`);
  const json = await resp.json();
  return json.access_token;
}

async function main() {
  const hoy = fechaHoyMexico();

  // Un correo por (misión, participante) que se desbloquea EXACTAMENTE hoy
  // para esa persona — no "<=" como en preworkGetMisiones.ts, ese es para
  // mostrar todo lo ya visible; aquí solo lo que se lanza hoy, para no
  // reavisar de algo que ya se le avisó un día anterior. Dos modos: fecha
  // fija (igual para todo el estudio) o "Día N" relativo a la fecha_inicio
  // de cada quien (cohortes escalonadas — ver preworkLogin.ts). Un proyecto
  // puede tener varios estudios (Prework) — el nombre que se muestra es el
  // del estudio, con el proyecto entre paréntesis para dar contexto.
  const { rows: pendientes } = await pool.query<{
    mision_id: string; titulo: string; participante_id: string; nombre: string; email: string; estudio_nombre: string;
  }>(
    `select m.id as mision_id, m.titulo, a.prework_participante_id as participante_id, p.nombre, p.email,
            e.nombre || ' (' || coalesce(proj.full_name, proj.project_code, 'proyecto') || ')' as estudio_nombre
     from prework_misiones m
     join prework_asignaciones a on a.prework_estudio_id = m.prework_estudio_id
     join prework_participantes p on p.id = a.prework_participante_id
     join prework_estudios e on e.id = m.prework_estudio_id
     join projects proj on proj.id = e.proyecto_id
     where m.estado = 'publicada' and a.incluido = true
       and (
         (m.modo_programacion = 'fecha_fija' and m.fecha_lanzamiento = $1)
         or (m.modo_programacion = 'relativo_inicio' and a.fecha_inicio is not null
             and (a.fecha_inicio + ((m.dia_relativo - 1) * interval '1 day'))::date = $1::date)
       )
       and not exists (
         select 1 from prework_recordatorios_enviados r
         where r.mision_id = m.id and r.prework_participante_id = a.prework_participante_id
       )`,
    [hoy],
  );

  if (pendientes.length === 0) {
    console.log(`Sin recordatorios que mandar hoy (${hoy}).`);
    await pool.end();
    return;
  }

  const token = await getGraphToken();
  // Buzón propio de Prework, no MS_SEND_AS_EMAIL (ese es el de compras —
  // "el buzón desde el que se envían las OCs y comprobantes", ver
  // server/microsoft/graph.ts). "De momento" hardcodeado (Sergio, 2026-09-03).
  const sendAsEmail = 'sesiones@sapience.com.mx';
  let enviados = 0;

  for (const p of pendientes) {
    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${sendAsEmail}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `Nueva actividad — ${p.estudio_nombre}`,
          body: { contentType: 'HTML', content: buildReminderHtml(p.nombre, p.titulo, p.estudio_nombre) },
          toRecipients: [{ emailAddress: { address: p.email } }],
        },
        saveToSentItems: true,
      }),
    });

    if (resp.ok) {
      await pool.query(
        `insert into prework_recordatorios_enviados (mision_id, prework_participante_id) values ($1, $2) on conflict do nothing`,
        [p.mision_id, p.participante_id],
      );
      enviados++;
    } else {
      console.error(`Falló el envío a ${p.email} para "${p.titulo}": ${resp.status}`);
    }
  }

  console.log(`✅ ${enviados} de ${pendientes.length} recordatorio(s) enviado(s) para hoy (${hoy}).`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
