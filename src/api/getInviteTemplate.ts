import { z } from 'zod';
import { createEndpoint, Boards, BoardColumns } from '../../server/compat';
import { parseInviteTemplate, type InviteTemplateConfig } from '../serverUtils/inviteHtml';

const normalizeName = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s_-]+/g, '');
// Nombres que el invite ya muestra hoy (fallback fijo en syncOutlookInvite.ts)
// cuando el calendario nunca configuró su propio template — se usan como
// selección inicial sugerida la primera vez que alguien abre el
// configurador, en vez de arrancar con todo vacío o todo marcado.
const LEGACY_DEFAULT_NAMES = new Set(['dinamica', 'perfil', 'descripcion', 'detallesadicionales', 'detalles', 'link', 'liga']);

export default createEndpoint({
  authenticated: true,
  description: 'Get a calendar board\'s dynamic columns plus its saved (or suggested default) invite template selection/order',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({
    columns: z.array(z.object({ id: z.string(), title: z.string(), type: z.string().optional() })),
    selectedIds: z.array(z.string()),
  }),
  execute: async ({ input }) => {
    const board = await Boards.findOne({ id: input.boardId });
    if (!board) throw new Error('Calendario no encontrado.');

    const { records } = await BoardColumns.findAll({ filters: { boardId: input.boardId } as any, limit: 200 });
    const activeCols = records
      .filter(c => !c.deletedAt)
      .sort((a, b) => (a.columnOrder ?? 0) - (b.columnOrder ?? 0));

    const columns = activeCols.map(c => ({ id: c.id, title: c.columnName ?? c.id, type: c.columnType ?? undefined }));
    const allIds = new Set(columns.map(c => c.id));

    const saved: InviteTemplateConfig | null = parseInviteTemplate(board.inviteTemplateJson);

    let orderedColumns = columns;
    let selectedIds: string[];

    if (saved) {
      const savedOrder = saved.order.filter(id => allIds.has(id));
      const savedSelected = saved.selected.filter(id => allIds.has(id));
      const inOrder = savedOrder.map(id => columns.find(c => c.id === id)!).filter(Boolean);
      const remainder = columns.filter(c => !savedOrder.includes(c.id));
      orderedColumns = [...inOrder, ...remainder];
      selectedIds = savedSelected;
    } else {
      // Sin template guardado: sugiere los campos que el invite ya muestra
      // hoy por el fallback fijo, para que el primer vistazo al configurador
      // refleje lo que el equipo ya está viendo en sus invites actuales.
      selectedIds = columns.filter(c => LEGACY_DEFAULT_NAMES.has(normalizeName(c.title))).map(c => c.id);
    }

    return { columns: orderedColumns, selectedIds };
  },
});
