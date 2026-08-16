import { z } from 'zod';

// ── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeEmail(s?: string): string {
  return (s ?? '').toLowerCase().trim();
}

export function normalizeName(s?: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizePhone(s?: string): string {
  return (s ?? '').replace(/[^\d]/g, '');
}

// Nombres que Fillout/el equipo dejan como placeholder cuando no se capturó
// un nombre real — nunca son una señal de identidad, en ningún modo. "new
// item" es el default literal de Fillout para una fila sin nombre (224
// ocurrencias activas confirmadas en producción) y por sí solo encadenaba
// cientos de participantes reales no relacionados entre sí.
export const PLACEHOLDER_NAMES = new Set<string>(['new item']);

export function isPlaceholderName(normalized: string): boolean {
  return PLACEHOLDER_NAMES.has(normalized);
}

// ── Zod enum & signal types ─────────────────────────────────────────────────

export type Signal = 'same_client' | 'recent' | 'old' | 'registered_only' | 'same_board_duplicate';

export const DuplicateSignalEnum = z.enum([
  'same_client', 'recent', 'old', 'registered_only', 'same_board_duplicate',
]);

export const SIGNAL_RANK: Record<Signal, number> = {
  same_client:          5,
  recent:               4,
  old:                  3,
  registered_only:      2,
  same_board_duplicate: 1,
};

export function resolveSignals(signalSet: Set<Signal>): {
  signals: Signal[];
  primaryBadge: Signal | null;
  secondaryBadges: Signal[];
} {
  const sorted = [...signalSet].sort((a, b) => SIGNAL_RANK[b] - SIGNAL_RANK[a]);
  return {
    signals:         sorted,
    primaryBadge:    sorted[0] ?? null,
    secondaryBadges: sorted.slice(1),
  };
}

// ── Union-Find ──────────────────────────────────────────────────────────────

export function makeUnionFind(ids: string[]) {
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);

  function find(id: string): string {
    const p = parent.get(id) ?? id;
    if (p !== id) {
      const root = find(p);
      parent.set(id, root);
      return root;
    }
    return id;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  return { find, union };
}

// ── Identity clustering ─────────────────────────────────────────────────────

export type IdentityRow = {
  id: string;
  email?: string;
  participantName?: string;
  phone?: string;
  [key: string]: any;
};

export type MatchReason = 'email' | 'name' | 'phone';

export type IdentityCluster = {
  rowIds: string[];
  matchReasons: Map<string, Set<MatchReason>>;
};

export type ClusterMode = 'lenient' | 'strict';

export interface BuildIdentityClustersOptions {
  /**
   * 'lenient' (default): une dos filas si comparten CUALQUIER campo (email,
   * nombre o teléfono), con cierre transitivo total. Correcto para un
   * universo chico y acotado (ej. un solo tablero) donde el riesgo de
   * colisión accidental es bajo — literalmente responde "¿cuántas veces se
   * llenó este mismo formulario?".
   *
   * 'strict': solo une dos filas si comparten AL MENOS 2 de {email, nombre,
   * teléfono} — necesario al comparar contra todo el sistema (75k+ filas),
   * donde un solo dato reusado (teléfono compartido, número reciclado, error
   * de captura) nunca debe fusionar identidades distintas por sí solo.
   * Encontrado en vivo: sin esto, un cluster llegó a 4,642 filas en 100+
   * proyectos, incluyendo un contacto de prueba interno de Sapience.
   */
  mode?: ClusterMode;
}

function pushTo(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

function unionChain(ids: string[], union: (a: string, b: string) => void): void {
  for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
}

/**
 * Groups rows into identity clusters using union-find.
 * Modo 'lenient' (default): dos filas se fusionan si comparten cualquier
 * campo normalizado, con cierre transitivo total (A↔B por teléfono, B↔C por
 * email → A,B,C en un cluster). Modo 'strict': solo se fusionan si comparten
 * 2 de los 3 campos a la vez — ver BuildIdentityClustersOptions.
 */
export function buildIdentityClusters(
  rows: IdentityRow[],
  opts: BuildIdentityClustersOptions = {},
): Map<string, IdentityCluster> {
  if (rows.length === 0) return new Map();
  const mode = opts.mode ?? 'lenient';

  // Build per-field indexes (nombres placeholder nunca se indexan, en
  // ningún modo — nunca son una señal real de identidad)
  const emailToIds = new Map<string, string[]>();
  const nameToIds  = new Map<string, string[]>();
  const phoneToIds = new Map<string, string[]>();
  // Claves normalizadas por fila — solo se usan en modo strict, para armar
  // los pair-buckets sin tener que volver a normalizar todo dos veces.
  const rowKeys = new Map<string, { email?: string; name?: string; phone?: string }>();

  for (const r of rows) {
    const keys: { email?: string; name?: string; phone?: string } = {};
    if (r.email) {
      const k = normalizeEmail(r.email);
      if (k) { keys.email = k; pushTo(emailToIds, k, r.id); }
    }
    if (r.participantName) {
      const k = normalizeName(r.participantName);
      if (k.length > 2 && !isPlaceholderName(k)) { keys.name = k; pushTo(nameToIds, k, r.id); }
    }
    if (r.phone) {
      const k = normalizePhone(r.phone);
      if (k.length >= 7) { keys.phone = k; pushTo(phoneToIds, k, r.id); }
    }
    if (mode === 'strict') rowKeys.set(r.id, keys);
  }

  // Run union-find
  const { find, union } = makeUnionFind(rows.map(r => r.id));

  if (mode === 'lenient') {
    for (const ids of emailToIds.values()) unionChain(ids, union);
    for (const ids of nameToIds.values())  unionChain(ids, union);
    for (const ids of phoneToIds.values()) unionChain(ids, union);
  } else {
    // Strict: solo unir dentro de "pair-buckets" — dos filas caen en el
    // mismo bucket únicamente si coinciden en ESAS 2 señales a la vez. Un
    // campo reusado por cientos de filas (ej. un teléfono compartido) nunca
    // genera una unión por sí solo: su bucket de un solo campo puede ser
    // enorme, pero cada pair-bucket derivado de él se queda chico salvo que
    // dos filas de verdad compartan también el segundo dato.
    const pairBuckets = new Map<string, string[]>();
    for (const r of rows) {
      const k = rowKeys.get(r.id);
      if (!k) continue;
      if (k.email && k.name)  pushTo(pairBuckets, `EN:${k.email}|${k.name}`,  r.id);
      if (k.email && k.phone) pushTo(pairBuckets, `EP:${k.email}|${k.phone}`, r.id);
      if (k.name  && k.phone) pushTo(pairBuckets, `NP:${k.name}|${k.phone}`,  r.id);
    }
    for (const ids of pairBuckets.values()) unionChain(ids, union);
  }

  // Group rows by root
  const clusterRows = new Map<string, string[]>();
  for (const r of rows) {
    const root = find(r.id);
    if (!clusterRows.has(root)) clusterRows.set(root, []);
    clusterRows.get(root)!.push(r.id);
  }

  // Build per-row index for match-reason computation
  const rowById = new Map(rows.map(r => [r.id, r]));

  // Compute match reasons per row within each cluster
  const result = new Map<string, IdentityCluster>();

  for (const [clusterId, rowIds] of clusterRows) {
    const matchReasons = new Map<string, Set<MatchReason>>();

    // Build cluster-level field sets for comparison
    const clusterEmails = new Map<string, string[]>(); // normEmail → rowIds
    const clusterNames  = new Map<string, string[]>();
    const clusterPhones = new Map<string, string[]>();

    for (const rid of rowIds) {
      const r = rowById.get(rid)!;
      if (r.email) {
        const k = normalizeEmail(r.email);
        if (k) {
          if (!clusterEmails.has(k)) clusterEmails.set(k, []);
          clusterEmails.get(k)!.push(rid);
        }
      }
      if (r.participantName) {
        const k = normalizeName(r.participantName);
        if (k.length > 2 && !isPlaceholderName(k)) {
          if (!clusterNames.has(k)) clusterNames.set(k, []);
          clusterNames.get(k)!.push(rid);
        }
      }
      if (r.phone) {
        const k = normalizePhone(r.phone);
        if (k.length >= 7) {
          if (!clusterPhones.has(k)) clusterPhones.set(k, []);
          clusterPhones.get(k)!.push(rid);
        }
      }
      matchReasons.set(rid, new Set());
    }

    // A row gets a reason if its normalized field matches at least one OTHER row in the cluster
    for (const ids of clusterEmails.values()) {
      if (ids.length > 1) {
        for (const id of ids) matchReasons.get(id)!.add('email');
      }
    }
    for (const ids of clusterNames.values()) {
      if (ids.length > 1) {
        for (const id of ids) matchReasons.get(id)!.add('name');
      }
    }
    for (const ids of clusterPhones.values()) {
      if (ids.length > 1) {
        for (const id of ids) matchReasons.get(id)!.add('phone');
      }
    }

    result.set(clusterId, { rowIds, matchReasons });
  }

  return result;
}

/**
 * Helper: find the cluster that contains a specific row ID.
 */
export function findClusterForRow(
  clusters: Map<string, IdentityCluster>,
  rowId: string,
): { clusterId: string; cluster: IdentityCluster } | null {
  for (const [clusterId, cluster] of clusters) {
    if (cluster.rowIds.includes(rowId)) return { clusterId, cluster };
  }
  return null;
}

/**
 * Helper: aggregate all match reasons across a cluster into a flat array.
 */
export function aggregateClusterReasons(cluster: IdentityCluster): MatchReason[] {
  const all = new Set<MatchReason>();
  for (const reasons of cluster.matchReasons.values()) {
    for (const r of reasons) all.add(r);
  }
  return [...all];
}
