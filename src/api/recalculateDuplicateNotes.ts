import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Projects } from '../../server/compat';

type RowLike = {
  id: string;
  projectCode?: string;
  boardName?: string;
  status?: string;
  group?: string;
};

type ProjectDates = { startDate?: string; client?: string };

/**
 * 4-level duplicate/participation detection.
 *
 * 🔴 YA PARTICIPÓ  — different project, status 'Asistió' OR has group,
 *                    AND that project's endDate < current project's startDate
 *                    (time-based: they participated BEFORE this project started).
 *                    When dates are missing/overlapping → demote to 🟡.
 * 🟡 DUPLICADO EXTERNO  — different project, no (confirmed) prior participation
 * 🟠 MISMO PROYECTO     — same project, different board
 * 🔵 ×N EN ESTE TABLERO — same project AND same board
 */
const buildParticipationNote = (
  allRows: RowLike[],
  currentId: string,
  currentProjectCode: string,
  currentBoardName: string,
  projectDatesMap: Map<string, ProjectDates> = new Map(),
): string => {
  const otherRows = allRows.filter(r => r.id !== currentId);
  if (otherRows.length === 0) return '';

  const currentProjData = projectDatesMap.get(currentProjectCode);
  const referenceDate = currentProjData?.startDate ? new Date(currentProjData.startDate) : new Date();
  const sixMonthsAgo = new Date(referenceDate);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const normalizeStr = (s?: string) =>
    (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const currentClientNorm = normalizeStr(currentProjData?.client);

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
    const otherStart  = projData?.startDate ? new Date(projData.startDate) : null;
    const otherClient = normalizeStr(projData?.client);

    // ── Temporal filter: ignore projects that started AFTER the current project ──
    if (otherStart && otherStart > referenceDate) continue;

    const isSameClient     = !!currentClientNorm && !!otherClient && otherClient === currentClientNorm;
    // Recent: other project started within 6 months before current project's startDate
    const isRecentOrActive = !otherStart || otherStart > sixMonthsAgo;
    // Same client is red ONLY if the person actually participated (not just filled a form)
    const isRed = (isSameClient && participated) || (participated && isRecentOrActive);
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
  description: 'Recalculate duplicate/participation notes for all active recruitment rows',
  inputSchema: z.object({
    projectCode: z.string().optional(),
  }),
  outputSchema: z.object({ updated: z.number(), total: z.number() }),
  execute: async ({ input }) => {
    // ── 0. Fetch project dates for temporal comparison ────────────────────
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'client'],
    });
    const projectDatesMap = new Map<string, ProjectDates>();
    for (const p of allProjects) {
      if (p.projectCode) projectDatesMap.set(p.projectCode, { startDate: p.startDate, client: p.client });
    }

    // ── 1. Fetch ALL active rows (cross-project for full duplicate detection)
    type RowRecord = Awaited<ReturnType<typeof RecruitmentRows.findAll>>['records'][0];
    const allRecords: RowRecord[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const batch = await RecruitmentRows.findAll({
        limit: 2000,
        offset,
        fields: ['id', 'email', 'participantName', 'phone', 'projectCode', 'boardName', 'status', 'group', 'notes', 'deletedAt'],
      });
      allRecords.push(...batch.records);
      hasMore = batch.hasMore;
      offset += batch.records.length;
    }

    const allActive = allRecords.filter(r => !r.deletedAt);
    const rowsToUpdate = input.projectCode
      ? allActive.filter(r => r.projectCode === input.projectCode)
      : allActive;

    // ── 2. Build lookup maps from ALL active rows ─────────────────────────
    const normalize = (s: string) =>
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
        const k = normalize(r.participantName);
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

    // ── 3. Recalculate each row in the target project ─────────────────────
    const rowById = new Map(allActive.map(r => [r.id, r]));
    let updated = 0;

    for (const row of rowsToUpdate) {
      if (!row.projectCode) continue;

      const peerIds = new Set<string>();
      if (row.email) {
        const k = row.email.toLowerCase().trim();
        for (const id of emailMap.get(k) ?? []) peerIds.add(id);
      }
      if (row.participantName) {
        const k = normalize(row.participantName);
        if (k.length > 2) for (const id of nameMap.get(k) ?? []) peerIds.add(id);
      }
      if (row.phone) {
        const k = row.phone.replace(/[\s\-().+]/g, '');
        if (k.length >= 7) for (const id of phoneMap.get(k) ?? []) peerIds.add(id);
      }

      const allRows: RowLike[] = [row, ...[...peerIds]
        .filter(id => id !== row.id)
        .map(id => rowById.get(id))
        .filter((r): r is typeof row => !!r)];

      const newNote = buildParticipationNote(
        allRows,
        row.id,
        row.projectCode,
        row.boardName ?? '',
        projectDatesMap,
      );

      const currentNote = row.notes ?? '';
      if (newNote !== currentNote) {
        await RecruitmentRows.update({ id: row.id, record: { notes: newNote || undefined } });
        updated++;
      }
    }

    return { updated, total: rowsToUpdate.length };
  },
});
