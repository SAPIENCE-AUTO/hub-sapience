import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues, Boards } from '../../server/compat';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';

// Parse attendees string into Graph API format
function parseAttendees(raw?: string): { emailAddress: { address: string }; type: string }[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(address => ({ emailAddress: { address }, type: 'required' }));
}

// Add durationHours to an ISO datetime string
function addHours(isoDate: string, hours: number): string {
  const d = new Date(isoDate);
  d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  return d.toISOString();
}

// Format date as "lunes 6 de abril 2026 — 18:00–19:30 hrs (Mexico City)"
function formatWhenText(startIso: string, durationHours: number): string {
  const tz = 'America/Mexico_City';
  const start = new Date(startIso);
  const end = new Date(addHours(startIso, durationHours));

  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };

  const datePart = new Intl.DateTimeFormat('es-MX', dateOpts).format(start);
  const startTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(start);
  const endTime = new Intl.DateTimeFormat('es-MX', timeOpts).format(end);

  return `${datePart} — ${startTime}–${endTime} hrs (Mexico City)`;
}

// Build the section divider HTML
const DIVIDER = `
  <div style="height:24px;"></div>
  <div style="border-top:1px solid #E9EDF3; width:100%; line-height:1px;">&nbsp;</div>
  <div style="height:24px;"></div>`;

// Build a labeled section
function section(label: string, content: string): string {
  return `${DIVIDER}
  <div style="font-variant:small-caps; letter-spacing:.4px; color:#F1A34F; font-weight:800; font-size:22px;">${label}</div>
  <div style="color:#111; font-size:18px; padding-top:6px;">${content}</div>`;
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

// Build the full HTML email body
function buildEmailHtml(opts: {
  subject: string;
  whenText: string;
  dinamica: string;
  profile: string;
  descripcion: string;
  detailsText: string;
  link: string;
}): string {
  const { subject, whenText, dinamica, profile, descripcion, detailsText, link } = opts;

  const dinamicaSection = dinamica
    ? section('Dinámica', dinamica)
    : '';

  const profileSection = profile
    ? section('Perfil', profile)
    : '';

  const descripcionSection = descripcion
    ? section('Descripción', descripcion)
    : '';

  const detailsSection = detailsText
    ? `${DIVIDER}
  <div style="font-variant:small-caps; letter-spacing:.4px; color:#F1A34F; font-weight:800; font-size:22px;">Detalles</div>
  <ul style="margin:8px 0 0 20px; padding:0; color:#111; font-size:16px; line-height:1.5;">
    ${toListItems(detailsText)}
  </ul>`
    : '';

  const linkSection = link
    ? `${DIVIDER}
  <div style="font-variant:small-caps; letter-spacing:.4px; color:#F1A34F; font-weight:800; font-size:22px;">Link de conexión</div>
  <div style="color:#111; font-size:18px; padding-top:6px; word-break:break-word;">
    <a href="${link}" target="_blank" style="color:#0e4b5a; text-decoration:underline;">${link}</a>
  </div>
  <div style="text-align:center; padding:24px 0 16px;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${link}" style="height:52px; v-text-anchor:middle; width:360px;" arcsize="10%" stroke="f" fillcolor="#F1A34F">
      <w:anchorlock/>
      <center style="color:#ffffff; font-family:Trebuchet MS, Arial, sans-serif; font-size:20px; font-weight:800;">Unirse a la reunión</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${link}" target="_blank" style="display:block; width:100%; max-width:360px; margin:0 auto; background:#F1A34F; color:#ffffff; text-decoration:none; font-family:Trebuchet MS, Arial, sans-serif; font-size:20px; font-weight:800; text-align:center; padding:16px 24px; border-radius:8px; min-height:48px; line-height:1.2; border:1px solid #d8913a; box-shadow:0 2px 0 #cf8a3f; mso-padding-alt:16px 24px;">
      Unirse a la reunión
    </a>
    <!--<![endif]-->
  </div>
  <div style="color:#6b7280; font-size:14px; text-align:center;">
    Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
    <a href="${link}" target="_blank" style="color:#0e4b5a;">${link}</a>
  </div>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background:#f7f9fc;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f7f9fc;">
    <tr>
      <td align="center" style="padding:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="680" style="width:680px; max-width:100%; background:#ffffff; border:1px solid #E9EDF3; border-radius:8px;">
          <tr>
            <td style="padding:32px; font-family:Trebuchet MS, Arial, sans-serif; color:#0e4b5a;">

              <div style="text-align:center; font-size:30px; line-height:1.35; font-weight:800;">${subject}</div>
              <div style="height:16px;"></div>

              <div style="font-variant:small-caps; letter-spacing:.4px; color:#F1A34F; font-weight:800; font-size:22px;">Fecha y hora</div>
              <div style="color:#111; font-size:18px; padding-top:6px;">${whenText}</div>
              <div style="color:#6b7280; font-size:16px; padding-top:8px;">UTC−06:00 · Si te conectas desde otra zona horaria, verifica la hora local.</div>

              ${dinamicaSection}
              ${profileSection}
              ${descripcionSection}
              ${detailsSection}
              ${linkSection}

              <div style="height:24px;"></div>
              <div style="border-top:1px solid #E9EDF3; width:100%; line-height:1px;">&nbsp;</div>
              <div style="height:24px;"></div>

              <div style="text-align:center;">
                <img src="https://i.imgur.com/GayErMC.png" alt="SAPIENCE" width="260" style="display:block; margin:0 auto; border:0; outline:none; text-decoration:none;">
                <div style="color:#808a98; font-size:14px; padding-top:8px; font-weight:600; letter-spacing:.8px;">Human Insights Strategy</div>
              </div>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Replace {{placeholder}} tokens in custom HTML with dynamic column values
// Supports conditional blocks: {{#key}}...{{/key}} — removed if key is empty
function replaceTemplatePlaceholders(
  html: string,
  boardData: Record<string, string>,
  whenText: string,
): string {
  // Helper: resolve a placeholder key to a value (or empty string)
  const resolve = (rawKey: string): string => {
    const normalized = rawKey.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
    if (normalized === 'fechahora' || normalized === 'fechayhora') return whenText;
    for (const [colName, value] of Object.entries(boardData)) {
      if (colName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '') === normalized) return value;
    }
    const aliases: Record<string, string[]> = {
      'linkconexion': ['link', 'liga'],
      'linkdeconexion': ['link', 'liga'],
    };
    const aliasList = aliases[normalized];
    if (aliasList) {
      for (const alias of aliasList) {
        for (const [colName, value] of Object.entries(boardData)) {
          if (colName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '') === alias) return value;
        }
      }
    }
    return '';
  };

  // Step 1: Process conditional blocks {{#key}}...{{/key}}
  let result = html.replace(
    /\{\{#(\s*[^}]+?\s*)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, rawKey: string, blockContent: string) => {
      const value = resolve(rawKey.trim());
      return value ? blockContent : '';
    }
  );

  // Step 2: Simple placeholder substitution {{key}}
  result = result.replace(/\{\{(\s*[^}#/]+?\s*)\}\}/g, (_match, rawKey: string) => {
    const value = resolve(rawKey.trim());
    return value || `{{${rawKey.trim()}}}`;
  });

  return result;
}

export default createEndpoint({
  description: 'Sync a calendar event with Outlook via Microsoft Graph API (create, update, or cancel)',
  authenticated: true,
  inputSchema: z.object({
    eventId: z.string(),
    action: z.enum(['create', 'update', 'cancel']),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    outlookEventLink: z.string().optional(),
    outlookEventId: z.string().optional(),
    inviteStatus: z.string().optional(),
    inviteBodyHtml: z.string().optional(),
    message: z.string().optional(),
  }),
  execute: async ({ input }) => {
    // Calculado dentro de execute (no a nivel de módulo): graphMailboxBase()
    // truena si falta MS_SEND_AS_EMAIL, y eso no debe tumbar el import del
    // archivo completo al arrancar el server — solo debe fallar cuando se
    // invoca el endpoint, igual que las demás variables de entorno de la app.
    const GRAPH_BASE = graphMailboxBase();

    // Fetch the calendar event
    const event = await CalendarEvents.findOne({ id: input.eventId });
    if (!event) throw new Error(`Calendar event not found: ${input.eventId}`);

    // Handle cancel via Graph API
    if (input.action === 'cancel') {
      if (event.outlookEventId) {
        const cancelRes = await graphFetch(`${GRAPH_BASE}/events/${event.outlookEventId}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ comment: 'Evento cancelado.' }),
        });
        if (!cancelRes.ok) {
          const err = await cancelRes.text();
          throw new Error(`Graph API cancel failed (${cancelRes.status}): ${err}`);
        }
      }
      await CalendarEvents.update({ id: input.eventId, record: { inviteStatus: 'Cancelado' } });
      return { success: true, inviteStatus: 'Cancelado', message: 'Invitación cancelada' };
    }

    // ── Resolve boardId: UUID-first, legacy fallback with ambiguity detection ──
    let resolvedBoardId: string | null = null;

    if (event.boardId) {
      // UUID-first: use boardId exclusively
      resolvedBoardId = event.boardId;
    } else if (event.projectCode && event.calendarName) {
      // Legacy lookup with ambiguity detection
      const { records } = await Boards.findAll({
        filters: { boardName: event.calendarName, projectCode: event.projectCode, boardType: 'calendar' } as any,
        limit: 10,
      });
      const activeBoards = records.filter(b => !b.deletedAt);
      if (activeBoards.length > 1) {
        throw new Error(`Ambiguity: ${activeBoards.length} calendars named "${event.calendarName}" for project ${event.projectCode}. Update event boardId to disambiguate.`);
      }
      if (activeBoards.length === 1) {
        resolvedBoardId = activeBoards[0].id;
      } else {
        // Last resort: legacy composite
        resolvedBoardId = `cal-${event.projectCode}-${event.calendarName}`;
      }
    }

    // Fetch dynamic column data (dinamica, profile, details, link, etc.)
    let boardData: Record<string, string> = {};
    if (resolvedBoardId) {
      const [colRes, cellRes] = await Promise.all([
        BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 100 }),
        CellValues.findAll({ filters: { boardId: resolvedBoardId, rowId: input.eventId } as any, limit: 200 }),
      ]);

      const colMap = new Map(colRes.records.map(c => [c.id, (c.columnName ?? c.id).toLowerCase()]));
      for (const cell of cellRes.records) {
        if (!cell.columnId) continue;
        const colName = colMap.get(cell.columnId) ?? cell.columnId;
        const value = String(cell.textValue ?? cell.numberValue ?? cell.dateValue ?? '');
        if (value) boardData[colName] = value;
      }
    }

    // Helper to find a value in boardData by multiple possible key names
    const pick = (...keys: string[]): string => {
      for (const k of keys) {
        const hit = Object.entries(boardData).find(([key]) =>
          key.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, '')
        );
        if (hit?.[1]) return hit[1];
      }
      return '';
    };

    const startIso = event.eventDate ?? new Date().toISOString();
    const durationHours = event.durationHours ?? 1;
    const endIso = addHours(startIso, durationHours);

    const dinamica = pick('Dinámica', 'Dinamica', 'dinamica');
    const profile = pick('Perfil', 'perfil');
    const descripcion = pick('Descripción', 'descripcion');
    const detailsText = pick('Detalles adicionales', 'Detalles', 'detalles');
    const link = pick('Link', 'link', 'Liga', 'liga');
    const customHtml = pick('HTML Invite', 'htmlinvite', 'HTML Personalizado', 'htmlpersonalizado');

    const whenText = formatWhenText(startIso, durationHours);
    const subject = event.eventName ?? 'Sesión';

    const inviteBodyHtml = (customHtml ? replaceTemplatePlaceholders(customHtml, boardData, whenText) : null) || buildEmailHtml({ subject, whenText, dinamica, profile, descripcion, detailsText, link });

    const attendees = parseAttendees(event.inviteEmails ?? '');
    // Use "Dirección" dynamic column for Outlook location (external-facing address)
    // "Ubicación Interna" (native location field) is internal-only and excluded here
    const location = pick('Dirección', 'direccion') || '';

    // Convert UTC ISO strings to CDMX local time representation for Graph API
    // Graph interprets dateTime as the given timeZone, so we must pass local CDMX time
    const toLocalCdmx = (isoUtc: string): string => {
      const d = new Date(isoUtc);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
      return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
    };

    const startLocal = toLocalCdmx(startIso);
    const endLocal = toLocalCdmx(endIso);

    // Restringir reenvío: usar singleValueExtendedProperties con DoNotForward del PS_PUBLIC_STRINGS namespace
    const isRestrictedForwarding = !!event.permitirReenvio;
    const graphBase = GRAPH_BASE;

    console.log(`[syncOutlookInvite] eventId=${input.eventId} action=${input.action} restrictedForwarding=${isRestrictedForwarding} endpoint=v1.0 ${isRestrictedForwarding ? "property='DoNotForward', propertySet='00020329-0000-0000-C000-000000000046'" : 'invite normal (sin restricción de reenvío)'}`);

    const graphBody = {
      subject,
      body: { contentType: 'HTML', content: inviteBodyHtml },
      start: { dateTime: startLocal, timeZone: 'America/Mexico_City' },
      end: { dateTime: endLocal, timeZone: 'America/Mexico_City' },
      ...(location ? { location: { displayName: location } } : {}),
      ...(attendees.length ? { attendees } : {}),
      ...(isRestrictedForwarding ? {
        singleValueExtendedProperties: [
          {
            id: 'Boolean {00020329-0000-0000-C000-000000000046} Name DoNotForward',
            value: 'true',
          }
        ]
      } : {}),
    };

    let graphRes: Response;
    if (input.action === 'create') {
      graphRes = await graphFetch(`${graphBase}/events`, {
        method: 'POST',
        body: JSON.stringify(graphBody),
      });
    } else {
      // update
      const existingId = event.outlookEventId;
      if (!existingId) throw new Error('No outlookEventId found to update');
      graphRes = await graphFetch(`${graphBase}/events/${existingId}`, {
        method: 'PATCH',
        body: JSON.stringify(graphBody),
      });
    }

    if (!graphRes.ok) {
      const err = await graphRes.text();
      console.error(`[syncOutlookInvite] Graph API error`, { eventId: input.eventId, action: input.action, status: graphRes.status, restrictedForwarding: isRestrictedForwarding, endpoint: 'v1.0', error: err });
      throw new Error(`Graph API ${input.action} failed (${graphRes.status}): ${err}`);
    }

    const created = await graphRes.json() as { id?: string; webLink?: string };

    // Verify DoNotForward property was set correctly
    if (isRestrictedForwarding && created.id) {
      const DO_NOT_FORWARD_ID = 'Boolean {00020329-0000-0000-C000-000000000046} Name DoNotForward';
      const verifyRes = await graphFetch(
        `${GRAPH_BASE}/events/${created.id}?$expand=singleValueExtendedProperties($filter=id eq '${DO_NOT_FORWARD_ID}')`,
      );
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json() as { singleValueExtendedProperties?: { id: string; value: string }[] };
        const props = verifyData.singleValueExtendedProperties ?? [];
        const doNotForward = props.find(p => p.id === DO_NOT_FORWARD_ID);
        console.log(`[syncOutlookInvite] DoNotForward verification: ${doNotForward ? `value=${doNotForward.value}` : 'NOT FOUND on event'}`);
      } else {
        console.warn(`[syncOutlookInvite] DoNotForward verification failed: ${verifyRes.status}`);
      }
    }

    const outlookEventId = created.id ?? event.outlookEventId ?? undefined;
    const outlookEventLink = created.webLink ?? event.outlookEventLink ?? undefined;

    await CalendarEvents.update({
      id: input.eventId,
      record: {
        inviteStatus: 'Enviado',
        ...(outlookEventId ? { outlookEventId } : {}),
        ...(outlookEventLink ? { outlookEventLink } : {}),
        inviteBodyHtml,
      },
    });

    return {
      success: true,
      outlookEventId,
      outlookEventLink,
      inviteStatus: 'Enviado',
      inviteBodyHtml,
      message: `Evento ${input.action === 'create' ? 'creado' : 'actualizado'} en Outlook`,
    };
  },
});
