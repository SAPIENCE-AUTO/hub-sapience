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

/**
 * Groups rows into identity clusters using union-find with transitive closure.
 * Two rows belong to the same cluster if they share any normalized identity field,
 * even through intermediary rows (A↔B by phone, B↔C by email → A,B,C in one cluster).
 */
export function buildIdentityClusters(rows: IdentityRow[]): Map<string, IdentityCluster> {
  if (rows.length === 0) return new Map();

  // Build per-field indexes
  const emailToIds = new Map<string, string[]>();
  const nameToIds  = new Map<string, string[]>();
  const phoneToIds = new Map<string, string[]>();

  for (const r of rows) {
    if (r.email) {
      const k = normalizeEmail(r.email);
      if (k) {
        if (!emailToIds.has(k)) emailToIds.set(k, []);
        emailToIds.get(k)!.push(r.id);
      }
    }
    if (r.participantName) {
      const k = normalizeName(r.participantName);
      if (k.length > 2) {
        if (!nameToIds.has(k)) nameToIds.set(k, []);
        nameToIds.get(k)!.push(r.id);
      }
    }
    if (r.phone) {
      const k = normalizePhone(r.phone);
      if (k.length >= 7) {
        if (!phoneToIds.has(k)) phoneToIds.set(k, []);
        phoneToIds.get(k)!.push(r.id);
      }
    }
  }

  // Run union-find
  const { find, union } = makeUnionFind(rows.map(r => r.id));

  for (const ids of emailToIds.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  for (const ids of nameToIds.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  for (const ids of phoneToIds.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
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
        if (k.length > 2) {
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
