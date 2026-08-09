import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Participants, BoardColumns, CellValues, Projects } from '../../server/compat';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

type ProjectDates = { startDate?: string; endDate?: string };

const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const CORE_NAME_EXACT  = new Set(['nombre', 'name', 'nombre completo', 'full name', 'nombre del participante', 'nombre participante']);
const CORE_EMAIL_EXACT = new Set(['email', 'e-mail', 'correo', 'correo electronico', 'mail']);
const CORE_PHONE_EXACT = new Set(['telefono', 'telefono', 'phone', 'celular', 'numero de telefono', 'numero de celular', 'tel']);
const CORE_ID_EXACT    = new Set(['documento', 'cedula', 'cedula', 'id doc', 'numero de documento', 'identificacion', 'identificacion', 'num documento']);

const matchCore = (name: string): string | null => {
  const n = normalize(name);
  if (CORE_NAME_EXACT.has(n))  return 'participantName';
  if (CORE_EMAIL_EXACT.has(n)) return 'email';
  if (CORE_PHONE_EXACT.has(n)) return 'phone';
  if (CORE_ID_EXACT.has(n))    return 'idNumber';
  const words = n.split(/\s+/);
  if (words[0] === 'nombre' && words.length <= 3) return 'participantName';
  if ((words[0] === 'telefono' || words[0] === 'celular') && words.length <= 3) return 'phone';
  return null;
};

/**
 * Converts a raw string value to the correct typed cell value object
 * based on the BoardColumn type. Ensures Número→numberValue, Fecha→dateValue, etc.
 */
const toTypedValue = (rawValue: string, colType: string): Record<string, unknown> => {
  if (!rawValue) return {};
  switch (colType) {
    case 'Número': {
      const cleaned = rawValue.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
      const n = parseFloat(cleaned);
      return isNaN(n) ? { textValue: rawValue } : { numberValue: n };
    }
    case 'Fecha':
    case 'Datetime':
      return { dateValue: rawValue };
    case 'Checkbox':
      return { booleanValue: ['true', '1', 'sí', 'si', 'yes', 'x'].includes(rawValue.toLowerCase().trim()) };
    case 'Archivo':
      return { fileUrl: rawValue };
    default:
      return { textValue: rawValue };
  }
};

const toText = (rawVal: unknown): string => {
  if (rawVal == null) return '';
  if (typeof rawVal === 'string') return rawVal.trim();
  if (typeof rawVal === 'number' || typeof rawVal === 'boolean') return String(rawVal);
  if (Array.isArray(rawVal)) {
    if (rawVal.length > 0 && typeof rawVal[0] === 'object' && rawVal[0] !== null && 'url' in rawVal[0]) {
      return rawVal.map((f: any) => f.url ?? f.filename ?? '').filter(Boolean).join(', ');
    }
    return rawVal.map(v => String(v)).filter(Boolean).join(', ');
  }
  if (typeof rawVal === 'object' && rawVal !== null) {
    if ('url' in rawVal) return (rawVal as any).url ?? '';
    return JSON.stringify(rawVal);
  }
  return '';
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

  const parts: string[] = [];
  const currentDates = projectDatesMap.get(currentProjectCode);
  const currentStart = currentDates?.startDate ? new Date(currentDates.startDate) : null;

  const diffProjectRows = otherRows.filter(r => r.projectCode && r.projectCode !== currentProjectCode);
  const participatedProjects = new Map<string, string>();
  const externalDupProjects  = new Map<string, string>();

  for (const r of diffProjectRows) {
    if (!r.projectCode) continue;
    const label = r.boardName ? `${r.projectCode} (${r.boardName})` : r.projectCode;
    const meetsParticipation = r.status === 'Asistió' || (!!r.group && r.group.trim() !== '');
    if (meetsParticipation) {
      const otherDates = projectDatesMap.get(r.projectCode);
      const otherEnd   = otherDates?.endDate ? new Date(otherDates.endDate) : null;
      const confirmedBefore = currentStart && otherEnd && otherEnd < currentStart;
      if (confirmedBefore) {
        participatedProjects.set(r.projectCode, label);
      } else if (!participatedProjects.has(r.projectCode) && !externalDupProjects.has(r.projectCode)) {
        externalDupProjects.set(r.projectCode, label);
      }
    } else if (!participatedProjects.has(r.projectCode) && !externalDupProjects.has(r.projectCode)) {
      externalDupProjects.set(r.projectCode, label);
    }
  }

  if (participatedProjects.size > 0) parts.push(`🔴 YA PARTICIPÓ: ${[...participatedProjects.values()].join(', ')}.`);
  const extLabels = [...externalDupProjects.entries()].filter(([k]) => !participatedProjects.has(k)).map(([, v]) => v);
  if (extLabels.length > 0) parts.push(`🟡 DUPLICADO EXTERNO: ${extLabels.join(', ')}.`);

  const sameProjectDiffBoard = otherRows.filter(r => r.projectCode === currentProjectCode && r.boardName && r.boardName !== currentBoardName);
  if (sameProjectDiffBoard.length > 0) {
    const boardNames = [...new Set(sameProjectDiffBoard.map(r => r.boardName).filter(Boolean) as string[])];
    parts.push(`🟠 MISMO PROYECTO: ${boardNames.join(', ')}.`);
  }

  const internalRows = otherRows.filter(r => r.projectCode === currentProjectCode && r.boardName === currentBoardName);
  if (internalRows.length > 0) parts.push(`🔵 ×${internalRows.length + 1} EN ESTE TABLERO`);

  return parts.join(' ');
};

const questionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  value: z.unknown().optional(),
});

export default createEndpoint({
  authenticated: false,
  description: 'Receives real-time form submissions directly from Fillout webhooks',
  inputSchema: z.object({
    formId: z.string().optional(),
    submissionId: z.string().optional(),
    // Fillout may send questions at the top level or nested inside submission
    questions: z.array(questionSchema).optional(),
    answers: z.array(questionSchema).optional(),
    submission: z.object({
      questions: z.array(questionSchema).optional(),
      answers: z.array(questionSchema).optional(),
    }).optional(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const formId = input.formId;
    if (!formId) return { success: true };

    // ── 1. Find the board linked to this formId ────────────────────────────
    const { records: linkCols } = await BoardColumns.findAll({
      filters: { columnType: '__fillout_link__' },
      limit: 200,
    });

    const linkCol = linkCols.find(col => {
      if (!col.optionsJson) return false;
      try {
        const meta = JSON.parse(col.optionsJson);
        return meta.formId === formId;
      } catch { return false; }
    });

    if (!linkCol?.optionsJson) return { success: true };

    const meta = JSON.parse(linkCol.optionsJson) as {
      formId: string;
      formName: string;
      boardId: string;
      legacyBoardId?: string;
      projectCode: string;
      boardName: string;
      questionMapping?: { filloutId: string; columnId: string; questionName: string }[];
    };
    const { projectCode, boardName, formName, questionMapping = [] } = meta;

    // ── Resolve boardId: if meta.boardId is legacy (pre-migration link), try UUID ─
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let boardId = meta.boardId;
    if (!UUID_RE.test(boardId) && projectCode && boardName) {
      const lookup = await lookupBoardUUID(projectCode, boardName, 'recruitment');
      if (lookup.found && lookup.uuid) {
        console.log('[filloutNativeWebhook] Resolved legacy meta.boardId to UUID', {
          legacy: boardId, uuid: lookup.uuid,
        });
        boardId = lookup.uuid;
      } else {
        console.warn('[filloutNativeWebhook] Could not resolve legacy meta.boardId, using as-is', {
          boardId, reason: lookup.reason,
        });
      }
    }

    const idToColId = new Map<string, string>();
    for (const entry of questionMapping) idToColId.set(entry.filloutId, entry.columnId);

    // ── 1b. Fetch board column types ──────────────────────────────────────
    const { records: boardCols } = await BoardColumns.findAll({
      filters: { boardId },
      limit: 500,
      fields: ['id', 'columnType'],
    });
    const colIdToType = new Map(boardCols.map(c => [c.id, c.columnType ?? '']));

    // ── 2. Extract questions from the payload ─────────────────────────────
    const questions: any[] =
      input.questions ??
      input.answers ??
      input.submission?.questions ??
      input.submission?.answers ??
      [];

    if (questions.length === 0) return { success: true };

    // ── 3. Parse core fields and dynamic cells ────────────────────────────
    const coreFields: Record<string, string> = {};
    const cellsToWrite: { columnId: string; value: string }[] = [];

    for (const q of questions) {
      const name  = (q.name ?? q.label ?? '').trim();
      const value = toText(q.value);
      const coreKey = matchCore(name);
      if (coreKey && value) coreFields[coreKey] = value;
      const colId = idToColId.get(q.id);
      if (colId && value) cellsToWrite.push({ columnId: colId, value });
    }

    if (!coreFields.participantName && !coreFields.email) return { success: true };

    // ── 4. Dedup check ────────────────────────────────────────────────────
    const emailLower = coreFields.email?.toLowerCase() ?? '';
    const existingChecks: Promise<{ records: any[] }>[] = [];
    if (emailLower) existingChecks.push(RecruitmentRows.findAll({ filters: { email: emailLower, boardName, projectCode }, limit: 5, fields: ['id', 'email'] }));
    else if (coreFields.participantName) existingChecks.push(RecruitmentRows.findAll({ filters: { participantName: { contains: coreFields.participantName }, boardName, projectCode }, limit: 5, fields: ['id', 'participantName'] }));

    if (existingChecks.length > 0) {
      const [result] = await Promise.all(existingChecks);
      if (result.records.length > 0) return { success: true };
    }

    // ── 5. Upsert participant ─────────────────────────────────────────────
    await Participants.bulkCreate({
      records: [{
        fullName: coreFields.participantName,
        email: coreFields.email,
        phone: coreFields.phone,
        idNumber: coreFields.idNumber,
      }],
      matchOn: coreFields.email ? ['email'] : undefined,
    });

    // ── 6. Create recruitment row ─────────────────────────────────────────
    // boardId is already resolved to UUID above (via lookupBoardUUID)
    const UUID_RE_CHECK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const resolvedRowBoardId = UUID_RE_CHECK.test(boardId) ? boardId : undefined;
    if (!resolvedRowBoardId) {
      console.warn('[filloutNativeWebhook] boardId is not a UUID, skipping boardId on row', { boardId });
    }

    const record = await RecruitmentRows.create({
      record: {
        rowName: coreFields.participantName ?? coreFields.email ?? 'Sin nombre',
        projectCode, boardName,
        boardId: resolvedRowBoardId,
        participantName: coreFields.participantName,
        email: coreFields.email,
        phone: coreFields.phone,
        idNumber: coreFields.idNumber,
        status: 'Pendiente',
        sourceForm: formName,
        level: 0,
      },
    });

    // ── 7. Write cell values — typed per column type ──────────────────────
    if (cellsToWrite.length > 0) {
      const cellRecords = cellsToWrite.map(c => {
        const colType = colIdToType.get(c.columnId) ?? 'Texto';
        return {
          boardId,
          rowId: record.id,
          columnId: c.columnId,
          ...toTypedValue(c.value, colType),
        };
      });
      for (let ci = 0; ci < cellRecords.length; ci += 100) {
        await CellValues.bulkCreate({ records: cellRecords.slice(ci, ci + 100) });
      }
      await RecruitmentRows.update({
        id: record.id,
        record: {
          cellData: JSON.stringify(
            Object.fromEntries(cellsToWrite.map(c => {
              const colType = colIdToType.get(c.columnId) ?? 'Texto';
              return [c.columnId, toTypedValue(c.value, colType)];
            }))
          ),
        },
      });
    }

    // ── 8. Duplicate detection ────────────────────────────────────────────
    try {
      const { records: allProjects } = await Projects.findAll({ limit: 500, fields: ['projectCode', 'startDate', 'endDate'] });
      const projectDatesMap = new Map<string, ProjectDates>();
      for (const p of allProjects) {
        if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, endDate: p.endDate });
      }

      const detectionFields = ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'deletedAt'];
      const queries: Promise<{ records: any[] }>[] = [];
      if (coreFields.email) queries.push(RecruitmentRows.findAll({ filters: { email: coreFields.email }, limit: 50, fields: detectionFields }));
      if (coreFields.participantName) queries.push(RecruitmentRows.findAll({ filters: { participantName: { contains: coreFields.participantName } }, limit: 50, fields: detectionFields }));
      if (coreFields.phone) queries.push(RecruitmentRows.findAll({ filters: { phone: coreFields.phone }, limit: 50, fields: detectionFields }));

      if (queries.length > 0) {
        const results = await Promise.all(queries);
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const { records } of results) {
          for (const r of records) { if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); } }
        }
        const activeRows = merged.filter(r => !r.deletedAt);
        const note = buildParticipationNote(activeRows, record.id, projectCode, boardName, projectDatesMap);
        if (note) await RecruitmentRows.update({ id: record.id, record: { notes: note } });
      }
    } catch { /* non-blocking */ }

    return { success: true };
  },
});
