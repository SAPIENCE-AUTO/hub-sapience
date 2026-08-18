import { z } from 'zod';
import { createEndpoint, CalendarEvents, BoardColumns, CellValues } from '../../server/compat';
import { buildEmailHtml, type InviteSection } from '../serverUtils/inviteHtml';

const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
const isLinkColumnName = (name: string) => ['link', 'liga'].includes(normalizeName(name));

// Datos de muestra cuando el tablero todavía no tiene ningún evento capturado
// — así el preview del configurador nunca sale en blanco.
const SAMPLE_VALUE = 'Texto de ejemplo — así se va a ver el contenido real de esta columna.';

export default createEndpoint({
  authenticated: true,
  description: 'Render a live preview of a calendar board\'s invite HTML for an in-progress (not yet saved) template selection/order',
  inputSchema: z.object({
    boardId: z.string(),
    order: z.array(z.string()),
    selected: z.array(z.string()),
  }),
  outputSchema: z.object({ html: z.string() }),
  execute: async ({ input }) => {
    const [colRes, sampleEventRes] = await Promise.all([
      BoardColumns.findAll({ filters: { boardId: input.boardId } as any, limit: 200 }),
      CalendarEvents.findAll({ filters: { boardId: input.boardId } as any, limit: 1 }),
    ]);

    const colNameById = new Map(colRes.records.map(c => [c.id, c.columnName ?? c.id]));
    const sampleEvent = sampleEventRes.records[0];

    let valueByColId: Record<string, string> = {};
    if (sampleEvent) {
      const { records } = await CellValues.findAll({ filters: { boardId: input.boardId, rowId: sampleEvent.id } as any, limit: 200 });
      for (const cell of records) {
        if (!cell.columnId) continue;
        const value = String(cell.textValue ?? cell.numberValue ?? cell.dateValue ?? '');
        if (value) valueByColId[cell.columnId] = value;
      }
    }

    const selectedSet = new Set(input.selected);
    const orderedIds = input.order.filter(id => selectedSet.has(id));
    for (const id of input.selected) if (!orderedIds.includes(id)) orderedIds.push(id);

    const linkColId = orderedIds.find(id => isLinkColumnName(colNameById.get(id) ?? ''));
    const sections: InviteSection[] = orderedIds
      .filter(id => id !== linkColId)
      .map(id => ({ label: colNameById.get(id) ?? id, value: valueByColId[id] || SAMPLE_VALUE }));

    const rawLink = linkColId ? (valueByColId[linkColId] || 'https://teams.microsoft.com/ejemplo') : '';
    const link = rawLink && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawLink) ? `https://${rawLink}` : rawLink;

    const html = buildEmailHtml({
      subject: sampleEvent?.eventName ?? 'Nombre del evento',
      startIso: sampleEvent?.eventDate ?? new Date().toISOString(),
      durationHours: sampleEvent?.durationHours ?? 1,
      sections,
      link,
    });

    return { html };
  },
});
