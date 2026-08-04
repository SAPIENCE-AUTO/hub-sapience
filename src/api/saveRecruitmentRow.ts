import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Projects } from 'zite-integrations-backend-sdk';
import { publishEvent } from '../lib/ably';
import { lookupBoardUUID } from '../serverUtils/resolveBoardId';

// ── Shared helpers ────────────────────────────────────────────────────────────
type RowLike = { id: string; projectCode?: string; boardName?: string; status?: string; group?: string };
type ProjectDates = { startDate?: string; endDate?: string };

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * 🔴 only when: participation criteria met AND other project ended BEFORE current started.
 * Otherwise falls back to 🟡. Levels 3 & 4 unchanged.
 */
const buildParticipationNote = (
  allRows: RowLike[],
  currentId: string,
  currentProjectCode: string,
  currentBoardName: string,
  projectDatesMap: Map<string, ProjectDates> = new Map(),
): string => {
  const others = allRows.filter(r => r.id !== currentId);
  if (others.length === 0) return '';

  const parts: string[] = [];

  const currentDates = projectDatesMap.get(currentProjectCode);
  const currentStart = currentDates?.startDate ? new Date(currentDates.startDate) : null;

  const diffProject = others.filter(r => r.projectCode && r.projectCode !== currentProjectCode);
  const participated = new Map<string, string>();
  const external = new Map<string, string>();

  for (const r of diffProject) {
    if (!r.projectCode) continue;
    const label = r.boardName ? `${r.projectCode} (${r.boardName})` : r.projectCode;
    const meetsParticipation = r.status === 'Asistió' || (!!r.group && r.group.trim() !== '');

    if (meetsParticipation) {
      const otherDates = projectDatesMap.get(r.projectCode);
      const otherEnd   = otherDates?.endDate ? new Date(otherDates.endDate) : null;
      const confirmedBefore = currentStart && otherEnd && otherEnd < currentStart;

      if (confirmedBefore) {
        participated.set(r.projectCode, label);
      } else {
        if (!participated.has(r.projectCode) && !external.has(r.projectCode)) {
          external.set(r.projectCode, label);
        }
      }
    } else if (!participated.has(r.projectCode) && !external.has(r.projectCode)) {
      external.set(r.projectCode, label);
    }
  }

  if (participated.size > 0) parts.push(`🔴 YA PARTICIPÓ: ${[...participated.values()].join(', ')}.`);
  const extLabels = [...external.entries()].filter(([k]) => !participated.has(k)).map(([, v]) => v);
  if (extLabels.length > 0) parts.push(`🟡 DUPLICADO EXTERNO: ${extLabels.join(', ')}.`);

  const sameProjectDiffBoard = others.filter(
    r => r.projectCode === currentProjectCode && r.boardName && r.boardName !== currentBoardName,
  );
  if (sameProjectDiffBoard.length > 0) {
    const boards = [...new Set(sameProjectDiffBoard.map(r => r.boardName).filter(Boolean) as string[])];
    parts.push(`🟠 MISMO PROYECTO: ${boards.join(', ')}.`);
  }

  const internal = others.filter(
    r => r.projectCode === currentProjectCode && r.boardName === currentBoardName,
  );
  if (internal.length > 0) parts.push(`🔵 ×${internal.length + 1} EN ESTE TABLERO`);

  return parts.join(' ');
};

// ── Endpoint ──────────────────────────────────────────────────────────────────
export default createEndpoint({
  authenticated: true,
  description: 'Create or update a recruitment row. On create, auto-detects duplicates.',
  inputSchema: z.object({
    id: z.string().optional(),
    rowName: z.string().optional(),
    projectCode: z.string().optional(),
    boardId: z.string().optional(),
    boardName: z.string().optional(),
    participantName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    idNumber: z.string().optional(),
    status: z.string().optional(),
    group: z.string().optional(),
    parentRowId: z.string().optional(),
    level: z.number().optional(),
    ndaSent: z.boolean().optional(),
    ndaSentDate: z.string().optional(),
    notes: z.string().optional(),
    sourceForm: z.string().optional(),
    rowOrder: z.number().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string(), boardId: z.string().optional() }),
  execute: async ({ input, context }) => {
    const { id, ...fields } = input;

    // ── UPDATE path ───────────────────────────────────────────────────────
    if (id) {
      // R2-B: only include boardId in update if explicitly provided — don't overwrite with undefined
      const updateFields = { ...fields };
      if (!input.boardId) delete (updateFields as any).boardId;
      await RecruitmentRows.update({ id, record: updateFields });

      // Publish board.field.updated for real-time sync
      try {
        let projectCode = fields.projectCode;
        let boardName = fields.boardName;
        if (!projectCode || !boardName) {
          const row = await RecruitmentRows.findOne({ id });
          projectCode = projectCode ?? row?.projectCode ?? undefined;
          boardName = boardName ?? row?.boardName ?? undefined;
        }
        if (projectCode && boardName) {
          // R2-B: use input.boardId (UUID) when available, legacy composite as fallback
          const boardId = input.boardId || `recruitment-${projectCode}-${boardName}`;
          const updatedFields = Object.fromEntries(
            Object.entries(fields as Record<string, unknown>).filter(
              ([k, v]) => v !== undefined && k !== 'id' && k !== 'projectCode' && k !== 'boardName'
            )
          );
          if (Object.keys(updatedFields).length > 0) {
            await publishEvent(`board:${projectCode}`, 'board.field.updated', {
              projectCode,
              boardId,
              entityType: 'recruitmentRow',
              fieldType: 'fixed',
              rowId: id,
              fields: updatedFields,
              senderEmail: context.user!.email,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch { /* fire and forget */ }

      return { success: true, id, boardId: input.boardId };
    }

    // ── CREATE path — run duplicate detection if we have enough data ──────
    const hasIdentifier = !!(input.email || input.participantName || input.phone);
    const hasProject    = !!input.projectCode;

    // R2-B: use input.boardId directly when provided (UUID from frontend), fallback to lookup
    let boardIdUUID: string | undefined = input.boardId;
    if (!boardIdUUID && input.projectCode && input.boardName) {
      const lookup = await lookupBoardUUID(input.projectCode, input.boardName, 'recruitment');
      if (lookup.found && lookup.uuid) {
        boardIdUUID = lookup.uuid;
      } else {
        console.warn('[saveRecruitmentRow] boardId lookup failed, leaving empty', { projectCode: input.projectCode, boardName: input.boardName, reason: lookup.reason });
      }
    }

    if (!hasIdentifier || !hasProject) {
      const record = await RecruitmentRows.create({ record: { ...fields, boardId: boardIdUUID } });
      return { success: true, id: record.id, boardId: boardIdUUID };
    }

    // 1. Fetch project dates for temporal comparison
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'endDate'],
    });
    const projectDatesMap = new Map<string, ProjectDates>();
    for (const p of allProjects) {
      if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, endDate: p.endDate });
    }

    // 2. Fetch all active rows globally for peer matching
    const { records: allRecords } = await RecruitmentRows.findAll({
      limit: 2000,
      fields: ['id', 'email', 'participantName', 'phone', 'projectCode', 'boardName', 'status', 'group', 'notes', 'deletedAt'],
    });
    const active = allRecords.filter(r => !r.deletedAt);

    // 3. Find peers by email / name / phone
    const newEmail = input.email?.toLowerCase().trim() ?? '';
    const newName  = input.participantName ? normalize(input.participantName) : '';
    const newPhone = input.phone ? input.phone.replace(/[\s\-().+]/g, '') : '';

    const peerIds = new Set<string>();
    for (const r of active) {
      if (newEmail && r.email && r.email.toLowerCase().trim() === newEmail) peerIds.add(r.id);
      if (newName.length > 2 && r.participantName && normalize(r.participantName) === newName) peerIds.add(r.id);
      if (newPhone.length >= 7 && r.phone && r.phone.replace(/[\s\-().+]/g, '') === newPhone) peerIds.add(r.id);
    }

    const rowById = new Map(active.map(r => [r.id, r]));
    const peers   = [...peerIds].map(pid => rowById.get(pid)).filter((r): r is typeof active[0] => !!r);

    // 4. Create the record (with boardId dual-write)
    const newRecord = await RecruitmentRows.create({ record: { ...fields, boardId: boardIdUUID } });
    const newId = newRecord.id;

    // 5. Calculate and save note for the new record
    const newRowAsRowLike: RowLike = {
      id: newId,
      projectCode: input.projectCode,
      boardName: input.boardName,
      status: input.status,
      group: input.group,
    };
    const allForNew: RowLike[] = [newRowAsRowLike, ...peers];
    const noteForNew = buildParticipationNote(allForNew, newId, input.projectCode!, input.boardName ?? '', projectDatesMap);

    if (noteForNew) {
      await RecruitmentRows.update({ id: newId, record: { notes: noteForNew } });
    }

    // 6. Backfill notes on existing peer rows
    for (const peer of peers) {
      if (!peer.projectCode) continue;

      const peerPeerIds = new Set<string>([newId]);
      for (const r of active) {
        if (r.id === peer.id) continue;
        if (peer.email && r.email && r.email.toLowerCase().trim() === peer.email.toLowerCase().trim()) peerPeerIds.add(r.id);
        if (peer.participantName) {
          const pn = normalize(peer.participantName);
          if (pn.length > 2 && r.participantName && normalize(r.participantName) === pn) peerPeerIds.add(r.id);
        }
        if (peer.phone) {
          const pp = peer.phone.replace(/[\s\-().+]/g, '');
          if (pp.length >= 7 && r.phone && r.phone.replace(/[\s\-().+]/g, '') === pp) peerPeerIds.add(r.id);
        }
      }

      const allForPeer: RowLike[] = [
        peer,
        newRowAsRowLike,
        ...[...peerPeerIds]
          .filter(pid => pid !== peer.id && pid !== newId)
          .map(pid => rowById.get(pid))
          .filter((r): r is typeof active[0] => !!r),
      ];

      const newPeerNote = buildParticipationNote(allForPeer, peer.id, peer.projectCode, peer.boardName ?? '', projectDatesMap);
      if (newPeerNote !== (peer.notes ?? '')) {
        await RecruitmentRows.update({ id: peer.id, record: { notes: newPeerNote || undefined } });
      }
    }

    return { success: true, id: newId, boardId: boardIdUUID };
  },
});
