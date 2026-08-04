import { z } from 'zod';
import { createEndpoint, BoardColumns } from 'zite-integrations-backend-sdk';
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
    const lookup = await lookupBoardUUID(
      input.projectCode ?? '',
      input.boardName,
      'recruitment',
    );
    const effectiveBoardId = lookup.found && lookup.uuid ? lookup.uuid : input.boardId;
    const legacyBoardId = lookup.legacyId;
    const boardIdChanged = effectiveBoardId !== input.boardId;

    if (lookup.found) {
      console.log('[linkFilloutForm] Resolved boardId to UUID', {
        input: input.boardId, uuid: effectiveBoardId,
      });
    } else {
      console.warn('[linkFilloutForm] UUID not found, using input boardId as fallback', {
        input: input.boardId, reason: lookup.reason,
      });
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
    // Prevents duplicate sentinels from accumulating.
    const oldLinks = existingCols.filter(c => c.columnType === '__fillout_link__');
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

    const colByNorm = new Map<string, string>();
    const colNameSet = new Set<string>();
    for (const col of visibleCols) {
      if (col.columnName) {
        colByNorm.set(normalize(col.columnName), col.id);
        colNameSet.add(col.columnName.toLowerCase());
      }
    }

    // ── 3. First pass: decide which columns need to be created ─────────────
    type PendingCol = { filloutId: string; name: string; type: string; orderOffset: number };
    const toCreate: PendingCol[] = [];
    const seenNames = new Set<string>();

    for (const q of questions) {
      const name = (q.name ?? '').trim();
      if (!name) continue;
      const normName = normalize(name);
      const coreKey = matchCore(name);

      if (coreKey) {
        const aliases = CORE_ALIASES[coreKey] ?? [];
        const found = aliases.some(a => colByNorm.has(a)) || colByNorm.has(normName);
        if (!found && !seenNames.has(normName)) {
          toCreate.push({ filloutId: q.id, name, type: q.type, orderOffset: toCreate.length });
          seenNames.add(normName);
        }
      } else {
        if (!colByNorm.has(normName) && !colNameSet.has(name.toLowerCase()) && !seenNames.has(normName)) {
          toCreate.push({ filloutId: q.id, name, type: q.type, orderOffset: toCreate.length });
          seenNames.add(normName);
        }
      }
    }

    // ── 4. Bulk-create all missing columns ────────────────────────────────
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
        for (const r of created.records) {
          const nm = normalize(r.fields.columnName ?? '');
          if (nm) colByNorm.set(nm, r.id);
        }
      }
    }

    // ── 5. Second pass: build question → column mapping ────────────────────
    const questionMapping: { filloutId: string; columnId: string; questionName: string }[] = [];

    for (const q of questions) {
      const name = (q.name ?? '').trim();
      if (!name) continue;
      const normName = normalize(name);
      const coreKey = matchCore(name);

      let colId: string | undefined;
      if (coreKey) {
        const aliases = CORE_ALIASES[coreKey] ?? [];
        for (const alias of aliases) {
          if (colByNorm.has(alias)) { colId = colByNorm.get(alias); break; }
        }
        if (!colId) colId = colByNorm.get(normName);
      } else {
        colId = colByNorm.get(normName);
      }

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
