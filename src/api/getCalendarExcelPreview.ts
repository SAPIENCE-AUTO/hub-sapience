import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { fetchCalendarExcelData } from '../serverUtils/calendarExcelData';

// Mismo formato guardado que ya usaba getCalendarExcelColumns.ts en Boards.excelColumnsJson:
// { order: string[], selected: string[] } — compat con el formato viejo (string[] plano).
type SavedConfig = { order: string[]; selected: string[] };

export default createEndpoint({
  authenticated: true,
  description: 'Trae todo lo que el diálogo de export a Excel de calendario necesita en una sola llamada: columnas disponibles, orden/selección guardados, y las filas reales de cada grupo — para armar un preview 100% en el cliente sin más viajes al servidor mientras el usuario reordena/selecciona.',
  inputSchema: z.object({
    projectCode: z.string(),
    calendarName: z.string().optional(),
    boardId: z.string().optional(),
  }),
  outputSchema: z.object({
    calendarTitle: z.string(),
    columns: z.array(z.object({
      id: z.string(),
      key: z.string(),
      title: z.string(),
      type: z.string(),
      optionsJson: z.string().nullable().optional(),
    })),
    order: z.array(z.string()),
    selectedIds: z.array(z.string()),
    nextVersion: z.number(),
    groups: z.array(z.object({
      groupId: z.string(),
      groupName: z.string(),
      colorId: z.string().nullable(),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    })),
    eventCount: z.number(),
  }),
  execute: async ({ input }) => {
    const { boardResult, calendarTitle, allDefs, groups, eventCount } = await fetchCalendarExcelData({
      projectCode: input.projectCode,
      calendarName: input.calendarName,
      boardId: input.boardId,
    });

    const allIds = new Set(allDefs.map(d => d.id));

    // Parsear config guardada (mismo formato/compat que getCalendarExcelColumns.ts)
    let savedOrder: string[] | null = null;
    let savedSelected: string[] | null = null;
    if (boardResult?.excelColumnsJson) {
      try {
        const parsed = JSON.parse(boardResult.excelColumnsJson);
        if (Array.isArray(parsed)) {
          savedSelected = (parsed as string[]).filter(id => allIds.has(id));
        } else if (parsed && Array.isArray(parsed.order) && Array.isArray(parsed.selected)) {
          const cfg = parsed as SavedConfig;
          savedOrder = cfg.order.filter((id: string) => allIds.has(id));
          savedSelected = cfg.selected.filter((id: string) => allIds.has(id));
        }
      } catch { /* JSON inválido — se usan los defaults */ }
    }

    const defById = new Map(allDefs.map(d => [d.id, d]));
    let orderedIds = allDefs.map(d => d.id);
    if (savedOrder && savedOrder.length > 0) {
      const inOrder = savedOrder.filter(id => defById.has(id));
      const remainder = allDefs.map(d => d.id).filter(id => !savedOrder!.includes(id));
      orderedIds = [...inOrder, ...remainder];
    }
    const selectedIds = savedSelected && savedSelected.length > 0 ? savedSelected : orderedIds;

    const nextVersion = (boardResult?.calendarVersion ?? 0) + 1;

    return {
      calendarTitle,
      columns: allDefs.map(d => ({ id: d.id, key: d.key, title: d.title, type: d.type, optionsJson: d.optionsJson ?? null })),
      order: orderedIds,
      selectedIds,
      nextVersion,
      groups,
      eventCount,
    };
  },
});
