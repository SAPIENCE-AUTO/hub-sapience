import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import {
  buildIdentityClusters, resolveSignals, DuplicateSignalEnum,
  Signal, IdentityRow,
} from '../lib/duplicateIdentity';
import { getGlobalIdentityData } from '../lib/globalIdentityCache';

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

    // Capas 2/3 ("¿ha llenado otros formularios?" / "¿es elegible?"): contra
    // todo el sistema, en modo strict — un solo dato reusado (teléfono
    // compartido, nombre placeholder) nunca debe fusionar identidades
    // distintas aquí; hace falta que coincidan 2 de 3 señales. Compartido con
    // searchParticipantHistory.ts (modal de historial) — ver globalIdentityCache.ts.
    const { activeRows, projectMap, globalClusters, rowToGlobalCluster } = await getGlobalIdentityData();

    const currentProjData = projectMap.get(projectCode);
    const referenceDate   = currentProjData?.startDate ? new Date(currentProjData.startDate) : new Date();
    const sixMonthsAgo   = new Date(referenceDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const currentClientNorm = normClient(currentProjData?.client);

    // ── 2. Rows for the target board — siempre frescas, nunca cacheadas ──────
    const boardRows = activeRows.filter(
      r => r.projectCode === projectCode && r.boardName === boardName,
    );
    if (boardRows.length === 0) return { badges: {} };

    // ── 3. Capa 1 ("¿cuántas veces se llenó ESTE filtro?"): solo con las filas
    // de este tablero — población chica, cierre transitivo total (lenient) es
    // seguro y correcto ahí, y se recalcula siempre fresco (nunca cacheado).
    // Antes se usaba el cluster global para esto también, y por eso un dato
    // reusado en OTRO proyecto podía inflar el conteo "en este tablero" sin
    // que esas filas tuvieran nada que ver con el tablero actual (confirmado
    // en vivo: un participante con 1 sola fila real en su tablero mostraba
    // ×26, encadenado por 8 proyectos ajenos).
    const localClusters = buildIdentityClusters(boardRows);
    const rowToLocalCluster = new Map<string, string>();
    for (const [cid, cluster] of localClusters) {
      for (const rid of cluster.rowIds) rowToLocalCluster.set(rid, cid);
    }

    const rowById = new Map(activeRows.map(r => [r.id, r]));

    // ── 4. Compute signals (cachea por cluster local y global por separado) ─
    const localCountCache = new Map<string, number>();
    const globalSignalCache = new Map<string, Set<Signal>>();

    const badges: Record<string, z.infer<typeof RowBadgeSchema>> = {};

    for (const boardRow of boardRows) {
      const localId = rowToLocalCluster.get(boardRow.id);
      let sameBoardCount = 1;
      if (localId) {
        sameBoardCount = localCountCache.get(localId) ?? localClusters.get(localId)!.rowIds.length;
        localCountCache.set(localId, sameBoardCount);
      }

      const globalId = rowToGlobalCluster.get(boardRow.id);
      let signalSet: Set<Signal>;
      if (globalId && globalSignalCache.has(globalId)) {
        signalSet = new Set(globalSignalCache.get(globalId));
      } else {
        signalSet = new Set<Signal>();
        if (globalId) {
          const cluster = globalClusters.get(globalId)!;
          const peerRows = cluster.rowIds
            .map(id => rowById.get(id))
            .filter((r): r is IdentityRow => !!r);

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
          globalSignalCache.set(globalId, new Set(signalSet));
        }
      }

      if (sameBoardCount > 1) signalSet.add('same_board_duplicate');

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
