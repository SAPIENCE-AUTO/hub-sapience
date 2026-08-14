import { z } from 'zod';
import { createEndpoint, Projects, Boards, Tasks, CalendarEvents, RecruitmentRows, CellValues } from '../../server/compat';
import { ensureCalendarDefaultColumns } from '../serverUtils/calendarDefaults';
import { ensureTimelineDefaultColumns } from '../serverUtils/timelineDefaults';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function batchUpdate<T extends { id: string }>(
  records: T[],
  updater: (r: T) => Promise<any>,
  batchSize = 15
) {
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await Promise.all(batch.map(updater));
    if (i + batchSize < records.length) await sleep(200);
  }
}

/**
 * Lee TODAS las páginas antes de tocar nada. Es obligatorio separar lectura de
 * escritura aquí: el filtro es `projectCode: oldCode`, el mismo campo que se
 * está actualizando. Si se pagina con offset mientras se muta la página
 * anterior, cada fila migrada deja de calzar con el filtro y el offset salta
 * más allá de lo que realmente queda — perdiendo el resto en silencio (visto
 * en pruebas: de 600 filas solo se migraban 500, quedaban 100 atoradas).
 */
async function fetchAllRecords<T extends { id: string }>(
  fetcher: (params: { offset: number; limit: number }) => Promise<{ records: T[]; hasMore: boolean }>,
  limit: number,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const result = await fetcher({ offset, limit });
    all.push(...result.records);
    hasMore = result.hasMore;
    offset += result.records.length;
  }
  return all;
}

/** Cascade a single oldCode → newCode across all related tables */
async function cascadeCode(oldCode: string, newCode: string) {
  const escaped = oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Tasks
  const allTasks = await fetchAllRecords(
    ({ offset, limit }) => Tasks.findAll({ filters: { projectCode: oldCode }, limit, offset, fields: ['id'] }),
    500,
  );
  await batchUpdate(allTasks, r => Tasks.update({ id: r.id, record: { projectCode: newCode } }));

  // 2. Boards
  const allBoards = await fetchAllRecords(
    ({ offset, limit }) => Boards.findAll({ filters: { projectCode: oldCode }, limit, offset, fields: ['id'] }),
    200,
  );
  await batchUpdate(allBoards, r => Boards.update({ id: r.id, record: { projectCode: newCode } } as any));

  // 3. CalendarEvents
  const allEvents = await fetchAllRecords(
    ({ offset, limit }) => CalendarEvents.findAll({ filters: { projectCode: oldCode }, limit, offset, fields: ['id'] }),
    500,
  );
  await batchUpdate(allEvents, r => CalendarEvents.update({ id: r.id, record: { projectCode: newCode } } as any));

  // 4. RecruitmentRows
  const allRows = await fetchAllRecords(
    ({ offset, limit }) => RecruitmentRows.findAll({ filters: { projectCode: oldCode }, limit, offset, fields: ['id'] }),
    500,
  );
  await batchUpdate(allRows, r => RecruitmentRows.update({ id: r.id, record: { projectCode: newCode } } as any));

  // 5. CellValues — boardId embeds the project code (e.g. "pm-OLDCODE-boardname")
  const prefixes = [`pm-${oldCode}-`, `cal-${oldCode}-`, `recruitment-${oldCode}-`];
  for (const prefix of prefixes) {
    const allCells = await fetchAllRecords(
      ({ offset, limit }) => CellValues.findAll({
        filters: { boardId: { contains: prefix } } as any,
        limit, offset, fields: ['id', 'boardId'],
      }),
      500,
    );
    await batchUpdate(allCells, r => {
      const newBoardId = (r.boardId ?? '').replace(
        new RegExp(`(pm|cal|recruitment)-${escaped}-`),
        `$1-${newCode}-`
      );
      return CellValues.update({ id: r.id, record: { boardId: newBoardId } } as any);
    });
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Create or update a project. If oldProjectCode differs from projectCode, cascades the rename to all related tables. Optionally pass additionalOldCodes to also cascade from other orphaned codes.',
  inputSchema: z.object({
    id: z.string().optional(),
    projectCode: z.string(),
    oldProjectCode: z.string().optional(),
    additionalOldCodes: z.array(z.string()).optional(), // Extra orphaned codes to cascade from
    fullName: z.string().optional(),
    status: z.string().optional(),
    client: z.string().optional(),
    tematica: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    description: z.string().optional(),
    lider: z.string().optional(),
    analistas: z.array(z.string()).optional(),
    moderadores: z.array(z.string()).optional(),
    asistentes: z.array(z.string()).optional(),
    muestra: z.string().optional(),
    muestraImagen: z.string().optional(),
    instruccionesDeAnalisis: z.string().optional(),
    dealVinculado: z.string().optional(), // solo se usa al crear — ver DealGeneralTab.handleCreateProject
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string(), cascaded: z.boolean().optional() }),
  execute: async ({ input, context }) => {
    const { id, oldProjectCode, projectCode, additionalOldCodes, fullName, status, client, tematica, startDate, endDate, description, lider, analistas, moderadores, asistentes, muestra, muestraImagen, instruccionesDeAnalisis, dealVinculado } = input;
    const now = new Date().toISOString();
    const updateFields: Record<string, any> = { projectCode, fullName, status, client, tematica, startDate, endDate, description };
    if (muestra !== undefined) updateFields.muestra = muestra;
    if (muestraImagen !== undefined) updateFields.muestraImagen = muestraImagen;
    if (instruccionesDeAnalisis !== undefined) updateFields.instruccionesDeAnalisis = instruccionesDeAnalisis;
    if (lider !== undefined) updateFields.lider = lider ? lider : null;
    if (analistas !== undefined) updateFields.analistas = analistas;
    if (moderadores !== undefined) updateFields.moderadores = moderadores;
    if (asistentes !== undefined) updateFields.asistentes = asistentes;

    if (id) {
      await Projects.update({ id, record: updateFields });

      // Collect all codes that need cascading
      const codesToCascade: string[] = [];
      if (oldProjectCode && oldProjectCode !== projectCode) {
        codesToCascade.push(oldProjectCode);
      }
      if (additionalOldCodes) {
        for (const c of additionalOldCodes) {
          if (c && c !== projectCode && !codesToCascade.includes(c)) {
            codesToCascade.push(c);
          }
        }
      }

      if (codesToCascade.length > 0) {
        for (const oldCode of codesToCascade) {
          await cascadeCode(oldCode, projectCode);
        }
        return { success: true, id, cascaded: true };
      }

      return { success: true, id };
    }

    // ── Create new project ─────────────────────────────────────────────────────
    const record = await Projects.create({
      record: {
        ...updateFields,
        ...(dealVinculado ? { dealVinculado: [dealVinculado] } : {}),
        createdBy: context.user!.email,
        createdAt: now,
      } as any,
    });

    // Auto-create a default calendar board for the new project
    const calendarBoard = await Boards.create({
      record: {
        boardName: 'Calendario',
        projectCode: input.projectCode,
        boardOrder: 0,
        boardType: 'calendar',
      } as any,
    });
    await ensureCalendarDefaultColumns(calendarBoard.id);

    // Auto-create a default Timeline board with 7 default tasks
    const timelineBoard = await Boards.create({
      record: {
        boardName: 'Timeline',
        projectCode: input.projectCode,
        boardOrder: 0,
        boardType: 'pm',
      } as any,
    });
    const timelineBoardId = timelineBoard.id;
    await ensureTimelineDefaultColumns(timelineBoardId);

    const DEFAULT_TASKS = [
      'Go Ahead',
      'Reclutamiento',
      'Envío de guía de tópicos',
      'Aprobación de guía de tópicos',
      'Fieldwork',
      'Análisis',
      'Reporte',
    ];

    await Tasks.bulkCreate({
      records: DEFAULT_TASKS.map((taskName, order) => ({
        taskName,
        projectCode: input.projectCode,
        boardName: 'Timeline',
        boardId: timelineBoardId,
        status: 'Pendiente',
        order,
      })) as any,
    });

    return { success: true, id: record.id };
  },
});
