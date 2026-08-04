import { z } from 'zod';
import { createEndpoint, Deals, Cotizaciones, CotizacionLineItems } from 'zite-integrations-backend-sdk';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(v: string | undefined): number {
  if (!v) return 0;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\(aprobado\)/g, '')
    .replace(/\(aprobada\)/g, '')
    .trim();
}

/** Simple CSV row parser that handles quoted fields */
function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const RUBROS_SET = new Set([
  'RECLUTAMIENTO E INCENTIVOS', 'MODERACIÓN', 'MANAGEMENT',
  'LOGÍSTICA Y OPERACIÓN', 'BACK OFFICE',
]);
const RUBRO_MAP: Record<string, string> = {
  'RECLUTAMIENTO E INCENTIVOS': 'Reclutamiento e incentivos',
  'MODERACIÓN': 'Moderación',
  'MANAGEMENT': 'Management',
  'LOGÍSTICA Y OPERACIÓN': 'Logística y operación',
  'BACK OFFICE': 'Back office',
};
const SKIP_VALS = new Set([
  'Template', 'Name', 'Subitems', 'COTIZACIONES - MXN$', 'COTIZACIONES - USD$', '',
]);

// ── Matching ──────────────────────────────────────────────────────────────────

function findDealMatch(
  cotizName: string,
  deals: { id: string; dealName: string }[],
): { id: string; dealName: string } | null {
  const normCotiz = normalize(cotizName);

  // (a) Exact normalized match
  for (const d of deals) {
    if (normalize(d.dealName) === normCotiz) return d;
  }

  // (b+c) Contains match — pick longest deal name that fits
  let best: { id: string; dealName: string } | null = null;
  let bestLen = 0;
  for (const d of deals) {
    const normDeal = normalize(d.dealName);
    if (normDeal.length < 4) continue;
    if (normCotiz.startsWith(normDeal) || normCotiz.includes(normDeal)) {
      if (normDeal.length > bestLen) {
        best = d;
        bestLen = normDeal.length;
      }
    }
  }
  return best;
}

// ── Chunked bulkCreate ────────────────────────────────────────────────────────

async function bulkCreateChunked<T>(
  items: T[],
  fn: (chunk: T[]) => Promise<unknown>,
  chunkSize = 100,
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await fn(items.slice(i, i + chunkSize));
  }
}

// ── Endpoint ──────────────────────────────────────────────────────────────────

export default createEndpoint({
  authenticated: true,
  description: 'Import cotizaciones from a Monday-exported CSV and link them to existing deals',
  inputSchema: z.object({
    csvUrl: z.string(),
    currency: z.string().optional(),
  }),
  outputSchema: z.object({
    totalCotizaciones: z.number(),
    totalLineItems: z.number(),
    matchedCount: z.number(),
    unmatchedNames: z.array(z.string()),
    matchDetails: z.array(z.object({ cotizName: z.string(), dealName: z.string() })),
  }),
  execute: async ({ input }) => {
    const currency = input.currency ?? 'MXN';

    // 1. Fetch CSV
    const resp = await fetch(input.csvUrl);
    const rawText = await resp.text();
    const lines = rawText.split(/\r?\n/);

    // 2. Parse all rows
    const rows = lines.map(parseCsvRow);

    // 3. Fetch all deals for matching
    const { records: dealRecords } = await Deals.findAll({ fields: ['dealName'], limit: 2000 });
    const deals = dealRecords.map(d => ({ id: d.id, dealName: d.dealName ?? '' }));

    // 4. Extract cotización blocks
    interface LineItemRaw {
      rubro: string;
      subRubro: string;
      cantidad: number;
      componentes: number;
      unitCost: number;
      subtotal: number;
      markupPct: number;
      finalPrice: number;
    }
    interface CotizBlock {
      name: string;
      lineItems: LineItemRaw[];
    }

    const blocks: CotizBlock[] = [];
    let currentBlock: CotizBlock | null = null;
    let currentRubro = '';

    for (const row of rows) {
      const col0 = (row[0] ?? '').trim();
      const col1 = (row[1] ?? '').trim();

      if (!col0) {
        // Possible line item
        if (currentBlock && currentRubro && col1) {
          currentBlock.lineItems.push({
            rubro: currentRubro,
            subRubro: col1,
            cantidad: parseNum(row[2]),
            componentes: parseNum(row[3]),
            unitCost: parseNum(row[4]),
            subtotal: parseNum(row[5]),
            markupPct: parseNum(row[6]),
            finalPrice: parseNum(row[8]),
          });
        }
        continue;
      }

      if (RUBROS_SET.has(col0)) {
        currentRubro = col0;
        continue;
      }

      if (SKIP_VALS.has(col0) || col0.startsWith('Duplicate of')) {
        continue;
      }

      // New cotización block
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { name: col0, lineItems: [] };
      currentRubro = '';
    }
    if (currentBlock) blocks.push(currentBlock);

    // 5. Import each block
    let totalLineItems = 0;
    const unmatchedNames: string[] = [];
    const matchDetails: { cotizName: string; dealName: string }[] = [];

    for (const block of blocks) {
      const match = findDealMatch(block.name, deals);
      if (match) {
        matchDetails.push({ cotizName: block.name, dealName: match.dealName });
      } else {
        unmatchedNames.push(block.name);
      }

      const totalCost = block.lineItems.reduce((s, li) => s + li.subtotal, 0);
      const clientPrice = block.lineItems.reduce((s, li) => s + li.finalPrice, 0);

      const cotizRecord: Record<string, unknown> = {
        cotizacionName: block.name,
        status: 'Borrador',
        currency,
        totalCost,
        clientPrice,
        included: false, // always false — user enables manually
      };
      if (match) cotizRecord.deal = [match.id];

      const created = await Cotizaciones.create({ record: cotizRecord as never });

      // Create line items in chunks of 100
      const liItems = block.lineItems
        .filter(li => li.subRubro)
        .map(li => ({
          subRubro: li.subRubro,
          cotizacion: [created.id],
          rubro: RUBRO_MAP[li.rubro] ?? li.rubro,
          cantidad: li.cantidad || undefined,
          componentes: li.componentes || undefined,
          unitCost: li.unitCost || undefined,
          hasMarkup: li.markupPct > 0,
          markupPct: li.markupPct || undefined,
          finalPrice: li.finalPrice || undefined,
        }));

      await bulkCreateChunked(liItems, chunk =>
        CotizacionLineItems.bulkCreate({ records: chunk as never }),
      );

      totalLineItems += liItems.length;
    }

    return {
      totalCotizaciones: blocks.length,
      totalLineItems,
      matchedCount: matchDetails.length,
      unmatchedNames,
      matchDetails,
    };
  },
});
