import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Participants, BoardColumns, CellValues, Projects } from '../../server/compat';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

type ProjectDates = { startDate?: string; endDate?: string; client?: string };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const CORE_NAME_EXACT = new Set(['nombre', 'name', 'nombre completo', 'full name', 'nombre del participante', 'nombre participante']);
const CORE_EMAIL_EXACT = new Set(['email', 'e-mail', 'correo', 'correo electronico', 'correo electronico', 'mail']);
const CORE_PHONE_EXACT = new Set(['telefono', 'telefono', 'phone', 'celular', 'numero de telefono', 'numero de celular', 'num telefono', 'num celular', 'tel']);
const CORE_ID_EXACT = new Set(['documento', 'cedula', 'cedula', 'id doc', 'numero de documento', 'identificacion', 'identificacion', 'num documento']);

const matchCore = (name: string): string | null => {
  const n = normalize(name);
  if (CORE_NAME_EXACT.has(n)) return 'participantName';
  if (CORE_EMAIL_EXACT.has(n)) return 'email';
  if (CORE_PHONE_EXACT.has(n)) return 'phone';
  if (CORE_ID_EXACT.has(n)) return 'idNumber';
  const words = n.split(/\s+/);
  if (words[0] === 'nombre' && words.length <= 3) return 'participantName';
  if ((words[0] === 'telefono' || words[0] === 'celular') && words.length <= 3) return 'phone';
  return null;
};

// Maps Fillout question types to board column types.
// dropdown/multiselect → Texto because values are free-form text strings.
const toColType = (type: string): string => {
  const t = (type ?? '').toLowerCase();
  if (['numberinput', 'number', 'currency'].includes(t)) return 'Número';
  if (['dateinput', 'date'].includes(t)) return 'Fecha';
  if (['datetimeinput', 'datetime'].includes(t)) return 'Datetime';
  if (['checkbox'].includes(t)) return 'Checkbox';
  if (['linearscale'].includes(t)) return 'Select';
  if (['emailinput', 'email'].includes(t)) return 'Email';
  if (['phoneinput', 'phonenumber', 'phone'].includes(t)) return 'Teléfono';
  if (['fileinput', 'fileupload', 'file'].includes(t)) return 'Archivo';
  return 'Texto';
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

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const normalizeStr = (s?: string) =>
    (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const currentClientNorm = normalizeStr(projectDatesMap.get(currentProjectCode)?.client);

  const sameBoardRows = otherRows.filter(
    r => r.projectCode === currentProjectCode && r.boardName === currentBoardName,
  );

  const otherBoardRows = otherRows.filter(
    r => !(r.projectCode === currentProjectCode && r.boardName === currentBoardName),
  );

  const redProjects  = new Map<string, string>();
  const blueProjects = new Map<string, string>();

  for (const r of otherBoardRows) {
    if (!r.projectCode) continue;
    const label        = r.boardName ? `${r.projectCode} (${r.boardName})` : r.projectCode;
    const participated = r.status === 'Asistió' || (!!r.group && r.group.trim() !== '');
    const projData     = projectDatesMap.get(r.projectCode);
    const otherEnd     = projData?.endDate ? new Date(projData.endDate) : null;
    const otherClient  = normalizeStr(projData?.client);
    const isSameClient     = !!currentClientNorm && !!otherClient && otherClient === currentClientNorm;
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
  authenticated: true,
  description: 'Pull new Fillout form submissions and import them as recruitment rows using ID-based column mapping',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({ imported: z.number(), total: z.number(), backfilled: z.number().optional() }),
  execute: async ({ input }) => {
    const apiKey = process.env.ZITE_FILLOUT_API_KEY ?? '';
    if (!apiKey) throw new Error('Fillout API key not configured');

    // ── Resolve boardId to UUID ─────────────────────────────────────────────
    let resolvedBoardId = input.boardId;
    let legacyBoardId: string | undefined = input.boardId;
    try {
      const res = await resolveWriteBoardId(input.boardId);
      resolvedBoardId = res.writeBoardId;
      legacyBoardId = res.legacyBoardId ?? input.boardId;
      if (res.reason === 'legacy-fallback' || res.reason === 'input-passthrough') {
        console.warn('[syncFilloutResponses] Board UUID not found, using legacy', { boardId: input.boardId, reason: res.reason });
      }
    } catch (err) {
      console.warn('[syncFilloutResponses] resolveWriteBoardId failed', { boardId: input.boardId, error: String(err) });
    }

    // ── 1. Find linked form for this board ────────────────────────────────
    // Dual-read: try UUID first, then legacy fallback for sentinel column
    let cols = (await BoardColumns.findAll({
      filters: { boardId: resolvedBoardId, columnType: '__fillout_link__' },
      limit: 5,
    })).records;
    if (cols.length === 0 && legacyBoardId && legacyBoardId !== resolvedBoardId) {
      cols = (await BoardColumns.findAll({
        filters: { boardId: legacyBoardId, columnType: '__fillout_link__' },
        limit: 5,
      })).records;
    }
    // ── Guard: deduplicate sentinel columns ──────────────────────────────
    // If multiple __fillout_link__ sentinels exist for the same board, keep the
    // one with the most mappings and silently delete the rest.
    if (cols.length > 1) {
      console.warn(`[syncFilloutResponses] Found ${cols.length} sentinel columns for board ${resolvedBoardId} — merging`);
      // Sort by mapping count descending so cols[0] becomes the richest sentinel
      cols.sort((a, b) => {
        const aLen = (() => { try { return (JSON.parse(a.optionsJson ?? '{}').questionMapping ?? []).length; } catch { return 0; } })();
        const bLen = (() => { try { return (JSON.parse(b.optionsJson ?? '{}').questionMapping ?? []).length; } catch { return 0; } })();
        return bLen - aLen;
      });
      // Delete extras (best-effort, non-blocking)
      for (let si = 1; si < cols.length; si++) {
        try { await BoardColumns.delete({ id: cols[si].id }); } catch { /* ignore */ }
      }
    }

    const linkCol = cols[0];
    if (!linkCol?.optionsJson) return { imported: 0, total: 0 };

    const meta = JSON.parse(linkCol.optionsJson) as {
      formId: string;
      formName: string;
      boardId: string;
      projectCode: string;
      boardName: string;
      questionMapping?: { filloutId: string; columnId: string; questionName: string }[];
    };
    const { formId, formName, projectCode, boardName } = meta;
    let questionMapping = meta.questionMapping ?? [];

    const idToColId = new Map<string, string>();
    for (const entry of questionMapping) {
      idToColId.set(entry.filloutId, entry.columnId);
    }

    // ── 1a. Detect new form questions added after initial link ─────────────
    // Fetch current form schema from Fillout
    const formSchemaRes = await fetch(`https://api.fillout.com/v1/api/forms/${formId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const currentFormQuestions: { id: string; name: string; type: string }[] = [];
    if (formSchemaRes.ok) {
      const formData = await formSchemaRes.json();
      currentFormQuestions.push(...(formData.questions ?? []));
    }

    // ── 1b. Fetch all board columns (for ordering + name dedup + type map) ─
    // Dual-read board columns: UUID first, legacy fallback
    const { records: boardColsUuid } = await BoardColumns.findAll({
      filters: { boardId: resolvedBoardId },
      limit: 500,
      fields: ['id', 'columnName', 'columnType', 'columnOrder'],
    });
    let boardCols = [...boardColsUuid];
    if (legacyBoardId && legacyBoardId !== resolvedBoardId) {
      const { records: boardColsLegacy } = await BoardColumns.findAll({
        filters: { boardId: legacyBoardId },
        limit: 500,
        fields: ['id', 'columnName', 'columnType', 'columnOrder'],
      });
      const seenNames = new Set(boardCols.map(c => c.columnName?.toLowerCase() ?? ''));
      for (const lc of boardColsLegacy) {
        if (!seenNames.has(lc.columnName?.toLowerCase() ?? '')) {
          boardCols.push(lc);
          seenNames.add(lc.columnName?.toLowerCase() ?? '');
        }
      }
    }
    const colIdToType = new Map(boardCols.map(c => [c.id, c.columnType ?? '']));

    // ── 1c. Auto-create columns for new questions not in the mapping ────────
    if (currentFormQuestions.length > 0) {
      const mappedFilloutIds = new Set(questionMapping.map(m => m.filloutId));
      // Columnas ya asignadas a OTRO filloutId (en este sync o en uno previo)
      // — nunca se le reasignan a una pregunta distinta, aunque el nombre
      // coincida. Ver linkFilloutForm.ts para el porqué completo: dos
      // preguntas distintas compartiendo columna pierden una respuesta cada
      // vez que ambas vienen contestadas en la misma submission.
      const claimedColIds = new Set(questionMapping.map(m => m.columnId));

      // Build a name→colId lookup for existing board columns
      const colByNorm = new Map<string, string>();
      for (const col of boardCols) {
        if (col.columnName && col.columnType !== '__fillout_link__') {
          colByNorm.set(normalize(col.columnName), col.id);
        }
      }

      const visibleColCount = boardCols.filter(c => c.columnType !== '__fillout_link__').length;

      // Partition new questions into "create" and "map to existing"
      const toCreate: { filloutId: string; name: string; type: string; orderOffset: number }[] = [];
      const toMapExisting: { filloutId: string; columnId: string; questionName: string }[] = [];
      const createdNorms = new Set<string>();

      for (const q of currentFormQuestions) {
        const name = (q.name ?? '').trim();
        if (!name) continue;
        if (mappedFilloutIds.has(q.id)) continue;  // already mapped
        if (matchCore(name)) continue;               // core field — handled separately

        const normName = normalize(name);
        const candidateColId = colByNorm.get(normName);

        // A column with this name already exists AND no other question in
        // this pass already claimed it → reuse it.
        if (candidateColId && !claimedColIds.has(candidateColId)) {
          claimedColIds.add(candidateColId);
          toMapExisting.push({ filloutId: q.id, columnId: candidateColId, questionName: name });
          continue;
        }

        // No column matches, or the matching one already belongs to a
        // different question — never share it, disambiguate the name instead.
        let finalName = name;
        let n = 2;
        while (createdNorms.has(normalize(finalName))) { finalName = `${name} (${n})`; n++; }
        createdNorms.add(normalize(finalName));
        toCreate.push({ filloutId: q.id, name: finalName, type: q.type, orderOffset: toCreate.length });
      }

      // Bulk-create new columns (batches of 100)
      const newMappingEntries: { filloutId: string; columnId: string; questionName: string }[] = [
        ...toMapExisting,
      ];

      if (toCreate.length > 0) {
        const BATCH = 100;
        for (let i = 0; i < toCreate.length; i += BATCH) {
          const batch = toCreate.slice(i, i + BATCH);
          const created = await BoardColumns.bulkCreate({
            records: batch.map(c => ({
              columnName: c.name,
              boardId: resolvedBoardId,
              columnType: toColType(c.type),
              columnOrder: visibleColCount + c.orderOffset,
            })),
          });
          for (let j = 0; j < created.records.length; j++) {
            const colId   = created.records[j].id;
            const colType = toColType(batch[j].type);
            newMappingEntries.push({ filloutId: batch[j].filloutId, columnId: colId, questionName: batch[j].name });
            colIdToType.set(colId, colType);
          }
        }
      }

      // Merge new entries into the mapping + update idToColId + persist if anything changed
      if (newMappingEntries.length > 0) {
        for (const e of newMappingEntries) {
          questionMapping.push(e);
          idToColId.set(e.filloutId, e.columnId);
        }
        // Persist updated mapping to the sentinel column
        try {
          await BoardColumns.update({
            id: linkCol.id,
            record: {
              optionsJson: JSON.stringify({ ...meta, questionMapping }),
            },
          });
        } catch { /* non-blocking — mapping will self-heal on next sync */ }
      }
    }

    // ── 1d. Fetch project dates for temporal 🔴 detection ─────────────────
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'endDate', 'client'],
    });
    const projectDatesMap = new Map<string, ProjectDates>();
    for (const p of allProjects) {
      if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, endDate: p.endDate });
    }

    // ── 2. Fetch ALL submissions from Fillout (paginated) ─────────────────
    const PAGE_SIZE = 150;
    let offset = 0;
    const submissions: any[] = [];
    while (true) {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(`https://api.fillout.com/v1/api/forms/${formId}/submissions?limit=${PAGE_SIZE}&offset=${offset}&status=finished&sort=asc`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (res.status === 429) {
          console.warn(`[syncFillout] 429 rate limit at offset ${offset}, attempt ${attempt + 1}/3 — waiting 2s`);
          await sleep(2000);
          continue;
        }
        break;
      }
      if (!res || !res.ok) break;
      const data = await res.json();
      const page: any[] = data.responses ?? data.submissions ?? (Array.isArray(data) ? data : []);
      if (page.length === 0) break;
      submissions.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      await sleep(1000);
    }

    if (submissions.length === 0) return { imported: 0, total: 0 };

    // ── 3. Get existing rows (single query, build lookup for dedup + backfill) ─
    // Antes esto solo servía para NO duplicar filas — una submission de
    // alguien que ya tenía fila se saltaba entera. Eso significaba que una
    // pregunta agregada al form DESPUÉS de que la persona ya contestó
    // (ej. el form se editó en Fillout) nunca le llenaba esa celda, ni
    // volviendo a correr el sync — el resync siempre trae el historial
    // completo, pero nunca revisitaba filas ya existentes para completarles
    // columnas nuevas. Ahora si la fila ya existe, en vez de saltarse toda
    // la submission se completan solo las columnas que le falten.
    await sleep(100);
    const { records: existingRows } = await RecruitmentRows.findAll({
      filters: { boardName, projectCode },
      limit: 2000,
      fields: ['id', 'email', 'participantName', 'sourceForm', 'cellData'],
    });

    type RowRef = { id: string; cellData: Record<string, unknown> };
    const parseCellData = (raw?: string): Record<string, unknown> => {
      try { return JSON.parse(raw ?? '{}'); } catch { return {}; }
    };

    const emailToRow = new Map<string, RowRef>();
    const nameToRow = new Map<string, RowRef>();
    const submissionIdToRow = new Map<string, RowRef>();
    for (const r of existingRows) {
      const ref: RowRef = { id: r.id, cellData: parseCellData(r.cellData) };
      const emailLower = r.email?.toLowerCase();
      const nameNorm = normalize(r.participantName ?? '');
      if (emailLower) emailToRow.set(emailLower, ref);
      if (nameNorm) nameToRow.set(nameNorm, ref);
      if (r.sourceForm?.includes('|')) {
        const parts = r.sourceForm.split('|');
        const sid = parts[parts.length - 1];
        if (sid) submissionIdToRow.set(sid, ref);
      }
    }

    const backfillMissingCells = async (row: RowRef, cells: { columnId: string; value: string }[]) => {
      const missing = cells.filter(c => !(c.columnId in row.cellData));
      if (missing.length === 0) return;
      const cellRecords = missing.map(c => {
        const isFile = colIdToType.get(c.columnId) === 'Archivo';
        return {
          boardId: resolvedBoardId,
          rowId: row.id,
          columnId: c.columnId,
          ...(isFile ? { fileUrl: c.value } : { textValue: c.value }),
        };
      });
      for (let ci = 0; ci < cellRecords.length; ci += 100) {
        await CellValues.bulkCreate({ records: cellRecords.slice(ci, ci + 100) });
      }
      for (const c of missing) {
        const isFile = colIdToType.get(c.columnId) === 'Archivo';
        row.cellData[c.columnId] = isFile ? { fileUrl: c.value } : { textValue: c.value };
      }
      await RecruitmentRows.update({ id: row.id, record: { cellData: JSON.stringify(row.cellData) } });
    };

    // ── 4. Process submissions in small batches to stay under rate limit ──
    let imported = 0;
    let backfilled = 0;
    const BATCH_SIZE = 3;
    const BATCH_DELAY_MS = 600;

    for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
      const batch = submissions.slice(i, i + BATCH_SIZE);

      for (const submission of batch) {
        // Una submission fallida no debe abortar el resto del lote — antes sí,
        // y el front reportaba "error" aunque N-1 de N ya hubieran importado bien.
        try {
        const questions: any[] = submission.questions ?? submission.answers ?? [];

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

        if (!coreFields.participantName && !coreFields.email) continue;

        const submissionId = String(submission.submissionId ?? submission.id ?? '');
        const sourceFormValue = submissionId ? `${formName}|${submissionId}` : formName;

        const emailLower = coreFields.email?.toLowerCase() ?? '';
        const normName   = normalize(coreFields.participantName ?? '');

        const matchedRow =
          (submissionId ? submissionIdToRow.get(submissionId) : undefined) ??
          (emailLower ? emailToRow.get(emailLower) : undefined) ??
          (!emailLower && normName ? nameToRow.get(normName) : undefined);

        if (matchedRow) {
          const before = Object.keys(matchedRow.cellData).length;
          await backfillMissingCells(matchedRow, cellsToWrite);
          backfilled += Object.keys(matchedRow.cellData).length - before;
          continue;
        }

        await Participants.bulkCreate({
          records: [{ fullName: coreFields.participantName, email: coreFields.email, phone: coreFields.phone, idNumber: coreFields.idNumber }],
          matchOn: coreFields.email ? ['email'] : undefined,
        });

        const record = await RecruitmentRows.create({
          record: {
            rowName: coreFields.participantName ?? coreFields.email ?? 'Sin nombre',
            projectCode, boardName,
            boardId: resolvedBoardId,
            participantName: coreFields.participantName,
            email: coreFields.email,
            phone: coreFields.phone,
            idNumber: coreFields.idNumber,
            status: 'Pendiente',
            sourceForm: sourceFormValue,
            level: 0,
          },
        });

        const newRowRef: RowRef = { id: record.id, cellData: {} };
        if (emailLower) emailToRow.set(emailLower, newRowRef);
        if (normName)   nameToRow.set(normName, newRowRef);
        if (submissionId) submissionIdToRow.set(submissionId, newRowRef);

        if (cellsToWrite.length > 0) {
          const cellRecords = cellsToWrite.map(c => {
            const isFile = colIdToType.get(c.columnId) === 'Archivo';
            return {
              boardId: resolvedBoardId,
              rowId: record.id,
              columnId: c.columnId,
              ...(isFile ? { fileUrl: c.value } : { textValue: c.value }),
            };
          });
          for (let ci = 0; ci < cellRecords.length; ci += 100) {
            await CellValues.bulkCreate({ records: cellRecords.slice(ci, ci + 100) });
          }
          const cellDataObj = Object.fromEntries(cellsToWrite.map(c => {
            const isFile = colIdToType.get(c.columnId) === 'Archivo';
            return [c.columnId, isFile ? { fileUrl: c.value } : { textValue: c.value }];
          }));
          newRowRef.cellData = cellDataObj;
          await RecruitmentRows.update({
            id: record.id,
            record: { cellData: JSON.stringify(cellDataObj) },
          });
        }

        // ── Participation / duplicate detection ────────────────────────────
        try {
          const detectionFields: string[] = ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'deletedAt'];
          const queries: Promise<{ records: any[] }>[] = [];
          if (coreFields.email) {
            queries.push(RecruitmentRows.findAll({ filters: { email: coreFields.email }, limit: 50, fields: detectionFields }));
          }
          if (coreFields.participantName) {
            queries.push(RecruitmentRows.findAll({ filters: { participantName: { contains: coreFields.participantName } }, limit: 50, fields: detectionFields }));
          }
          if (coreFields.phone) {
            queries.push(RecruitmentRows.findAll({ filters: { phone: coreFields.phone }, limit: 50, fields: detectionFields }));
          }
          if (queries.length > 0) {
            const results = await Promise.all(queries);
            const seen = new Set<string>();
            const merged: any[] = [];
            for (const { records } of results) {
              for (const r of records) {
                if (!seen.has(r.id)) { seen.add(r.id); merged.push(r); }
              }
            }
            const activedupes = merged.filter(r => !r.deletedAt);
            const note = buildParticipationNote(activedupes, record.id, projectCode, boardName, projectDatesMap);
            if (note) {
              await RecruitmentRows.update({ id: record.id, record: { notes: note } });
            }
          }
        } catch { /* non-blocking */ }

        imported++;
        } catch (err) {
          console.error('[syncFilloutResponses] Fallo al importar una submission — se omite y se sigue con el resto', {
            submissionId: submission.submissionId ?? submission.id, error: String(err),
          });
        }
      }

      if (i + BATCH_SIZE < submissions.length) await sleep(BATCH_DELAY_MS);
    }

    // ── 5. Backfill notes on existing rows that match any newly imported row ──
    if (imported > 0) {
      try {
        const detectionFields: string[] = ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'notes', 'deletedAt'];

        const { records: allProjectRows } = await RecruitmentRows.findAll({
          filters: { projectCode },
          limit: 2000,
          fields: detectionFields,
        });
        const allActive = allProjectRows.filter(r => !r.deletedAt);

        const normalizeLocal = (s: string) =>
          s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

        const emailMap  = new Map<string, string[]>();
        const nameMap   = new Map<string, string[]>();
        const phoneMap  = new Map<string, string[]>();
        for (const r of allActive) {
          if (r.email) {
            const k = r.email.toLowerCase().trim();
            if (!emailMap.has(k)) emailMap.set(k, []);
            emailMap.get(k)!.push(r.id);
          }
          if (r.participantName) {
            const k = normalizeLocal(r.participantName);
            if (k.length > 2) {
              if (!nameMap.has(k)) nameMap.set(k, []);
              nameMap.get(k)!.push(r.id);
            }
          }
          if (r.phone) {
            const k = r.phone.replace(/[\s\-().+]/g, '');
            if (k.length >= 7) {
              if (!phoneMap.has(k)) phoneMap.set(k, []);
              phoneMap.get(k)!.push(r.id);
            }
          }
        }

        const rowById = new Map(allActive.map(r => [r.id, r]));

        for (const row of allActive) {
          if (!row.projectCode) continue;
          const peerIds = new Set<string>();
          if (row.email) for (const id of emailMap.get(row.email.toLowerCase().trim()) ?? []) peerIds.add(id);
          if (row.participantName) {
            const k = normalizeLocal(row.participantName);
            if (k.length > 2) for (const id of nameMap.get(k) ?? []) peerIds.add(id);
          }
          if (row.phone) {
            const k = row.phone.replace(/[\s\-().+]/g, '');
            if (k.length >= 7) for (const id of phoneMap.get(k) ?? []) peerIds.add(id);
          }
          if (peerIds.size <= 1) continue;

          const peers = [...peerIds]
            .filter(id => id !== row.id)
            .map(id => rowById.get(id))
            .filter((r): r is typeof row => !!r);

          const newNote = buildParticipationNote(
            [row, ...peers],
            row.id,
            row.projectCode,
            row.boardName ?? '',
            projectDatesMap,
          );

          if (newNote !== (row.notes ?? '')) {
            await RecruitmentRows.update({ id: row.id, record: { notes: newNote || undefined } });
            await sleep(50);
          }
        }
      } catch { /* non-blocking */ }
    }

    return { imported, total: submissions.length, backfilled };
  },
});
