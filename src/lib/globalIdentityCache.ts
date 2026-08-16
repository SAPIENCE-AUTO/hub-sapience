import { RecruitmentRows, Projects } from '../../server/compat';
import { buildIdentityClusters, IdentityRow, IdentityCluster } from './duplicateIdentity';

/**
 * Cache compartido del clustering global de identidades (capas "otros
 * formularios" / "elegibilidad"), usado tanto por getBoardDuplicateBadges.ts
 * (badges por tablero) como por searchParticipantHistory.ts en modo seed (el
 * modal "Historial del participante" que abre el ícono de duplicados).
 *
 * Antes cada endpoint traía y clusterizaba TODO el sistema (~76k filas) por
 * su cuenta, con su propio cache — abrir un tablero calentaba uno pero no el
 * otro, así que el modal de historial siempre pagaba el costo completo (~15-
 * 26s) aunque el tablero ya lo hubiera hecho segundos antes. Compartir el
 * cache aquí significa que CUALQUIERA de los dos lo calienta para el otro.
 */

const CACHE_TTL_MS = 90_000;

export type GlobalIdentityData = {
  activeRows: IdentityRow[];
  projectMap: Map<string, { startDate?: string; client?: string }>;
  globalClusters: Map<string, IdentityCluster>;
  rowToGlobalCluster: Map<string, string>;
};

let cache: (GlobalIdentityData & { expiresAt: number }) | null = null;

export async function getGlobalIdentityData(): Promise<GlobalIdentityData> {
  if (cache && cache.expiresAt > Date.now()) return cache;

  const { records: allProjects } = await Projects.findAll({
    limit: 500,
    fields: ['projectCode', 'startDate', 'client'],
  });
  const projectMap = new Map<string, { startDate?: string; client?: string }>();
  for (const p of allProjects) {
    if (p.projectCode) projectMap.set(p.projectCode, { startDate: p.startDate, client: p.client });
  }

  // 10_000 = MAX_LIMIT del modelo (server/compat/model.ts).
  const allRows: IdentityRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const batch = await RecruitmentRows.findAll({
      limit: 10_000,
      offset,
      fields: ['id', 'projectCode', 'boardName', 'email', 'participantName', 'phone', 'status', 'group', 'sourceForm', 'deletedAt'],
    });
    allRows.push(...batch.records);
    hasMore = batch.hasMore;
    offset += batch.records.length;
  }
  const activeRows = allRows.filter(r => !r.deletedAt);

  // Strict: 2 de 3 señales deben coincidir para fusionar identidades contra
  // todo el sistema — ver duplicateIdentity.ts.
  const globalClusters = buildIdentityClusters(activeRows, { mode: 'strict' });
  const rowToGlobalCluster = new Map<string, string>();
  for (const [cid, cluster] of globalClusters) {
    for (const rid of cluster.rowIds) rowToGlobalCluster.set(rid, cid);
  }

  cache = { activeRows, projectMap, globalClusters, rowToGlobalCluster, expiresAt: Date.now() + CACHE_TTL_MS };
  return cache;
}
