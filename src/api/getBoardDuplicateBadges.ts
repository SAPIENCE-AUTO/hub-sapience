import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Projects } from 'zite-integrations-backend-sdk';
import {
  buildIdentityClusters, resolveSignals, DuplicateSignalEnum,
  Signal, IdentityRow,
} from '../lib/duplicateIdentity';

const normClient = (s?: string) => (s ?? '').toLowerCase().trim();

const RowBadgeSchema = z.object({
  signals:              z.array(DuplicateSignalEnum),
  primaryBadge:         DuplicateSignalEnum.nullable(),
  secondaryBadges:      z.array(DuplicateSignalEnum),
  sameBoardCount:       z.number(),
  hasHighRisk:          z.boolean(),
  hasInternalDuplicate: z.boolean(),
});

export default createEndpoint({
  authenticated: true,
  description: 'Batch compute duplicate/participation badges for all rows in a board — single source of truth for row icons',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName:   z.string(),
  }),
  outputSchema: z.object({
    badges: z.record(z.string(), RowBadgeSchema),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName } = input;

    // ── 0. Project metadata ──────────────────────────────────────────────────
    const { records: allProjects } = await Projects.findAll({
      limit: 500,
      fields: ['projectCode', 'startDate', 'client'],
    });
    const projectMap = new Map<string, { startDate?: string; client?: string }>();
    for (const p of allProjects) {
      if (p.projectCode) projectMap.set(p.projectCode, { startDate: p.startDate, client: p.client });
    }

    const currentProjData = projectMap.get(projectCode);
    const referenceDate   = currentProjData?.startDate ? new Date(currentProjData.startDate) : new Date();
    const sixMonthsAgo   = new Date(referenceDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const currentClientNorm = normClient(currentProjData?.client);

    // ── 1. Fetch ALL active rows (paginated) ─────────────────────────────────
    const allRows: IdentityRow[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const batch = await RecruitmentRows.findAll({
        limit: 2000,
        offset,
        fields: ['id', 'projectCode', 'boardName', 'email', 'participantName', 'phone', 'status', 'group', 'deletedAt'],
      });
      allRows.push(...batch.records);
      hasMore = batch.hasMore;
      offset += batch.records.length;
    }
    const activeRows = allRows.filter(r => !r.deletedAt);

    // ── 2. Rows for the target board ─────────────────────────────────────────
    const boardRows = activeRows.filter(
      r => r.projectCode === projectCode && r.boardName === boardName,
    );
    if (boardRows.length === 0) return { badges: {} };

    // ── 3. Build identity clusters (union-find with full transitive closure) ─
    const clusters = buildIdentityClusters(activeRows);

    // Build rowId → clusterId lookup
    const rowToCluster = new Map<string, string>();
    for (const [cid, cluster] of clusters) {
      for (const rid of cluster.rowIds) rowToCluster.set(rid, cid);
    }

    const rowById = new Map(activeRows.map(r => [r.id, r]));

    // ── 4. Compute signals per cluster (cached) ─────────────────────────────
    type ClusterResult = { signalSet: Set<Signal>; sameBoardCount: number };
    const clusterCache = new Map<string, ClusterResult>();

    const badges: Record<string, z.infer<typeof RowBadgeSchema>> = {};

    for (const boardRow of boardRows) {
      const clusterId = rowToCluster.get(boardRow.id);
      if (!clusterId) continue;

      if (clusterCache.has(clusterId)) {
        const cached = clusterCache.get(clusterId)!;
        const { signals, primaryBadge, secondaryBadges } = resolveSignals(cached.signalSet);
        badges[boardRow.id] = {
          signals, primaryBadge, secondaryBadges,
          sameBoardCount:       cached.sameBoardCount,
          hasHighRisk:          primaryBadge === 'same_client' || primaryBadge === 'recent',
          hasInternalDuplicate: cached.sameBoardCount > 1,
        };
        continue;
      }

      const cluster = clusters.get(clusterId)!;
      const peerRows = cluster.rowIds
        .map(id => rowById.get(id))
        .filter((r): r is IdentityRow => !!r);

      // sameBoardCount: how many rows from this cluster are in the target board
      const sameBoardCount = peerRows.filter(
        r => r.projectCode === projectCode && r.boardName === boardName,
      ).length;

      // Cross-project signals
      const signalSet = new Set<Signal>();
      for (const peer of peerRows) {
        if (!peer.projectCode) continue;

        const isSameBoard = peer.projectCode === projectCode && peer.boardName === boardName;
        if (isSameBoard) continue;

        const isSameProject = peer.projectCode === projectCode;
        if (isSameProject) continue;

        const peerProjData  = projectMap.get(peer.projectCode);
        const peerStartDate = peerProjData?.startDate ? new Date(peerProjData.startDate) : null;
        if (peerStartDate && peerStartDate > referenceDate) continue;

        const rawParticipated = peer.status === 'Asistió' || (!!peer.group && String(peer.group).trim() !== '');
        const isSameClient = !!currentClientNorm && !!peerProjData?.client && normClient(peerProjData.client) === currentClientNorm;
        const isRecent = !peerStartDate || peerStartDate > sixMonthsAgo;

        if (rawParticipated && isSameClient) {
          signalSet.add('same_client');
        } else if (rawParticipated && isRecent) {
          signalSet.add('recent');
        } else if (rawParticipated && !isRecent) {
          signalSet.add('old');
        } else if (!rawParticipated) {
          signalSet.add('registered_only');
        }
      }

      if (sameBoardCount > 1) signalSet.add('same_board_duplicate');

      clusterCache.set(clusterId, { signalSet, sameBoardCount });

      const { signals, primaryBadge, secondaryBadges } = resolveSignals(signalSet);
      badges[boardRow.id] = {
        signals, primaryBadge, secondaryBadges,
        sameBoardCount,
        hasHighRisk:          primaryBadge === 'same_client' || primaryBadge === 'recent',
        hasInternalDuplicate: sameBoardCount > 1,
      };
    }

    return { badges };
  },
});
