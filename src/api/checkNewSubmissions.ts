import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Participants, BoardColumns, CellValues, Projects } from '../../server/compat';
import { resolveWriteBoardId } from '../serverUtils/smartWrite';

type ProjectDates = { startDate?: string; endDate?: string; client?: string };

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
  streaming: true,
  description: 'Lightweight delta-sync: fetches only new Fillout submissions since the last sync cursor. Fast path returns immediately if nothing new.',
  inputSchema: z.object({ boardId: z.string() }),
  outputSchema: z.object({ newCount: z.number(), total: z.number() }),
  execute: async ({ input, stream }) => {
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
        console.warn('[checkNewSubmissions] Board UUID not found, using legacy', { boardId: input.boardId, reason: res.reason });
      }
    } catch (err) {
      console.warn('[checkNewSubmissions] resolveWriteBoardId failed', { boardId: input.boardId, error: String(err) });
    }

    // ── 1. Read link metadata ─────────────────────────────────────────────
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
    const linkCol = cols[0];
    if (!linkCol?.optionsJson) return { newCount: 0, total: 0 };

    const meta = JSON.parse(linkCol.optionsJson) as {
      formId: string;
      formName: string;
      boardId: string;
      projectCode: string;
      boardName: string;
      lastSyncedAt?: string;
      questionMapping?: { filloutId: string; columnId: string; questionName: string }[];
    };
    const { formId, formName, projectCode, boardName } = meta;
    let questionMapping = meta.questionMapping ?? [];

    const idToColId = new Map<string, string>();
    for (const entry of questionMapping) idToColId.set(entry.filloutId, entry.columnId);

    // ── 1a. Detect new form questions added after initial link ─────────────
    const formSchemaRes = await fetch(`https://api.fillout.com/v1/api/forms/${formId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const currentFormQuestions: { id: string; name: string; type: string }[] = [];
    if (formSchemaRes.ok) {
      const formData = await formSchemaRes.json();
      currentFormQuestions.push(...(formData.questions ?? []));
    }

    // ── 1b. Fetch board columns (name + order for dedup, type for cell writes) ──
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

    // ── 1c. Auto-create columns for new questions not yet in the mapping ───
    if (currentFormQuestions.length > 0) {
      const mappedFilloutIds = new Set(questionMapping.map(m => m.filloutId));
      // Columnas ya asignadas a OTRO filloutId (en este sync o en uno previo)
      // — nunca se le reasignan a una pregunta distinta, aunque el nombre
      // coincida. Ver linkFilloutForm.ts para el porqué completo: dos
      // preguntas distintas compartiendo columna pierden una respuesta cada
      // vez que ambas vienen contestadas en la misma submission.
      const claimedColIds = new Set(questionMapping.map(m => m.columnId));

      const colByNorm = new Map<string, string>();
      for (const col of boardCols) {
        if (col.columnName && col.columnType !== '__fillout_link__') {
          colByNorm.set(normalize(col.columnName), col.id);
        }
      }

      const visibleColCount = boardCols.filter(c => c.columnType !== '__fillout_link__').length;

      const toCreate: { filloutId: string; name: string; type: string; orderOffset: number }[] = [];
      const toMapExisting: { filloutId: string; columnId: string; questionName: string }[] = [];
      const createdNorms = new Set<string>();

      for (const q of currentFormQuestions) {
        const name = (q.name ?? '').trim();
        if (!name) continue;
        if (mappedFilloutIds.has(q.id)) continue;
        if (matchCore(name)) continue;

        const normName = normalize(name);
        const candidateColId = colByNorm.get(normName);
        if (candidateColId && !claimedColIds.has(candidateColId)) {
          claimedColIds.add(candidateColId);
          toMapExisting.push({ filloutId: q.id, columnId: candidateColId, questionName: name });
          continue;
        }

        let finalName = name;
        let n = 2;
        while (createdNorms.has(normalize(finalName))) { finalName = `${name} (${n})`; n++; }
        createdNorms.add(normalize(finalName));
        toCreate.push({ filloutId: q.id, name: finalName, type: q.type, orderOffset: toCreate.length });
      }

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

      if (newMappingEntries.length > 0) {
        for (const e of newMappingEntries) {
          questionMapping.push(e);
          idToColId.set(e.filloutId, e.columnId);
        }
        try {
          await BoardColumns.update({
            id: linkCol.id,
            record: { optionsJson: JSON.stringify({ ...meta, questionMapping }) },
          });
        } catch { /* non-blocking — mapping self-heals on next sync */ }
      }
    }

    // ── 2. Compute afterDate with 5-min overlap window ────────────────────
    let afterDate: string | undefined;
    if (meta.lastSyncedAt) {
      const cursor = new Date(meta.lastSyncedAt);
      cursor.setMinutes(cursor.getMinutes() - 5);
      afterDate = cursor.toISOString();
    }

    // ── 3. Fetch delta from Fillout (paginated) ───────────────────────────
    const PAGE_SIZE = 50;
    const submissions: any[] = [];
    let offset = 0;

    while (true) {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort: 'asc',
        status: 'finished',
      });
      if (afterDate) params.set('afterDate', afterDate);

      const res = await fetch(`https://api.fillout.com/v1/api/forms/${formId}/submissions?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 429 || !res.ok) break;

      const data = await res.json();
      const page: any[] = data.responses ?? data.submissions ?? (Array.isArray(data) ? data : []);
      if (page.length === 0) break;
      submissions.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Fast path: nothing came back from Fillout
    if (submissions.length === 0) {
      if (!meta.lastSyncedAt) {
        const updatedMeta = { ...meta, lastSyncedAt: new Date().toISOString() };
        await BoardColumns.update({ id: linkCol.id, record: { optionsJson: JSON.stringify(updatedMeta) } });
      }
      return { newCount: 0, total: 0 };
    }

    // ── 4. Build set of already-imported submissionIds ────────────────────
    const { records: existingRows } = await RecruitmentRows.findAll({
      filters: { boardName, projectCode },
      limit: 2000,
      fields: ['email', 'participantName', 'sourceForm'],
    });

    const importedSubmissionIds = new Set<string>();
    const existingEmails = new Set<string>();
    const existingNames  = new Set<string>();

    for (const r of existingRows) {
      if (r.sourceForm && r.sourceForm.includes('|')) {
        const parts = r.sourceForm.split('|');
        if (parts.length >= 2) importedSubmissionIds.add(parts[parts.length - 1]);
      }
      if (r.email) existingEmails.add(r.email.toLowerCase());
      if (r.participantName) existingNames.add(normalize(r.participantName));
    }

    // ── 5. Filter truly new submissions ───────────────────────────────────
    const newSubmissions = submissions.filter(s => {
      const sid = s.submissionId ?? s.id;
      return sid ? !importedSubmissionIds.has(String(sid)) : true;
    });

    if (newSubmissions.length === 0) {
      const latestTime = submissions[submissions.length - 1]?.submissionTime ?? submissions[submissions.length - 1]?.createdAt;
      const updatedMeta = { ...meta, lastSyncedAt: latestTime ?? new Date().toISOString() };
      await BoardColumns.update({ id: linkCol.id, record: { optionsJson: JSON.stringify(updatedMeta) } });
      return { newCount: 0, total: submissions.length };
    }

    // ── 6. Fetch project dates for duplicate detection ────────────────────
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'endDate', 'client'],
    });
    const projectDatesMap = new Map<string, ProjectDates>();
    for (const p of allProjects) {
      if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, endDate: p.endDate });
    }

    // ── 7. Import new submissions ─────────────────────────────────────────
    let newCount = 0;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    stream?.write({ imported: 0, total: newSubmissions.length });

    for (const submission of newSubmissions) {
      // Una submission fallida (ej. un valor con forma inesperada) no debe
      // abortar el resto del lote — antes sí, y el front reportaba "error"
      // aunque N-1 de N ya hubieran importado bien.
      try {
      const questions: any[] = submission.questions ?? submission.answers ?? [];
      const submissionId = String(submission.submissionId ?? submission.id ?? '');

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

      const emailLower = coreFields.email?.toLowerCase() ?? '';
      const normName   = normalize(coreFields.participantName ?? '');
      if (!submissionId) {
        if (emailLower && existingEmails.has(emailLower)) continue;
        if (!emailLower && normName && existingNames.has(normName)) continue;
      }

      if (emailLower) existingEmails.add(emailLower);
      if (normName)   existingNames.add(normName);
      if (submissionId) importedSubmissionIds.add(submissionId);

      await Participants.bulkCreate({
        records: [{ fullName: coreFields.participantName, email: coreFields.email, phone: coreFields.phone, idNumber: coreFields.idNumber }],
        matchOn: coreFields.email ? ['email'] : undefined,
      });

      const sourceFormValue = submissionId ? `${formName}|${submissionId}` : formName;

      if (submissionId) {
        const { records: existing } = await RecruitmentRows.findAll({
          filters: { sourceForm: sourceFormValue, boardName, projectCode },
          limit: 1,
          fields: ['id'],
        });
        if (existing.length > 0) continue;
      }

      const submissionTime = submission.submissionTime ?? submission.createdAt ?? submission.lastUpdatedAt;
      const autoRowOrder = submissionTime ? Math.floor(new Date(submissionTime).getTime() / 1000) : Math.floor(Date.now() / 1000);

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
          rowOrder: autoRowOrder,
        },
      });

      if (cellsToWrite.length > 0) {
        const cellRecords = cellsToWrite.map(c => {
          const colType = colIdToType.get(c.columnId) ?? 'Texto';
          return {
            boardId: resolvedBoardId,
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

      // Duplicate detection (non-blocking)
      try {
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

      newCount++;
      // El pausado sigue sirviendo para no exceder el rate limit de Fillout.
      if (newCount % 3 === 0) await sleep(300);
      } catch (err) {
        console.error('[checkNewSubmissions] Fallo al importar una submission — se omite y se sigue con el resto', {
          submissionId: submission.submissionId ?? submission.id, error: String(err),
        });
      } finally {
        // `finally` corre en los tres casos (éxito, `continue` por dedup, o
        // catch de arriba) — así el progreso avanza aunque una submission se
        // omita, y `imported` nunca se queda atorado por debajo de `total`.
        stream?.write({ imported: newCount, total: newSubmissions.length });
      }
    }

    // ── 8. Update lastSyncedAt cursor ─────────────────────────────────────
    const latestSubmission = submissions[submissions.length - 1];
    const newCursor = latestSubmission?.submissionTime ?? latestSubmission?.createdAt ?? new Date().toISOString();
    // Re-read sentinel with dual-read
    let refreshedCols = (await BoardColumns.findAll({
      filters: { boardId: resolvedBoardId, columnType: '__fillout_link__' },
      limit: 5,
    })).records;
    if (refreshedCols.length === 0 && legacyBoardId && legacyBoardId !== resolvedBoardId) {
      refreshedCols = (await BoardColumns.findAll({
        filters: { boardId: legacyBoardId, columnType: '__fillout_link__' },
        limit: 5,
      })).records;
    }
    const latestMeta = refreshedCols[0]?.optionsJson
      ? JSON.parse(refreshedCols[0].optionsJson)
      : { ...meta, questionMapping };
    await BoardColumns.update({
      id: linkCol.id,
      record: { optionsJson: JSON.stringify({ ...latestMeta, lastSyncedAt: newCursor }) },
    });

    return { newCount, total: submissions.length };
  },
});
