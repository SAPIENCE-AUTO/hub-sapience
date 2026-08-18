// Construcción del HTML del invite de calendario — compartido entre
// syncOutlookInvite.ts (envío real) y previewInviteTemplate.ts (preview del
// configurador). Extraído de syncOutlookInvite.ts para que ambos generen
// exactamente el mismo HTML, sin duplicar el template.

export const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';

export interface InviteSection {
  label: string;
  value: string;
}

// Add durationHours to an ISO datetime string
export function addHours(isoDate: string, hours: number): string {
  const d = new Date(isoDate);
  d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  return d.toISOString();
}

// Split start/duration into the two lines shown in the date/time pill
export function formatWhenParts(startIso: string, durationHours: number): { datePart: string; timePart: string } {
  const tz = 'America/Mexico_City';
  const start = new Date(startIso);
  const end = new Date(addHours(startIso, durationHours));

  const datePart = new Intl.DateTimeFormat('es-MX', {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(start);
  const timeOpts: Intl.DateTimeFormatOptions = { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false };
  const startTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(start);
  const endTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(end);

  return { datePart, timePart: `${startTime} – ${endTime} hrs · Ciudad de México` };
}

// Format date as "lunes 6 de abril 2026 — 18:00–19:30 hrs (Mexico City)"
// (usado por replaceTemplatePlaceholders' {{fechahora}} en syncOutlookInvite.ts)
export function formatWhenText(startIso: string, durationHours: number): string {
  const tz = 'America/Mexico_City';
  const start = new Date(startIso);
  const end = new Date(addHours(startIso, durationHours));

  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false };

  const datePart = new Intl.DateTimeFormat('es-MX', dateOpts).format(start);
  const startTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(start);
  const endTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(end);

  return `${datePart} — ${startTime}–${endTime} hrs (Mexico City)`;
}

// One info block: orange accent bar + bold teal label + body content
function section(label: string, contentHtml: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td width="3" style="background:#F1A34F; border-radius:2px;">&nbsp;</td>
      <td style="width:14px;">&nbsp;</td>
      <td>
        <div style="color:#0e4b5a; font-size:17px; font-weight:800;">${label}</div>
        ${contentHtml}
      </td>
    </tr>
  </table>
  <div style="height:22px;"></div>`;
}

// Convert newline-separated text into <li> items
function toListItems(text: string): string {
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => `<li>${s}</li>`)
    .join('\n');
}

const FONT = "'Poppins', Arial, Helvetica, sans-serif";
const BODY_TEXT = (html: string) =>
  `<div style="color:#374151; font-size:15px; line-height:1.5; padding-top:3px; font-weight:400;">${html}</div>`;

// Build the full HTML email body. `sections` is already resolved and ordered
// by the caller — either from a board's configured invite template (any
// columns, any order, any labels) or from the fixed legacy fallback
// (Dinámica/Perfil/Descripción/Detalles) when no template has been
// configured for that calendar board yet.
export function buildEmailHtml(opts: {
  subject: string;
  startIso: string;
  durationHours: number;
  sections: InviteSection[];
  link: string;
}): string {
  const { subject, startIso, durationHours, sections, link } = opts;
  const { datePart, timePart } = formatWhenParts(startIso, durationHours);

  const sectionsHtml = sections
    .filter(s => s.value)
    .map(s => {
      const isMultiline = /\n/.test(s.value);
      const body = isMultiline
        ? `<ul style="margin:5px 0 0; padding:0 0 0 16px; color:#374151; font-size:15px; line-height:1.6; font-weight:400;">${toListItems(s.value)}</ul>`
        : BODY_TEXT(s.value);
      return section(s.label, body);
    })
    .join('');

  const linkSection = link
    ? `<tr>
    <td style="padding:0 40px;">
      <div style="border-top:1px solid #E9EDF3; line-height:1px;">&nbsp;</div>
    </td>
  </tr>
  <tr>
    <td style="padding:24px 40px 8px; font-family:${FONT};">
      <div style="color:#0e4b5a; font-size:17px; font-weight:800;">Link de conexión</div>
      <div style="color:#374151; font-size:15px; padding-top:4px; word-break:break-word;">
        <a href="${link}" target="_blank" style="color:#0e4b5a; text-decoration:underline;">${link}</a>
      </div>
      <div style="text-align:center; padding:20px 0 8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${link}" style="height:50px; v-text-anchor:middle; width:320px;" arcsize="16%" stroke="f" fillcolor="#F1A34F">
          <w:anchorlock/>
          <center style="color:#ffffff; font-family:Arial, sans-serif; font-size:17px; font-weight:700;">Unirse a la reunión &rarr;</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
          <tr>
            <td align="center" valign="middle" height="50" style="background:#F1A34F; border-radius:10px;">
              <a href="${link}" target="_blank" style="display:inline-block; color:#ffffff; text-decoration:none; font-family:${FONT}; font-size:17px; font-weight:700; line-height:50px; padding:0 32px;">Unirse a la reunión &rarr;</a>
            </td>
          </tr>
        </table>
        <!--<![endif]-->
      </div>
      <div style="color:#9ca3af; font-size:13px; text-align:center; padding-top:6px; font-weight:400;">
        ¿El botón no funciona? Copia este enlace de arriba en tu navegador.
      </div>
    </td>
  </tr>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap');
  </style>
</head>
<body style="margin:0; padding:0; background:#eef1f5;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef1f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px; max-width:100%; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #E4E9F0;">

          <tr>
            <td style="background:#0e4b5a; padding:32px 40px 28px; font-family:${FONT};">
              <div style="color:#ffffff; font-size:26px; font-weight:700; line-height:1.3;">${subject}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 0; font-family:${FONT};">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FDF3E7; border-radius:12px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="color:#7a5a26; font-size:11px; font-weight:600; letter-spacing:.8px; text-transform:uppercase;">${datePart}</div>
                    <div style="color:#111827; font-size:17px; font-weight:700; padding-top:2px;">${timePart}</div>
                  </td>
                </tr>
              </table>
              <div style="color:#9ca3af; font-size:12px; padding-top:8px;">UTC&minus;06:00 · Si te conectas desde otra zona horaria, verifica la hora local.</div>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 40px 4px; font-family:${FONT};">
              ${sectionsHtml}
            </td>
          </tr>

          ${linkSection}

          <tr>
            <td style="background:#F9FAFB; padding:24px 40px; text-align:center; border-top:1px solid #E9EDF3;">
              <img src="${LOGO_URL}" alt="SAPIENCE — Human Insights Strategy" width="140" style="display:block; margin:0 auto; border:0; outline:none; text-decoration:none;">
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Formato guardado en Boards.inviteTemplateJson: { order: string[] (todos los
// BoardColumns.id, en el orden elegido), selected: string[] (subset marcado) }
// — mismo shape que excelColumnsJson, por consistencia con el patrón ya
// existente para la config de Excel del calendario.
export interface InviteTemplateConfig {
  order: string[];
  selected: string[];
}

export function parseInviteTemplate(raw: string | null | undefined): InviteTemplateConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.order) && Array.isArray(parsed.selected)) {
      return { order: parsed.order, selected: parsed.selected };
    }
  } catch { /* bad JSON — treat as unconfigured */ }
  return null;
}
