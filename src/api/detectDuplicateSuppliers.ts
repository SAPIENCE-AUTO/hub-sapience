import { z } from 'zod';
import { createEndpoint, Suppliers, PurchaseOrders } from 'zite-integrations-backend-sdk';

const SUFFIXES = [
  'sapi de cv mi', 'sapi de cv', 'sa de cv mi', 'sa de cv', 's a de c v',
  's a de cv', 's de rl de cv', 's de rl', 'de cv', 'a c', 's c',
  'sa', 's a', 'sl', 'srl', 'inc', 'llc', 'ltd', 'corp', 'corporation',
  'sociedad anonima de capital variable', 'sociedad anonima', 'sociedad civil',
];

function cleanRaw(name: string): string {
  let n = name;
  n = n.replace(/\S+@\S+\.\S+/g, ' ');
  n = n.replace(/https?:\/\/\S+/gi, ' ').replace(/www\.\S+/gi, ' ');
  n = n.replace(/\d[\d\s.\-]{5,}\d/g, ' ');
  n = n.replace(/[|\\#@]/g, ' ');
  return n;
}

function normalizeName(name: string): string {
  let n = cleanRaw(name).toLowerCase().trim();
  n = n.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  n = n.replace(/[.,/#!$%^&*;:{}=\-_`~()'\\"]/g, ' ');
  for (const suffix of SUFFIXES) {
    const re = new RegExp(`\\b${suffix.replace(/\s+/g, '\\s+')}\\b`, 'g');
    n = n.replace(re, ' ');
  }
  return n.replace(/\s+/g, ' ').trim();
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter(t => t.length >= 2));
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

/** Merge singleton groups into multi-variant groups using Jaccard >= threshold with >= minShared tokens */
function fuzzyMergeGroups<T>(
  groups: Record<string, T[]>,
  threshold: number,
  minShared: number,
): void {
  const singletonKeys = Object.keys(groups).filter(k => groups[k].length === 1);
  const multiEntries = Object.keys(groups)
    .filter(k => groups[k].length >= 2)
    .map(k => ({ key: k, tokens: tokenize(k) }));

  for (const singleKey of singletonKeys) {
    if (!groups[singleKey]) continue; // already merged
    const singleTokens = tokenize(singleKey);
    let bestMatch: { key: string; score: number } | null = null;
    for (const { key, tokens } of multiEntries) {
      if (!groups[key]) continue;
      const score = jaccardScore(singleTokens, tokens);
      const shared = [...singleTokens].filter(t => tokens.has(t)).length;
      if (score >= threshold && shared >= minShared) {
        if (!bestMatch || score > bestMatch.score) bestMatch = { key, score };
      }
    }
    if (bestMatch) {
      for (const item of groups[singleKey]) groups[bestMatch.key].push(item);
      delete groups[singleKey];
    }
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Detect supplier name variants across Purchase Orders and duplicate suppliers in the Suppliers table. Uses aggressive cleaning and fuzzy matching (Jaccard).',
  inputSchema: z.object({}),
  outputSchema: z.object({
    groups: z.array(z.object({
      normalizedName: z.string(),
      variants: z.array(z.object({
        name: z.string(),
        poCount: z.number(),
        inDb: z.boolean(),
      })),
    })),
    existingSuppliers: z.array(z.object({
      name: z.string(),
      taxId: z.string().optional(),
    })),
    unregistered: z.array(z.object({
      name: z.string(),
      poCount: z.number(),
      suggestedMatch: z.object({
        name: z.string(),
        score: z.number(),
      }).optional(),
    })),
    supplierDuplicates: z.array(z.object({
      normalizedName: z.string(),
      suppliers: z.array(z.object({
        id: z.string(),
        name: z.string(),
        taxId: z.string().optional(),
        poCount: z.number(),
      })),
    })),
    totalGroups: z.number(),
    totalVariants: z.number(),
    totalUnregistered: z.number(),
    totalSupplierDuplicates: z.number(),
  }),
  execute: async () => {
    const [{ records: pos }, { records: suppliers }] = await Promise.all([
      PurchaseOrders.findAll({ fields: ['supplierName'], limit: 2000 }),
      Suppliers.findAll({ fields: ['supplierName', 'taxId'], limit: 2000 }),
    ]);

    // DB supplier index for fuzzy matching on unregistered
    const dbSupplierNames = new Set(
      suppliers.map(s => s.supplierName?.trim() ?? '').filter(Boolean)
    );
    const dbIndex: { originalName: string; tokens: Set<string> }[] = [];
    for (const s of suppliers) {
      if (!s.supplierName) continue;
      const norm = normalizeName(s.supplierName);
      if (norm.length < 2) continue;
      dbIndex.push({ originalName: s.supplierName, tokens: tokenize(norm) });
    }

    // Count POs per exact supplier name
    const poCountByName: Record<string, number> = {};
    for (const po of pos) {
      const name = po.supplierName?.trim();
      if (!name) continue;
      poCountByName[name] = (poCountByName[name] || 0) + 1;
    }

    // ── PO variant groups ──────────────────────────────────────────────────────
    const poGroups: Record<string, string[]> = {};
    for (const name of Object.keys(poCountByName)) {
      const key = normalizeName(name);
      if (!key || key.length < 2) continue;
      if (!poGroups[key]) poGroups[key] = [];
      poGroups[key].push(name);
    }

    // Second pass: fuzzy-merge singleton PO groups into multi-variant groups
    fuzzyMergeGroups(poGroups, 0.6, 2);

    const duplicateGroups = Object.entries(poGroups)
      .filter(([, variants]) => variants.length >= 2)
      .map(([normalizedName, variants]) => ({
        normalizedName,
        variants: variants
          .map(name => ({
            name,
            poCount: poCountByName[name] ?? 0,
            inDb: dbSupplierNames.has(name),
          }))
          .sort((a, b) => b.poCount - a.poCount),
      }))
      .sort((a, b) =>
        b.variants.reduce((s, v) => s + v.poCount, 0) -
        a.variants.reduce((s, v) => s + v.poCount, 0)
      );

    // ── Unregistered suppliers ─────────────────────────────────────────────────
    const unregistered = Object.entries(poCountByName)
      .filter(([name]) => name.length > 0 && !dbSupplierNames.has(name))
      .map(([name, poCount]) => {
        const normTokens = tokenize(normalizeName(name));
        let bestMatch: { name: string; score: number } | undefined;
        if (normTokens.size >= 1) {
          for (const entry of dbIndex) {
            const score = jaccardScore(normTokens, entry.tokens);
            const sharedCount = [...normTokens].filter(t => entry.tokens.has(t)).length;
            if (score >= 0.5 && sharedCount >= 2) {
              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { name: entry.originalName, score };
              }
            }
          }
        }
        return { name, poCount, suggestedMatch: bestMatch };
      })
      .sort((a, b) => {
        if (!!a.suggestedMatch !== !!b.suggestedMatch) return a.suggestedMatch ? -1 : 1;
        return b.poCount - a.poCount;
      });

    // ── Supplier table duplicates ──────────────────────────────────────────────
    type SupplierItem = { id: string; supplierName: string; taxId?: string };
    const supplierGroups: Record<string, SupplierItem[]> = {};
    for (const s of suppliers) {
      if (!s.supplierName) continue;
      const norm = normalizeName(s.supplierName);
      if (!norm || norm.length < 2) continue;
      if (!supplierGroups[norm]) supplierGroups[norm] = [];
      supplierGroups[norm].push({ id: s.id, supplierName: s.supplierName, taxId: s.taxId || undefined });
    }

    // Second pass: fuzzy-merge singleton supplier groups
    fuzzyMergeGroups(supplierGroups, 0.6, 2);

    const supplierDuplicates = Object.entries(supplierGroups)
      .filter(([, arr]) => arr.length >= 2)
      .map(([normalizedName, arr]) => ({
        normalizedName,
        suppliers: arr
          .map(s => ({
            id: s.id,
            name: s.supplierName,
            taxId: s.taxId,
            poCount: poCountByName[s.supplierName] ?? 0,
          }))
          .sort((a, b) => b.poCount - a.poCount),
      }))
      .sort((a, b) => b.suppliers.length - a.suppliers.length);

    return {
      groups: duplicateGroups,
      existingSuppliers: suppliers
        .map(s => ({ name: s.supplierName ?? '', taxId: s.taxId || undefined }))
        .filter(s => s.name.length > 0),
      unregistered,
      supplierDuplicates,
      totalGroups: duplicateGroups.length,
      totalVariants: duplicateGroups.reduce((sum, g) => sum + g.variants.length - 1, 0),
      totalUnregistered: unregistered.length,
      totalSupplierDuplicates: supplierDuplicates.length,
    };
  },
});
