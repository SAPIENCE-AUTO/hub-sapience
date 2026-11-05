// El acuerdo de confidencialidad que firman los participantes y los dos correos que lo acompañan (la invitación con la liga para firmar y la copia firmada).
// El texto es el que redactó Sergio (2026-11-04), palabra por palabra; lo único que cambia es el nombre, que entra donde decía «____________ (nombre completo)».
// Las dos líneas del final del documento en papel («Firma del participante» y «Fecha») las hace la página de firma (la firma dibujada y la fecha del momento) y salen en el PDF.
// Arriba del acuerdo va, si se conoce, el renglón «Sesión: día, hora (y lugar)» para que la persona sepa a qué se compromete (pedido de Sergio, 2026-11-04): nunca el nombre del proyecto,
// que podría delatar al cliente o la marca antes de firmar. Ese renglón entra en el texto del que sale la huella; sin sesión, el texto es idéntico al original.
// El aviso de privacidad que cita el último párrafo es el de AGC (el mismo que leen los participantes de Filtros, en sharpli.mx/f/aviso): no nombra firma, IP ni dispositivo, por eso el párrafo lo dice.
// Para cambiar el texto se edita NDA_SECCIONES y se sube NDA_TEXTO_VERSION (queda guardada con cada firma); la prueba (server/scripts/test-nda.ts) compara contra el original para que no se mueva una coma sin querer.

export const NDA_TEXTO_VERSION = '2026-11-04-2';

export const NDA_TITULO = 'ACUERDO DE CONFIDENCIALIDAD, CONSENTIMIENTO INFORMADO Y RESPONSIVA';

export interface NdaSeccion { titulo: string; parrafos: string[] }

export const NDA_SECCIONES: NdaSeccion[] = [
  {
    titulo: '1. Confidencialidad',
    parrafos: [
      'Me comprometo a mantener absoluta confidencialidad sobre toda la información, productos, materiales y comentarios que pueda observar o probar durante mi participación en la sesión de investigación de mercados organizada por ASESORES GLOBALES CORPORATIVOS SC (en adelante, “la Agencia”).',
      'Entiendo que dicha información es confidencial y no podrá ser divulgada, compartida o utilizada fuera de este contexto bajo ninguna circunstancia.',
    ],
  },
  {
    titulo: '2. Consentimiento informado',
    parrafos: [
      'Declaro que he sido informado(a) de que durante la sesión tendré acceso a información confidencial que no podré compartir ni divulgar.',
      'Reconozco que mi participación es completamente voluntaria, y acepto participar en el estudio por mi propia voluntad.',
    ],
  },
  {
    titulo: 'Declaraciones finales',
    parrafos: [
      'Por la presente, confirmo que participo en esta actividad de manera consciente y voluntaria, y que he tenido la oportunidad de resolver todas las dudas relacionadas con mi participación.',
      // Agregados por pedido de Sergio (2026-11-04): la aceptación expresa dentro del texto (así queda en la huella y en el PDF, no solo en la casilla de la página) y el aviso de privacidad de AGC.
      'Al firmar, acepto los términos y condiciones de este acuerdo y confirmo que soy mayor de edad, que lo leí y lo entendí, y que la firma que aparece aquí es mía.',
      'Conozco el aviso de privacidad de Asesores Globales Corporativos SC, disponible en sharpli.mx/f/aviso, y acepto que se registren mi nombre, mi firma, la fecha y hora, mi dispositivo y mi dirección IP como constancia de esta firma.',
    ],
  },
];

export const NDA_ASUNTO = 'Tu acuerdo de confidencialidad — Sapience';
export const NDA_ASUNTO_COPIA = 'Tu copia del acuerdo de confidencialidad firmado — Sapience';

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/zite-uploads/branding/sapience-logo.png';

/** Espacios de más (dobles, saltos de línea) fuera: el nombre queda en una sola línea. */
export function limpiarNombre(nombre: string): string {
  return nombre.replace(/\s+/g, ' ').trim();
}

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** «4 de noviembre de 2026, 10:42 h» en hora de la Ciudad de México (donde se firma). */
export function fechaHoraMx(d: Date): string {
  return `${new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)} h`;
}

const ZONA_MX = 'America/Mexico_City';
const fmtDia = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_MX, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtHora = new Intl.DateTimeFormat('es-MX', { timeZone: ZONA_MX, hour: '2-digit', minute: '2-digit', hour12: false });

/** «miércoles 4 de noviembre de 2026, 18:00 h (hora de la Ciudad de México)» y, si hay, « · lugar». Es el texto que se congela con el envío y se imprime en el correo, la página y el PDF. */
export function describirSesion(fecha: Date, lugar?: string | null): string {
  const donde = limpiarNombre(lugar ?? '');
  return `${fmtDia.format(fecha)}, ${fmtHora.format(fecha)} h (hora de la Ciudad de México)${donde ? ` · ${donde}` : ''}`;
}

/** Desfase de la Ciudad de México respecto de UTC en ese instante, en minutos (−360 hoy: no tiene horario de verano desde 2022; así sigue bien si algún día lo repusieran). */
function desfaseMx(instante: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONA_MX, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000);
}

/** «2026-11-05T18:00» (lo que da un campo de fecha y hora, escrito en hora de la Ciudad de México) → el instante. null si no es una fecha válida. */
export function desdeHoraMx(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [anio, mes, dia, hora, min] = m.slice(1).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || min > 59) return null;
  const supuesto = Date.UTC(anio, mes - 1, dia, hora, min);
  const d = new Date(supuesto - desfaseMx(new Date(supuesto)) * 60000);
  // Fechas imposibles (31 de febrero) se corrieron a otro mes: se rechazan.
  const vuelta = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_MX, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return vuelta === `${m[1]}-${m[2]}-${m[3]}` ? d : null;
}

/** La frase con que abre el acuerdo («Yo, ____ (nombre completo), declaro que:»); la página de firma pone el nombre entre las dos mitades mientras la persona lo escribe. */
export const APERTURA_ANTES = 'Yo, ';
export const APERTURA_DESPUES = ' (nombre completo), declaro que:';
export const aperturaNda = (nombre: string) => `${APERTURA_ANTES}${limpiarNombre(nombre)}${APERTURA_DESPUES}`;

/** El renglón de arriba del acuerdo. */
export const lineaSesion = (sesion: string) => `Sesión: ${sesion}`;

/** El acuerdo en texto plano, con el nombre puesto y, si se conoce, el renglón de la sesión arriba. De aquí sale la huella (hash) del texto exacto que firma cada persona y lo que revisan las pruebas. */
export function ndaEnTexto(nombre: string, sesion?: string | null): string {
  const bloques = [...(sesion ? [lineaSesion(sesion)] : []), NDA_TITULO, aperturaNda(nombre), ...NDA_SECCIONES.flatMap((s) => [s.titulo, ...s.parrafos])];
  return bloques.join('\n\n');
}

const MARCO_ABRE = (titulo: string, cuerpo: string) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /></head>
<body style="margin:0; padding:0; background:#eef1f5; font-family:Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px; max-width:100%; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #E4E9F0;">
        <tr><td style="background:#0e4b5a; padding:24px 32px;">
          <div style="color:#fff; font-size:20px; font-weight:700;">${escaparHtml(titulo)}</div>
        </td></tr>
        <tr><td style="padding:24px 32px;">${cuerpo}
        </td></tr>
        <tr><td style="background:#F9FAFB; padding:20px 32px; text-align:center; border-top:1px solid #E9EDF3;">
          <img src="${LOGO_URL}" alt="Sapience" width="120" style="display:block; margin:0 auto;">
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

/** Invitación: la liga personal para leer y firmar. El nombre se escapa: viene de formularios externos y entra tal cual a un HTML. */
export function construirCorreoNda(nombre: string, enlace: string, sesion?: string | null): { asunto: string; html: string } {
  const nom = escaparHtml(limpiarNombre(nombre));
  const href = escaparHtml(enlace);
  const cuerpo = `
          <p style="margin:0; color:#111827; font-size:15px;">Hola ${nom},</p>
          <p style="margin:12px 0 0; color:#374151; font-size:15px; line-height:1.5;">Para participar en tu sesión necesitamos que leas y firmes un acuerdo de confidencialidad. Toma 2 minutos y se firma desde tu celular.</p>${sesion ? `
          <p style="margin:16px 0 0; padding:10px 14px; background:#F3F6F8; border-radius:8px; color:#111827; font-size:14px; line-height:1.5;"><b>Sesión:</b> ${escaparHtml(sesion)}</p>` : ''}
          <div style="text-align:center; padding:22px 0 6px;">
            <a href="${href}" style="display:inline-block; background:#F1A34F; color:#fff; text-decoration:none; font-weight:700; padding:12px 28px; border-radius:8px;">Leer y firmar</a>
          </div>
          <p style="margin:18px 0 0; color:#6b7280; font-size:12px; line-height:1.5;">Si el botón no abre, copia esta liga en tu navegador:<br><a href="${href}" style="color:#0e4b5a; word-break:break-all;">${href}</a></p>
          <p style="margin:12px 0 0; color:#6b7280; font-size:12px; line-height:1.5;">La liga es solo para ti. Si no esperabas este correo, ignóralo.</p>`;
  return { asunto: NDA_ASUNTO, html: MARCO_ABRE('Acuerdo de confidencialidad', cuerpo) };
}

/** Copia para quien firmó (el PDF va adjunto). */
export function construirCorreoCopia(nombre: string, fechaTexto: string): { asunto: string; html: string } {
  const cuerpo = `
          <p style="margin:0; color:#111827; font-size:15px;">Hola ${escaparHtml(limpiarNombre(nombre))},</p>
          <p style="margin:12px 0 0; color:#374151; font-size:15px; line-height:1.5;">Recibimos tu acuerdo de confidencialidad firmado el ${escaparHtml(fechaTexto)}. Te dejamos una copia en PDF adjunta.</p>
          <p style="margin:12px 0 0; color:#374151; font-size:15px; line-height:1.5;">Gracias, nos vemos en la sesión.</p>`;
  return { asunto: NDA_ASUNTO_COPIA, html: MARCO_ABRE('Acuerdo firmado', cuerpo) };
}
