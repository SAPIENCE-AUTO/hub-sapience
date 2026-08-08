import { z } from 'zod';
import { createEndpoint, Projects, Suppliers, PurchaseOrders, PoLineItems } from '../../server/compat';

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

/** Map CSV send/pay statuses to system status */
function mapCsvStatus(sendStatus: string, payStatus: string): string {
  if (payStatus.toLowerCase().includes('pagada')) return 'Pagada';
  if (sendStatus.toLowerCase().includes('enviada')) return 'Factura recibida';
  return 'Aprobada';
}

/** Detect ODC type from item name */
function mapTipoDeOc(name: string): 'Anticipo' | 'Cierre' | 'Normal' {
  const lc = name.toLowerCase();
  if (lc.includes('anticipo')) return 'Anticipo';
  if (lc.includes('cierre') || lc.includes('finalización') || lc.includes('finalizacion')) return 'Cierre';
  return 'Normal';
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
  totalAmount: number;     // col 29: Total Sin IVA (después de restar anticipo)
  anticipoMxn: number;     // col 27: Anticipo (MXN$)
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
      const emailCandidate = [c(10), c(11), c(12)].find(v => v.includes('@') && v.includes('.')) ?? '';
      const sendStatus = statusOdcCol >= 0 ? c(statusOdcCol) : '';
      const payStatus = statusPagoCol >= 0 ? c(statusPagoCol) : c(31);

      // col 27: Anticipo (MXN$)
      // col 29: Total Sin IVA = total bruto - anticipo (lo que realmente se debe pagar)
      // col 21: Total de actividades (MXN$) — fallback si col 29 está vacía
      const anticipoMxn = pn(c(27));
      const totalSinIva = pn(c(29));
      const totalBruto = pn(c(21)) || pn(c(20));
      // Use totalSinIva if available, otherwise totalBruto
      const totalAmount = totalSinIva !== 0 ? totalSinIva : totalBruto;

      const odc: ParsedODC = {
        projectCode: currentProject,
        poNumber: c4,
        description: c0 === 'Agregar pago' ? '' : c0,
        rubro: c(5),
        supplierRaw: c(8) || c(7),
        supplierRfc: c(9),
        supplierEmail: emailCandidate,
        currency: c(3).replace(' $', '').trim() || 'MXN',
        totalAmount,
        anticipoMxn,
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export default createEndpoint({
  authenticated: true,
  description: 'Import ODCs from a Monday.com CSV. Accepts project/supplier mappings for manual resolution. Call in batches until done=true.',
  inputSchema: z.object({
    csvUrl: z.string(),
    batchOffset: z.number(),
    batchSize: z.number().optional(),
    projectMappings: z.record(z.string(), z.string()).optional(),
    supplierMappings: z.record(z.string(), z.string()).optional(),
    skipExisting: z.boolean().optional(),
    amountsOnly: z.boolean().optional(), // Only update totalAmount, tipoDeOc and line items on existing ODCs
  }),
  outputSchema: z.object({
    created: z.number(),
    newCount: z.number(),
    updatedCount: z.number(),
    lineItemsCreated: z.number(),
    projectsCreated: z.number(),
    suppliersCreated: z.number(),
    batchOffset: z.number(),
    done: z.boolean(),
    totalOdcs: z.number(),
  }),
  execute: async ({ input, context }) => {
    const { csvUrl, batchOffset, batchSize = 50, projectMappings = {}, supplierMappings = {}, skipExisting = false, amountsOnly = false } = input;

    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error(`No se pudo obtener el CSV: ${resp.status}`);
    const text = await resp.text();
    const odcs = parseMondayCsv(text);

    // ── AMOUNTS ONLY MODE ─────────────────────────────────────────────────────
    // Only update totalAmount, tipoDeOc, and line items on existing ODCs by poNumber.
    // No project/supplier resolution needed.
    if (amountsOnly) {
      const batch = odcs.slice(batchOffset, batchOffset + batchSize);
      if (batch.length === 0) {
        return { created: 0, newCount: 0, updatedCount: 0, lineItemsCreated: 0, projectsCreated: 0, suppliersCreated: 0, batchOffset, done: true, totalOdcs: odcs.length };
      }

      const poNumbers = batch.map(o => o.poNumber).filter(Boolean) as string[];
      const { records: existingPos } = await PurchaseOrders.findAll({
        filters: { poNumber: { in: poNumbers } },
        fields: ['poNumber'],
        limit: poNumbers.length,
      });

      const poIdByNumber: Record<string, string> = {};
      for (const p of existingPos) if (p.poNumber) poIdByNumber[p.poNumber] = p.id;

      // Update totalAmount + tipoDeOc on each existing PO
      let updatedCount = 0;
      for (const odc of batch) {
        const id = poIdByNumber[odc.poNumber];
        if (!id) continue;
        await PurchaseOrders.update({ id, record: { totalAmount: odc.totalAmount || undefined, tipoDeOc: mapTipoDeOc(odc.description) } });
        updatedCount++;
        if (updatedCount % 10 === 0) await sleep(100); // rate limit safety
      }

      // Refresh line items: delete old, create new
      const existingPoIds = Object.values(poIdByNumber).filter(Boolean);
      if (existingPoIds.length > 0) {
        const { records: oldItems } = await PoLineItems.findAll({ filters: { poId: { in: existingPoIds } }, limit: 2000, fields: [] });
        for (const item of oldItems) await PoLineItems.delete({ id: item.id });
        if (oldItems.length > 0) await sleep(150);
      }

      const lineItems: any[] = [];
      for (const odc of batch) {
        const poId = poIdByNumber[odc.poNumber];
        if (!poId) continue;
        for (const item of odc.lineItems) {
          lineItems.push({ description: item.description || '—', quantity: item.quantity || undefined, unitPrice: item.unitPrice || undefined, total: item.total || undefined, category: mapRubro(odc.rubro), poId });
        }
        if (odc.anticipoMxn > 0) {
          lineItems.push({ description: 'Anticipo', quantity: 1, unitPrice: -odc.anticipoMxn, total: -odc.anticipoMxn, category: mapRubro(odc.rubro), poId });
        }
      }

      let lineItemsCreated = 0;
      for (let i = 0; i < lineItems.length; i += 100) {
        const r = await PoLineItems.bulkCreate({ records: lineItems.slice(i, i + 100) });
        lineItemsCreated += r.records.length;
        if (i + 100 < lineItems.length) await sleep(150);
      }

      const done = batchOffset + batchSize >= odcs.length;
      return { created: 0, newCount: 0, updatedCount, lineItemsCreated, projectsCreated: 0, suppliersCreated: 0, batchOffset, done, totalOdcs: odcs.length };
    }
    // ── END AMOUNTS ONLY ──────────────────────────────────────────────────────

    const { records: suppliers } = await Suppliers.findAll({ fields: ['supplierName', 'taxId', 'email'], limit: 2000 });
    const rfcMap: Record<string, string> = {};
    const emailMap: Record<string, string> = {};
    const nameMap: Record<string, string> = {};
    for (const s of suppliers) {
      const name = s.supplierName ?? '';
      if (s.taxId) rfcMap[s.taxId.toUpperCase().trim()] = name;
      if (s.email) emailMap[s.email.toLowerCase().trim()] = name;
      if (name) nameMap[normalizeName(name)] = name;
    }

    let projectsCreated = 0;
    let suppliersCreated = 0;

    const { records: allExistingProjects } = await Projects.findAll({ fields: ['projectCode'], limit: 2000 });
    const existingProjectMap = new Map<string, string>();
    for (const p of allExistingProjects) if (p.projectCode) existingProjectMap.set(p.projectCode.toUpperCase().trim(), p.projectCode);

    if (batchOffset === 0) {
      const allCodes = [...new Set(odcs.map(o => o.projectCode).filter(Boolean))];
      const toCreate = allCodes.filter(code => {
        if (existingProjectMap.has(code.toUpperCase().trim())) return false;
        const mapped = projectMappings[code];
        if (mapped === 'skip') return false;
        return !mapped || mapped === 'create';
      });
      if (toCreate.length > 0) {
        const r = await Projects.bulkCreate({
          records: toCreate.map(code => ({ projectCode: code, status: 'En curso' })),
          matchOn: ['projectCode'],
        });
        projectsCreated = r.records.length;
      }

      const suppliersToCreate: Array<{ supplierName: string; taxId?: string }> = [];
      for (const [key, decision] of Object.entries(supplierMappings)) {
        if (decision === 'create') {
          const odc = odcs.find(o => (o.supplierRfc || o.supplierRaw || '') === key);
          if (odc && odc.supplierRaw) {
            suppliersToCreate.push({ supplierName: odc.supplierRaw, taxId: odc.supplierRfc || undefined });
          }
        }
      }
      if (suppliersToCreate.length > 0) {
        const r = await Suppliers.bulkCreate({ records: suppliersToCreate, matchOn: ['supplierName'] });
        suppliersCreated = r.records.length;
        for (const rec of r.records) {
          const name = rec.supplierName;
          if (name) nameMap[normalizeName(name)] = name;
        }
      }
    }

    const batch = odcs.slice(batchOffset, batchOffset + batchSize);
    if (batch.length === 0) {
      return { created: 0, newCount: 0, updatedCount: 0, lineItemsCreated: 0, projectsCreated, suppliersCreated, batchOffset, done: true, totalOdcs: odcs.length };
    }

    const poRecords = batch.map(odc => {
      const mappedProject = projectMappings[odc.projectCode];
      const effectiveProjectCode =
        mappedProject === 'skip' ? '' :
        (mappedProject && mappedProject !== 'create') ? mappedProject :
        existingProjectMap.get(odc.projectCode.toUpperCase().trim()) ?? odc.projectCode;

      let supplierName = odc.supplierRaw;
      let dbMatched = false;

      if (odc.supplierRfc) {
        const m = rfcMap[odc.supplierRfc.toUpperCase().trim()];
        if (m) { supplierName = m; dbMatched = true; }
      }
      if (!dbMatched && odc.supplierEmail) {
        const m = emailMap[odc.supplierEmail.toLowerCase().trim()];
        if (m) { supplierName = m; dbMatched = true; }
      }
      if (!dbMatched && odc.supplierRaw) {
        const m = nameMap[normalizeName(odc.supplierRaw)];
        if (m) { supplierName = m; dbMatched = true; }
      }

      if (!dbMatched) {
        const key = odc.supplierRfc || odc.supplierRaw || '';
        const decision = supplierMappings[key];
        if (decision && decision !== 'raw' && decision !== 'create') {
          supplierName = decision;
        }
      }

      const wasEnviada = odc.sendStatus.toLowerCase().includes('enviada');
      const tipoDeOc = mapTipoDeOc(odc.description);

      return {
        poNumber: odc.poNumber,
        projectCode: effectiveProjectCode,
        supplierName: supplierName || '(sin proveedor)',
        totalAmount: odc.totalAmount || undefined,
        status: mapCsvStatus(odc.sendStatus, odc.payStatus),
        notes: odc.description || undefined,
        category: mapRubro(odc.rubro),
        currency: odc.currency || 'MXN',
        issueDate: odc.issueDate,
        createdBy: context.user!.email,
        pdfUrl: odc.pdfUrl,
        origen: 'Migrada' as const,
        tipoDeOc,
        ...(wasEnviada ? { emailSentAt: odc.issueDate ? new Date(odc.issueDate).toISOString() : new Date().toISOString() } : {}),
      };
    });

    const batchPoNumbers = poRecords.map(r => r.poNumber).filter(Boolean) as string[];
    const { records: existingPos } = await PurchaseOrders.findAll({
      filters: { poNumber: { in: batchPoNumbers } },
      fields: ['poNumber'],
      limit: batchPoNumbers.length,
    });
    const existingPoNumbersSet = new Set(existingPos.map(p => p.poNumber).filter(Boolean));

    // When skipExisting, filter out records whose poNumber already exists
    const filteredPoRecords = skipExisting
      ? poRecords.filter(r => r.poNumber && !existingPoNumbersSet.has(r.poNumber))
      : poRecords;

    if (filteredPoRecords.length === 0) {
      const done = batchOffset + batchSize >= odcs.length;
      return { created: 0, newCount: 0, updatedCount: 0, lineItemsCreated: 0, projectsCreated, suppliersCreated, batchOffset, done, totalOdcs: odcs.length };
    }

    const poResult = await PurchaseOrders.bulkCreate({
      records: filteredPoRecords,
      matchOn: ['poNumber'],
    });

    const filteredPoNumbers = filteredPoRecords.map(r => r.poNumber).filter(Boolean) as string[];
    const newCount = filteredPoNumbers.filter(n => !existingPoNumbersSet.has(n)).length;
    const updatedCount = filteredPoNumbers.filter(n => existingPoNumbersSet.has(n)).length;

    const poIdMap: Record<string, string> = {};
    for (const r of poResult.records) {
      const num = r.poNumber;
      if (num) poIdMap[num] = r.id;
    }

    const existingPoIds = filteredPoNumbers
      .filter(n => existingPoNumbersSet.has(n))
      .map(n => poIdMap[n])
      .filter(Boolean) as string[];

    if (existingPoIds.length > 0) {
      const { records: oldLineItems } = await PoLineItems.findAll({
        filters: { poId: { in: existingPoIds } },
        limit: 2000,
        fields: [],
      });
      for (const item of oldLineItems) {
        await PoLineItems.delete({ id: item.id });
      }
      if (oldLineItems.length > 0) await sleep(100);
    }

    const filteredPoNumbersSet = new Set(filteredPoNumbers);
    const lineItems: any[] = [];
    for (const odc of batch) {
      if (!filteredPoNumbersSet.has(odc.poNumber)) continue;
      const poId = poIdMap[odc.poNumber];
      if (!poId) continue;

      // Regular subitems
      for (const item of odc.lineItems) {
        lineItems.push({
          description: item.description || '—',
          quantity: item.quantity || undefined,
          unitPrice: item.unitPrice || undefined,
          total: item.total || undefined,
          category: mapRubro(odc.rubro),
          poId,
        });
      }

      // Anticipo as a negative line item so sum reflects the real total
      if (odc.anticipoMxn > 0) {
        lineItems.push({
          description: 'Anticipo',
          quantity: 1,
          unitPrice: -odc.anticipoMxn,
          total: -odc.anticipoMxn,
          category: mapRubro(odc.rubro),
          poId,
        });
      }
    }

    let lineItemsCreated = 0;
    for (let i = 0; i < lineItems.length; i += 100) {
      const r = await PoLineItems.bulkCreate({ records: lineItems.slice(i, i + 100) });
      lineItemsCreated += r.records.length;
      if (i + 100 < lineItems.length) await sleep(150);
    }

    const done = batchOffset + batchSize >= odcs.length;
    return { created: poResult.records.length, newCount, updatedCount, lineItemsCreated, projectsCreated, suppliersCreated, batchOffset, done, totalOdcs: odcs.length };
  },
});
