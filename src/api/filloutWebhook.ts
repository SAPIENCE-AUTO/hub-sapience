import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Participants, BoardColumns, CellValues, Projects } from 'zite-integrations-backend-sdk';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

type ProjectDates = { startDate?: string; endDate?: string; client?: string };

// Maps Fillout/generic field types to the board's column type vocabulary
const toColumnType = (type?: string): string => {
  if (!type) return 'Texto';
  const t = type.toLowerCase();
  if (t.includes('number') || t.includes('num') || t.includes('rating')) return 'Número';
  if (t.includes('date') || t.includes('time')) return 'Fecha';
  if (t.includes('bool') || t.includes('check') || t.includes('yesno')) return 'Checkbox';
  if (t.includes('select') || t.includes('choice') || t.includes('dropdown')) return 'Select';
  if (t.includes('email')) return 'Email';
  if (t.includes('phone') || t.includes('tel')) return 'Teléfono';
  if (t.includes('file') || t.includes('upload')) return 'Archivo';
  return 'Texto';
};

const buildParticipationNote = (
  allRows: { id: string; projectCode?: string; boardName?: string; status?: string; group?: string }[],
  newRecordId: string,
  currentProjectCode: string,
  currentBoardName: string,
  projectDatesMap: Map<string, ProjectDates> = new Map(),
): string => {
  const otherRows = allRows.filter(r => r.id !== newRecordId);
  if (otherRows.length === 0) return '';

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const normalizeStr = (s?: string) =>
    (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const currentClientNorm = normalizeStr(projectDatesMap.get(currentProjectCode)?.client);

  // ── 🟠 Orange: same board ×N ─────────────────────────────────────────────
  const sameBoardRows = otherRows.filter(
    r => r.projectCode === currentProjectCode && r.boardName === currentBoardName,
  );

  // ── Other board/project rows → 🔴 RED or 🔵 BLUE ─────────────────────────
  const otherBoardRows = otherRows.filter(
    r => !(r.projectCode === currentProjectCode && r.boardName === currentBoardName),
  );

  const redProjects  = new Map<string, string>();
  const blueProjects = new Map<string, string>();

  for (const r of otherBoardRows) {
    if (!r.projectCode) continue;
    const label       = r.boardName ? `${r.projectCode} (${r.boardName})` : r.projectCode;
    const participated = r.status === 'Asistió' || (!!r.group && r.group.trim() !== '');
    const projData    = projectDatesMap.get(r.projectCode);
    const otherEnd    = projData?.endDate ? new Date(projData.endDate) : null;
    const otherClient = normalizeStr(projData?.client);
    // Same client → always red regardless of time or participation
    const isSameClient     = !!currentClientNorm && !!otherClient && otherClient === currentClientNorm;
    // Recent/active: project hasn't ended OR ended within last 6 months
    const isRecentOrActive = !otherEnd || otherEnd > sixMonthsAgo;
    const isRed = isSameClient || (participated && isRecentOrActive);
    if (isRed) {
      redProjects.set(r.projectCode, label);
    } else if (!redProjects.has(r.projectCode)) {
      blueProjects.set(r.projectCode, label);
    }
  }

  const parts: string[] = [];
  if (redProjects.size > 0) {
    parts.push(`🔴 ALERTA: ${[...redProjects.values()].join(', ')}.`);
  }
  const blueLabels = [...blueProjects.entries()]
    .filter(([k]) => !redProjects.has(k))
    .map(([, v]) => v);
  if (blueLabels.length > 0) {
    parts.push(`🔵 DUPLICADO EXTERNO: ${blueLabels.join(', ')}.`);
  }
  if (sameBoardRows.length > 0) {
    parts.push(`🟠 ×${sameBoardRows.length + 1} EN ESTE TABLERO`);
  }

  return parts.join(' ');
};

export default createEndpoint({
  description: 'Receive form submissions from Fillout and create recruitment rows. Supports arbitrary custom fields that auto-create dynamic columns. UUID-first writes.',
  inputSchema: z.object({
    projectCode: z.string().optional(),
    boardName: z.string().optional(),
    participantName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    idNumber: z.string().optional(),
    city: z.string().optional(),
    gender: z.string().optional(),
    age: z.number().optional(),
    sourceForm: z.string().optional(),
    customFields: z.array(z.object({
      fieldName: z.string(),
      value: z.string().optional(),
      type: z.string().optional(),
    })).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    // ── 1. Upsert participant in global registry ─────────────────────────────
    if (input.participantName || input.email) {
      await Participants.bulkCreate({
        records: [{
          fullName: input.participantName,
          email: input.email,
          phone: input.phone,
          idNumber: input.idNumber,
          city: input.city,
          gender: input.gender,
          age: input.age,
        }],
        matchOn: input.email ? ['email'] : undefined,
      });
    }

    const resolvedBoardName = input.boardName ?? 'Principal';

    // Dual-write: resolve boardId UUID before creating
    let boardIdUUID: string | undefined;
    if (input.projectCode && resolvedBoardName) {
      const lookup = await lookupBoardUUID(input.projectCode, resolvedBoardName, 'recruitment');
      if (lookup.found && lookup.uuid) {
        boardIdUUID = lookup.uuid;
      } else {
        console.warn('[filloutWebhook] boardId lookup failed, leaving empty', { projectCode: input.projectCode, boardName: resolvedBoardName, reason: lookup.reason });
      }
    }

    // ── 2. Create recruitment row ────────────────────────────────────────────
    const record = await RecruitmentRows.create({
      record: {
        rowName: input.participantName ?? input.email ?? 'Sin nombre',
        projectCode: input.projectCode,
        boardName: resolvedBoardName,
        boardId: boardIdUUID,
        participantName: input.participantName,
        email: input.email,
        phone: input.phone,
        idNumber: input.idNumber,
        status: 'Pendiente',
        sourceForm: input.sourceForm,
        level: 0,
        rowOrder: Math.floor(Date.now() / 1000),
      },
    });

    // ── 3. Handle custom fields → dynamic columns + cell values (UUID-first) ─
    if (input.customFields && input.customFields.length > 0) {
      const legacyBoardId = `recruitment-${input.projectCode ?? 'all'}-${resolvedBoardName}`;

      // Resolve to UUID when possible
      const resolution = await resolveWriteBoardId(legacyBoardId, {
        projectCode: input.projectCode ?? 'all',
        boardName: resolvedBoardName,
        boardType: 'recruitment',
      });
      const writeBoardId = resolution.writeBoardId;

      if (resolution.reason === 'legacy-fallback' || resolution.reason === 'input-passthrough') {
        console.warn('[filloutWebhook] legacy fallback for custom fields', {
          legacyBoardId,
          reason: resolution.reason,
        });
      }

      // Dual-read BoardColumns: UUID first, then legacy if different
      const { records: primaryCols } = await BoardColumns.findAll({
        filters: { boardId: writeBoardId },
        limit: 200,
      });

      let allCols = [...primaryCols];

      // If legacy differs from write, also fetch legacy cols to avoid duplicates
      if (resolution.legacyBoardId && resolution.legacyBoardId !== writeBoardId) {
        const { records: legacyCols } = await BoardColumns.findAll({
          filters: { boardId: resolution.legacyBoardId },
          limit: 200,
        });
        // Merge: add legacy cols not already present by name
        const existingNames = new Set(
          primaryCols.map(c => (c.columnName ?? '').toLowerCase()),
        );
        for (const lc of legacyCols) {
          if (lc.columnName && !existingNames.has(lc.columnName.toLowerCase())) {
            allCols.push(lc);
            existingNames.add(lc.columnName.toLowerCase());
          }
        }
      }

      const colByName = new Map<string, string>();
      for (const col of allCols) {
        if (col.columnName) colByName.set(col.columnName.toLowerCase(), col.id);
      }

      const cellRecords: Array<{
        boardId: string;
        rowId: string;
        columnId: string;
        textValue?: string;
      }> = [];

      for (const field of input.customFields) {
        if (!field.fieldName || field.value === undefined || field.value === '') continue;

        const key = field.fieldName.toLowerCase();
        let columnId = colByName.get(key);

        if (!columnId) {
          // Create new column under UUID boardId
          const newCol = await BoardColumns.create({
            record: {
              columnName: field.fieldName,
              boardId: writeBoardId,
              columnType: toColumnType(field.type),
              columnOrder: allCols.length + cellRecords.length,
            },
          });
          columnId = newCol.id;
          colByName.set(key, columnId);
        }

        // CellValues under UUID boardId
        cellRecords.push({ boardId: writeBoardId, rowId: record.id, columnId, textValue: field.value });
      }

      if (cellRecords.length > 0) {
        await CellValues.bulkCreate({ records: cellRecords });
        // cellData denormalization doesn't depend on boardId
        await RecruitmentRows.update({
          id: record.id,
          record: {
            cellData: JSON.stringify(
              Object.fromEntries(cellRecords.map(c => [c.columnId, { textValue: c.textValue }]))
            ),
          },
        });
      }
    }

    // ── 4. 4-level participation/duplicate detection ─────────────────────────
    // (No changes needed — searches by RecruitmentRows, not by boardId)
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'endDate', 'client'],
    });
    const projectDatesMap = new Map<string, ProjectDates>();
    for (const p of allProjects) {
      if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, endDate: p.endDate });
    }

    if (input.projectCode && (input.email || input.participantName || input.phone)) {
      try {
        const detectionFields: string[] = ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'deletedAt'];
        const queries: Promise<{ records: any[] }>[] = [];
        if (input.email) {
          queries.push(RecruitmentRows.findAll({ filters: { email: input.email }, limit: 50, fields: detectionFields }));
        }
        if (input.participantName) {
          queries.push(RecruitmentRows.findAll({ filters: { participantName: { contains: input.participantName } }, limit: 50, fields: detectionFields }));
        }
        if (input.phone) {
          queries.push(RecruitmentRows.findAll({ filters: { phone: input.phone }, limit: 50, fields: detectionFields }));
        }
        const results = await Promise.all(queries);
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const { records } of results) {
          for (const r of records) {
            if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
          }
        }
        const activeExisting = merged.filter(r => !r.deletedAt);
        const note = buildParticipationNote(activeExisting, record.id, input.projectCode ?? '', resolvedBoardName, projectDatesMap);
        if (note) {
          await RecruitmentRows.update({ id: record.id, record: { notes: note } });
        }
      } catch { /* non-blocking */ }
    }

    return { success: true };
  },
});
