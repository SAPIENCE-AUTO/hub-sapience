import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues, Boards } from '../../server/compat';
import { graphFetch, graphMailboxBase } from '../../server/microsoft/graph';
import { addHours, formatWhenText, buildEmailHtml, parseInviteTemplate, type InviteSection } from '../serverUtils/inviteHtml';

// Parse attendees string into Graph API format
function parseAttendees(raw?: string): { emailAddress: { address: string }; type: string }[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n\r]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(address => ({ emailAddress: { address }, type: 'required' }));
}

const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
const isLinkColumnName = (name: string) => ['link', 'liga'].includes(normalizeName(name));

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
    // truena si falta la variable de entorno, y eso no debe tumbar el import
    // del archivo completo al arrancar el server — solo debe fallar cuando se
    // invoca el endpoint, igual que las demás variables de entorno de la app.
    // Los eventos de sesiones salen del buzón de calendario, no del de compras
    // (MS_SEND_AS_EMAIL, que usan los otros 4 endpoints de correo).
    const GRAPH_BASE = graphMailboxBase(process.env.MS_CALENDAR_EMAIL);

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
    const valueByColId: Record<string, string> = {};
    const colNameById = new Map<string, string>();
    let inviteTemplate: ReturnType<typeof parseInviteTemplate> = null;
    if (resolvedBoardId) {
      const [colRes, cellRes, boardRes] = await Promise.all([
        BoardColumns.findAll({ filters: { boardId: resolvedBoardId } as any, limit: 100 }),
        CellValues.findAll({ filters: { boardId: resolvedBoardId, rowId: input.eventId } as any, limit: 200 }),
        Boards.findOne({ id: resolvedBoardId }).catch(() => null),
      ]);

      for (const c of colRes.records) colNameById.set(c.id, c.columnName ?? c.id);
      for (const cell of cellRes.records) {
        if (!cell.columnId) continue;
        const value = String(cell.textValue ?? cell.numberValue ?? cell.dateValue ?? '');
        if (!value) continue;
        valueByColId[cell.columnId] = value;
        const colName = (colNameById.get(cell.columnId) ?? cell.columnId).toLowerCase();
        boardData[colName] = value;
      }
      inviteTemplate = parseInviteTemplate(boardRes?.inviteTemplateJson);
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

    // Quien captura la columna "Link" del tablero suele escribir solo el
    // dominio (p.ej. "www.youtube.com"), sin protocolo — un <a href> así lo
    // interpreta el navegador como ruta RELATIVA del sitio, no como URL
    // externa, y el botón "Unirse a la reunión" no lleva a ningún lado. Si no
    // trae ya un protocolo (://), se asume https.
    const toAbsoluteLink = (raw: string) => raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? `https://${raw}` : raw;
    const customHtml = pick('HTML Invite', 'htmlinvite', 'HTML Personalizado', 'htmlpersonalizado');

    // Este tablero de calendario configuró un template de invite propio
    // (botón "Configurar invitación") — se arma `sections` dinámicamente a
    // partir de las columnas que eligió, en el orden que eligió, en vez de
    // los 4 campos fijos de siempre. Sin template configurado, se preserva
    // exactamente el comportamiento de antes (fallback).
    let sections: InviteSection[];
    let link: string;
    if (inviteTemplate && inviteTemplate.selected.length > 0) {
      const selectedSet = new Set(inviteTemplate.selected);
      const orderedIds = inviteTemplate.order.filter(id => selectedSet.has(id));
      for (const id of inviteTemplate.selected) if (!orderedIds.includes(id)) orderedIds.push(id);

      const linkColId = orderedIds.find(id => isLinkColumnName(colNameById.get(id) ?? ''));
      sections = orderedIds
        .filter(id => id !== linkColId)
        .map(id => ({ label: colNameById.get(id) ?? id, value: valueByColId[id] ?? '' }));
      link = linkColId ? toAbsoluteLink(valueByColId[linkColId] ?? '') : '';
    } else {
      sections = [
        { label: 'Dinámica', value: pick('Dinámica', 'Dinamica', 'dinamica') },
        { label: 'Perfil', value: pick('Perfil', 'perfil') },
        { label: 'Descripción', value: pick('Descripción', 'descripcion') },
        { label: 'Detalles', value: pick('Detalles adicionales', 'Detalles', 'detalles') },
      ];
      link = toAbsoluteLink(pick('Link', 'link', 'Liga', 'liga'));
    }

    const whenText = formatWhenText(startIso, durationHours);
    const subject = event.eventName ?? 'Sesión';

    const inviteBodyHtml = (customHtml ? replaceTemplatePlaceholders(customHtml, boardData, whenText) : null) || buildEmailHtml({ subject, startIso, durationHours, sections, link });

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
