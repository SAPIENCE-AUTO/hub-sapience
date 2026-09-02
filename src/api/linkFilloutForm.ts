import { z } from 'zod';
import { createEndpoint, BoardColumns } from '../../server/compat';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

const normalize = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const toColType = (type: string): string => {
  const t = (type ?? '').toLowerCase();
  if (['numberinput', 'number', 'currency'].includes(t)) return 'Número';
  if (['dateinput', 'date'].includes(t)) return 'Fecha';
  if (['datetimeinput', 'datetime'].includes(t)) return 'Datetime';
  if (['checkbox'].includes(t)) return 'Checkbox';
  if (['linearscale'].includes(t)) return 'Select';
  if (['dropdown', 'multiselect', 'ranking'].includes(t)) return 'Texto';
  if (['emailinput', 'email'].includes(t)) return 'Email';
  if (['phoneinput', 'phonenumber', 'phone'].includes(t)) return 'Teléfono';
  if (['fileinput', 'fileupload', 'file'].includes(t)) return 'Archivo';
  return 'Texto';
};

const matchCore = (name: string): string | null => {
  const n = normalize(name);
  if (n.includes('nombre') || n.includes('name')) return 'participantName';
  if (n.includes('email') || n.includes('correo')) return 'email';
  if (n.includes('telefono') || n.includes('phone') || n.includes('celular')) return 'phone';
  if (n.includes('documento') || n.includes('cedula') || n.includes('id doc')) return 'idNumber';
  return null;
};

const CORE_ALIASES: Record<string, string[]> = {
  participantName: ['participante', 'nombre', 'name', 'candidato', 'candidate', 'persona'],
  email:          ['email', 'correo', 'e-mail', 'mail'],
  phone:          ['telefono', 'teléfono', 'phone', 'celular', 'tel'],
  idNumber:       ['documento', 'cedula', 'cédula', 'id', 'identificacion', 'identificación'],
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

export default createEndpoint({
  authenticated: true,
  description: 'Link a Fillout form to a recruitment board: reads questions, bulk-creates missing dynamic columns, stores linkage metadata, and immediately imports existing submissions.',
  inputSchema: z.object({
    formId: z.string(),
    formName: z.string(),
    boardId: z.string(),
    projectCode: z.string().optional(),
    boardName: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    columnsCreated: z.number(),
    webhookUrl: z.string(),
    webhookRegistered: z.boolean(),
    initialImported: z.number(),
  }),
  execute: async ({ input, context }) => {
    const u = context.user;
    const deletedBy = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
    const apiKey = process.env.ZITE_FILLOUT_API_KEY ?? '';
    if (!apiKey) throw new Error('Fillout API key not configured');

    // ── 0. Resolve boardId to UUID ─────────────────────────────────────────
    // El frontend ya manda el UUID del tablero que el usuario tiene abierto en
    // pantalla — si ya es un UUID válido, se usa tal cual. Buscarlo de nuevo
    // por nombre (projectCode+boardName) solo tiene sentido para IDs legacy
    // (pre-migración), y hacerlo siempre era un riesgo real: si existen dos
    // tableros activos con el mismo nombre (ver incidente ELÁSTICO/CHILE, "Ya
    // existe un tablero llamado..." en RecruitmentPage.tsx), la búsqueda por
    // nombre puede resolver a un tablero distinto del que el usuario está
    // viendo, y el vínculo (y el borrado de sentinels viejos del paso
    // siguiente) termina aplicándose al tablero equivocado.
    const UUID_RE_INPUT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let effectiveBoardId = input.boardId;
    let legacyBoardId: string | undefined;
    let boardIdChanged = false;

    if (!UUID_RE_INPUT.test(input.boardId)) {
      const lookup = await lookupBoardUUID(
        input.projectCode ?? '',
        input.boardName,
        'recruitment',
      );
      if (lookup.found && lookup.uuid) {
        effectiveBoardId = lookup.uuid;
        legacyBoardId = lookup.legacyId;
        boardIdChanged = true;
        console.log('[linkFilloutForm] Resolved legacy boardId to UUID', {
          input: input.boardId, uuid: effectiveBoardId,
        });
      } else {
        console.warn('[linkFilloutForm] UUID not found, using input boardId as fallback', {
          input: input.boardId, reason: lookup.reason,
        });
      }
    }

    // ── 1. Fetch form questions ────────────────────────────────────────────
    const res = await fetch(`https://api.fillout.com/v1/api/forms/${input.formId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Error al obtener el formulario: ${res.status}`);
    const formData = await res.json();
    const questions: { id: string; name: string; type: string }[] = formData.questions ?? [];

    // ── 2. Get existing columns for this board (dual-read: UUID + legacy) ─
    const { records: uuidCols } = await BoardColumns.findAll({
      filters: { boardId: effectiveBoardId },
      limit: 200,
    });
    let existingCols = uuidCols;

    // Also check under legacy boardId if different — merge without duplicates
    if (boardIdChanged) {
      const { records: legacyCols } = await BoardColumns.findAll({
        filters: { boardId: input.boardId },
        limit: 200,
      });
      const seenIds = new Set(uuidCols.map(c => c.id));
      for (const lc of legacyCols) {
        if (!seenIds.has(lc.id)) existingCols.push(lc);
      }
    }

    // ── Guard: delete ALL existing __fillout_link__ sentinels for this board ──
    // Prevents duplicate sentinels from accumulating. Antes de borrarlos, se
    // rescata su questionMapping — perderlo aquí es lo que rompía todo: cada
    // re-vinculación (el mismo botón "Vincular form", sin importar si ya
    // estaba vinculado) reconstruía el mapeo desde cero solo por coincidencia
    // de nombre, tirando la asociación estable por filloutId acumulada desde
    // el primer link. Si el nombre visible de una columna no calzaba exacto
    // con la pregunta actual de Fillout (typo corregido, texto reformulado),
    // esa pregunta perdía su columna — se creaba una nueva y la vieja se
    // quedaba huérfana, viéndose como si el formulario "se hubiera
    // desvinculado solo".
    const oldLinks = existingCols.filter(c => c.columnType === '__fillout_link__');
    let oldMapping: { filloutId: string; columnId: string; questionName: string }[] = [];
    for (const oldLink of oldLinks) {
      try {
        const oldMeta = JSON.parse(oldLink.optionsJson ?? '{}');
        const m = (oldMeta.questionMapping ?? []) as typeof oldMapping;
        if (m.length > oldMapping.length) oldMapping = m; // se queda con el más completo si hay varios sentinels
      } catch { /* ignore */ }
    }
    const mappedColIdByFilloutId = new Map(oldMapping.map(m => [m.filloutId, m.columnId]));

    for (const oldLink of oldLinks) {
      try {
        await BoardColumns.update({
          id: oldLink.id,
          record: { deletedAt: new Date().toISOString(), deletedBy },
        });
      } catch { /* best-effort */ }
    }

    const visibleCols = existingCols.filter(c => c.columnType !== '__fillout_link__');
    const visibleColCount = visibleCols.length;
    const visibleColIds = new Set(visibleCols.map(c => c.id));

    const colByNorm = new Map<string, string>();
    for (const col of visibleCols) {
      if (col.columnName) colByNorm.set(normalize(col.columnName), col.id);
    }

    // ── 3. Resolve each question to a column, uno a uno por filloutId ──────
    //    Fillout solo garantiza que el id de la pregunta es estable — el
    //    nombre no. Si dos preguntas genuinamente distintas comparten
    //    etiqueta (o normalizan igual) y se emparejan por nombre, la segunda
    //    pisa la celda de la primera en cada respuesta: se pierde una
    //    respuesta por participante en silencio. Por eso ninguna columna
    //    puede quedar reclamada por más de un filloutId en este formulario.
    type PendingCol = { filloutId: string; name: string; type: string; orderOffset: number };
    const toCreate: PendingCol[] = [];
    const claimedColIds = new Set<string>();
    const createdNorms = new Set<string>();
    const resolution = new Map<string, { colId: string } | { pendingName: string }>();

    for (const q of questions) {
      const name = (q.name ?? '').trim();
      if (!name) continue;
      const normName = normalize(name);
      const coreKey = matchCore(name);

      // Prioridad 1: ya estaba mapeada por este mismo filloutId en el link
      // anterior — es la señal estable, se reusa tal cual sin tocar el
      // nombre (evita el reset descrito arriba). Solo si esa columna ya no
      // existe (se borró) se cae al emparejamiento por nombre de siempre.
      const previousColId = mappedColIdByFilloutId.get(q.id);
      if (previousColId && visibleColIds.has(previousColId) && !claimedColIds.has(previousColId)) {
        claimedColIds.add(previousColId);
        resolution.set(q.id, { colId: previousColId });
        continue;
      }

      let candidateColId: string | undefined;
      if (coreKey) {
        const aliases = CORE_ALIASES[coreKey] ?? [];
        for (const alias of aliases) {
          if (colByNorm.has(alias)) { candidateColId = colByNorm.get(alias); break; }
        }
        if (!candidateColId) candidateColId = colByNorm.get(normName);
      } else {
        candidateColId = colByNorm.get(normName);
      }

      if (candidateColId && !claimedColIds.has(candidateColId)) {
        claimedColIds.add(candidateColId);
        resolution.set(q.id, { colId: candidateColId });
        continue;
      }

      // Ninguna columna coincide, o la que coincide ya es de OTRA pregunta de
      // este mismo formulario — nunca se comparte. Esta pregunta se queda con
      // su propia columna, desambiguando el nombre si la etiqueta se repite.
      let finalName = name;
      let n = 2;
      while (createdNorms.has(normalize(finalName))) {
        finalName = `${name} (${n})`;
        n++;
      }
      createdNorms.add(normalize(finalName));
      toCreate.push({ filloutId: q.id, name: finalName, type: q.type, orderOffset: toCreate.length });
      resolution.set(q.id, { pendingName: finalName });
    }

    // ── 4. Bulk-create all missing columns ────────────────────────────────
    const createdColIdByFilloutId = new Map<string, string>();
    if (toCreate.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < toCreate.length; i += batchSize) {
        const batch = toCreate.slice(i, i + batchSize);
        const created = await BoardColumns.bulkCreate({
          records: batch.map(c => ({
            columnName: c.name,
            boardId: effectiveBoardId,
            columnType: toColType(c.type),
            columnOrder: visibleColCount + c.orderOffset,
          })),
        });
        for (let j = 0; j < created.records.length; j++) {
          createdColIdByFilloutId.set(batch[j].filloutId, created.records[j].id);
        }
      }
    }

    // ── 5. Build final question → column mapping ────────────────────────────
    const questionMapping: { filloutId: string; columnId: string; questionName: string }[] = [];

    for (const q of questions) {
      const name = (q.name ?? '').trim();
      if (!name) continue;
      const r = resolution.get(q.id);
      if (!r) continue;
      const colId = 'colId' in r ? r.colId : createdColIdByFilloutId.get(q.id);
      if (colId) questionMapping.push({ filloutId: q.id, columnId: colId, questionName: name });
    }

    // ── 6. Store linkage as a hidden sentinel column ───────────────────────
    //    boardId = UUID (primary destination for new submissions)
    //    legacyBoardId = legacy composite (reference only, not used for writes)
    await BoardColumns.create({
      record: {
        columnName: input.formName,
        boardId: effectiveBoardId,
        columnType: '__fillout_link__',
        columnOrder: 9999,
        optionsJson: JSON.stringify({
          formId: input.formId,
          formName: input.formName,
          boardId: effectiveBoardId,
          legacyBoardId: boardIdChanged ? legacyBoardId : undefined,
          projectCode: input.projectCode ?? '',
          boardName: input.boardName,
          linkedAt: new Date().toISOString(),
          questionMapping,
        }),
      },
    });

    // ── 7. (Webhook registration removed — not supported in this architecture) ─
    const webhookUrl = '';
    const webhookRegistered = false;

    // NOTE: Initial import of existing submissions is handled automatically
    // by checkNewSubmissions (lightweight polling) which fires 10s after linking.
    // Since lastSyncedAt is not set in the metadata above, the first poll will
    // fetch all submissions from the beginning.

    return { success: true, columnsCreated: toCreate.length, webhookUrl, webhookRegistered, initialImported: 0 };
  },
});
