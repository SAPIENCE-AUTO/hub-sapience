import { z } from 'zod';
import { createEndpoint, Projects, Suppliers, PurchaseOrders } from '../../server/compat';

// ── CSV helpers ───────────────────────────────────────────────────────────────
function splitCSV(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function pn(v: string | undefined): number {
  if (!v || v === 'nan') return 0;
  const x = parseFloat(v.replace(/[$,\s]/g, ''));
  return isNaN(x) ? 0 : x;
}

function pd(v: string | undefined): string | undefined {
  if (!v || v === 'nan') return undefined;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const M: Record<string, string> = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const m1 = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (m1) return `${m1[3]}-${M[m1[2]] ?? '01'}-${m1[1].padStart(2, '0')}`;
  const m2 = s.match(/\w{3} ([A-Za-z]{3}) (\d+) (\d{4})/);
  if (m2) return `${m2[3]}-${M[m2[1]] ?? '01'}-${m2[2].padStart(2, '0')}`;
  return undefined;
}

function mapRubro(r: string): string {
  const u = r.toUpperCase();
  if (u.includes('LOGÍST') || u.includes('LOGIST') || u.includes('VIÁTIC') || u.includes('VIATIC')) return 'Logística';
  if (u.includes('MODERAT') || u.includes('MODERAC')) return 'Moderaciones';
  if (u.includes('MANAGEMENT')) return 'Management';
  return 'Reclutamiento e Incentivos';
}

function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// Dice coefficient on bigrams of normalized strings
function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s[i] + s[i + 1];
      set.set(bg, (set.get(bg) ?? 0) + 1);
    }
    return set;
  };
  const aB = bigrams(a);
  const bB = bigrams(b);
  let intersection = 0;
  for (const [bg, count] of aB) {
    intersection += Math.min(count, bB.get(bg) ?? 0);
  }
  return (2 * intersection) / (a.length - 1 + b.length - 1);
}

function findBestSupplierMatch(rawName: string, normalizedNames: string[], originalNames: string[]): { name: string; score: number } | null {
  const norm = normalizeName(rawName);
  let bestScore = 0;
  let bestName = '';
  for (let i = 0; i < normalizedNames.length; i++) {
    const score = diceSimilarity(norm, normalizedNames[i]);
    if (score > bestScore) { bestScore = score; bestName = originalNames[i]; }
  }
  return bestScore > 0 ? { name: bestName, score: bestScore } : null;
}

/** Map CSV send/pay statuses to system status */
function mapCsvStatus(sendStatus: string, payStatus: string): string {
  if (payStatus.toLowerCase().includes('pagada')) return 'Pagada';
  if (sendStatus.toLowerCase().includes('enviada')) return 'Factura recibida';
  return 'Aprobada';
}

interface ParsedODC {
  projectCode: string;
  poNumber: string;
  description: string;
  rubro: string;
  supplierRaw: string;
  supplierRfc: string;
  supplierEmail: string;
  currency: string;
  totalAmount: number;
  sendStatus: string;
  payStatus: string;
  issueDate?: string;
  pdfUrl?: string;
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
}

function parseMondayCsv(text: string): ParsedODC[] {
  const lines = text.split(/\r?\n/);
  const odcs: ParsedODC[] = [];
  let currentProject = '';
  let projectCandidate = '';
  let lastOdc: ParsedODC | null = null;
  let inSubitems = false;
  // Column indices discovered from header row
  let statusOdcCol = -1;
  let statusPagoCol = -1;

  for (const line of lines) {
    if (!line.trim()) { inSubitems = false; continue; }
    const cols = splitCSV(line);
    const c = (i: number) => cols[i]?.trim() ?? '';
    const c0 = c(0), c1 = c(1);

    if (c0 === 'Name' && c1 === 'Subitems') {
      currentProject = projectCandidate;
      inSubitems = false;
      // Detect status column positions from this header row
      for (let i = 0; i < cols.length; i++) {
        const h = cols[i]?.trim().toLowerCase() ?? '';
        if (h.includes('status odc') || h === 'estado odc' || h === 'status de la odc') statusOdcCol = i;
        if (h.includes('status de pago') || h.includes('status pago') || h === 'estado de pago' || h === 'estado pago') statusPagoCol = i;
      }
      continue;
    }
    if (c0 === 'Subitems' && c1 === 'Name') { inSubitems = true; continue; }
    if (c0 === '' && c1 && c1 !== 'Name' && inSubitems && lastOdc) {
      lastOdc.lineItems.push({ description: c1, quantity: pn(c(5)), unitPrice: pn(c(6)), total: pn(c(9)) });
      continue;
    }

    const c4 = c(4);
    if (/^[A-Za-z]+-\d/.test(c4)) {
      inSubitems = false;
      const supplierRaw = c(8) || c(7);
      const emailCandidate = [c(10), c(11), c(12)].find(v => v.includes('@') && v.includes('.')) ?? '';
      const sendStatus = statusOdcCol >= 0 ? c(statusOdcCol) : '';
      const payStatus = statusPagoCol >= 0 ? c(statusPagoCol) : c(31);
      const odc: ParsedODC = {
        projectCode: currentProject,
        poNumber: c4,
        description: c0 === 'Agregar pago' ? '' : c0,
        rubro: c(5),
        supplierRaw,
        supplierRfc: c(9),
        supplierEmail: emailCandidate,
        currency: c(3).replace(' $', '').trim() || 'MXN',
        totalAmount: pn(c(21)) || pn(c(20)),
        sendStatus,
        payStatus,
        issueDate: pd(c(40)),
        pdfUrl: c(43).startsWith('http') ? c(43) : undefined,
        lineItems: [],
      };
      odcs.push(odc);
      lastOdc = odc;
      continue;
    }

    if (c0 && c0 !== 'Agregar pago' && c0 !== 'Subitems' && !c4) {
      projectCandidate = c0;
      inSubitems = false;
    }
  }
  return odcs;
}

// ── Endpoint ─────────────────────────────────────────────────────────────────
export default createEndpoint({
  authenticated: true,
  description: 'Fetch and parse a Monday.com ODC CSV. Returns stats, missing projects, unmatched suppliers, and existing entities for resolution.',
  inputSchema: z.object({ csvUrl: z.string() }),
  outputSchema: z.object({
    totalOdcs: z.number(),
    totalLineItems: z.number(),
    totalProjects: z.number(),
    totalAmount: z.number(),
    projectsToCreate: z.array(z.string()),
    suppliersNotFound: z.array(z.object({ rfc: z.string(), name: z.string(), odcCount: z.number(), suggestedMatch: z.string().optional(), suggestedScore: z.number().optional() })),
    existingProjects: z.array(z.object({ code: z.string(), fullName: z.string().optional() })),
    existingSuppliers: z.array(z.object({ name: z.string(), rfc: z.string().optional() })),
    sampleOdcs: z.array(z.object({
      poNumber: z.string(),
      projectCode: z.string(),
      description: z.string(),
      rubro: z.string(),
      supplierName: z.string(),
      supplierFound: z.boolean(),
      matchedBy: z.string(),
      totalAmount: z.number(),
      status: z.string(),
      lineItemCount: z.number(),
    })),
    existingOdcCount: z.number(),
    newOdcCount: z.number(),
    existingPoNumbers: z.array(z.string()),
  }),
  execute: async ({ input }) => {
    const resp = await fetch(input.csvUrl);
    if (!resp.ok) throw new Error(`No se pudo obtener el CSV: ${resp.status}`);
    const text = await resp.text();
    const odcs = parseMondayCsv(text);

    const allPoNumbers = odcs.map(o => o.poNumber).filter(Boolean);
    const [{ records: projects }, { records: suppliers }, { records: existingPos }] = await Promise.all([
      Projects.findAll({ fields: ['projectCode', 'fullName'], limit: 2000 }),
      Suppliers.findAll({ fields: ['supplierName', 'taxId', 'email'], limit: 2000 }),
      allPoNumbers.length > 0
        ? PurchaseOrders.findAll({ filters: { poNumber: { in: allPoNumbers } }, fields: ['poNumber'], limit: 2000 })
        : Promise.resolve({ records: [] }),
    ]);
    const existingPoNumbersSet = new Set(existingPos.map(p => p.poNumber).filter(Boolean) as string[]);
    const existingPoNumbers = [...existingPoNumbersSet];
    const existingOdcCount = odcs.filter(o => existingPoNumbersSet.has(o.poNumber)).length;
    const newOdcCount = odcs.length - existingOdcCount;

    const existingProjects = projects
      .filter(p => p.projectCode)
      .map(p => ({ code: p.projectCode!, fullName: p.fullName || undefined }));

    const existingProjectMap = new Map<string, string>();
    for (const p of existingProjects) existingProjectMap.set(p.code.toUpperCase().trim(), p.code);

    const rfcMap: Record<string, string> = {};
    const emailMap: Record<string, string> = {};
    const nameMap: Record<string, string> = {};
    const supplierOriginalNames: string[] = [];
    const supplierNormalizedNames: string[] = [];
    for (const s of suppliers) {
      const name = s.supplierName ?? '';
      if (s.taxId) rfcMap[s.taxId.toUpperCase().trim()] = name;
      if (s.email) emailMap[s.email.toLowerCase().trim()] = name;
      if (name) {
        nameMap[normalizeName(name)] = name;
        supplierOriginalNames.push(name);
        supplierNormalizedNames.push(normalizeName(name));
      }
    }

    const existingSuppliers = suppliers
      .filter(s => s.supplierName)
      .map(s => ({ name: s.supplierName!, rfc: s.taxId || undefined }));

    const notFoundMap: Record<string, { rfc: string; name: string; odcCount: number; suggestedMatch?: string; suggestedScore?: number }> = {};
    const matchedByMap: Record<string, string> = {};

    for (const odc of odcs) {
      let found = false;
      if (odc.supplierRfc) {
        const matched = rfcMap[odc.supplierRfc.toUpperCase().trim()];
        if (matched) { odc.supplierRaw = matched; found = true; matchedByMap[odc.poNumber] = 'rfc'; }
      }
      if (!found && odc.supplierEmail) {
        const matched = emailMap[odc.supplierEmail.toLowerCase().trim()];
        if (matched) { odc.supplierRaw = matched; found = true; matchedByMap[odc.poNumber] = 'email'; }
      }
      if (!found && odc.supplierRaw) {
        const matched = nameMap[normalizeName(odc.supplierRaw)];
        if (matched) { odc.supplierRaw = matched; found = true; matchedByMap[odc.poNumber] = 'name'; }
      }
      if (!found) {
        matchedByMap[odc.poNumber] = 'none';
        const key = odc.supplierRfc || odc.supplierRaw || 'sin-rfc';
        if (!notFoundMap[key]) {
          const fuzzy = findBestSupplierMatch(odc.supplierRaw, supplierNormalizedNames, supplierOriginalNames);
          notFoundMap[key] = {
            rfc: odc.supplierRfc,
            name: odc.supplierRaw,
            odcCount: 0,
            suggestedMatch: fuzzy && fuzzy.score > 0.4 ? fuzzy.name : undefined,
            suggestedScore: fuzzy && fuzzy.score > 0.4 ? Math.round(fuzzy.score * 100) / 100 : undefined,
          };
        }
        notFoundMap[key].odcCount++;
      }
    }

    const allProjects = [...new Set(odcs.map(o => o.projectCode).filter(Boolean))];
    const projectsToCreate = allProjects.filter(p => !existingProjectMap.has(p.toUpperCase().trim()));

    const sampleOdcs = odcs.slice(0, 25).map(odc => ({
      poNumber: odc.poNumber,
      projectCode: odc.projectCode,
      description: odc.description,
      rubro: mapRubro(odc.rubro),
      supplierName: odc.supplierRaw || '—',
      supplierFound: matchedByMap[odc.poNumber] !== 'none',
      matchedBy: matchedByMap[odc.poNumber] ?? 'none',
      totalAmount: odc.totalAmount,
      status: mapCsvStatus(odc.sendStatus, odc.payStatus),
      lineItemCount: odc.lineItems.length,
    }));

    return {
      totalOdcs: odcs.length,
      totalLineItems: odcs.reduce((s, o) => s + o.lineItems.length, 0),
      totalProjects: allProjects.length,
      totalAmount: odcs.reduce((s, o) => s + o.totalAmount, 0),
      projectsToCreate,
      suppliersNotFound: Object.values(notFoundMap).slice(0, 100),
      existingProjects,
      existingSuppliers,
      sampleOdcs,
      existingOdcCount,
      newOdcCount,
      existingPoNumbers,
    };
  },
});
