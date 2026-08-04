import { z } from 'zod';
import { createEndpoint, Projects, RecruitmentRows, BoardColumns, CellValues, Boards } from 'zite-integrations-backend-sdk';
import OpenAI from 'openai';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const distributionItem = z.object({ label: z.string(), count: z.number() });

const distributionSchema = z.object({
  fieldName: z.string(),
  chartType: z.enum(['donut', 'bar']),
  items: z.array(distributionItem),
});

const inlineDistribution = z.object({
  chartType: z.enum(['donut', 'bar']),
  items: z.array(distributionItem),
});

const criterionSchema = z.object({
  criterion: z.string(),
  expected: z.string(),
  actual: z.string(),
  status: z.enum(['cumple', 'revisar', 'no_cumple']),
  action: z.string().optional(),
  distribution: inlineDistribution.optional(),
});

const participantRecord = z.object({ name: z.string(), fields: z.record(z.string(), z.string()) });

const groupAnalysis = z.object({
  groupName: z.string(),
  totalParticipants: z.number(),
  requiredParticipants: z.number().nullable(),
  criteria: z.array(criterionSchema),
  alerts: z.array(z.string()),
  status: z.enum(['cumple', 'revisar', 'no_cumple']),
  complianceNote: z.string(),
  participants: z.array(participantRecord),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchAllCellValues(filters: Record<string, any>): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { records, hasMore } = await CellValues.findAll({ filters: filters as any, limit: 2000, offset });
    all.push(...records);
    if (!hasMore) break;
    offset += records.length;
  }
  return all;
}

type DistItem = { label: string; count: number };
type CalcDist = { fieldName: string; chartType: 'donut' | 'bar'; items: DistItem[] };

// ─── Field detection patterns ─────────────────────────────────────────────────

const FIELD_PATTERNS = {
  gender: /g[eé]nero|sexo/i,
  age:    /^edad$|rango.{0,10}edad|edad.{0,10}rango|^edad\b/i,
  region: /regi[oó]n|ciudad|estado|zona|localidad/i,
  brand:  /marca|favorit|preferid|indispensable|principal|m[aá]s.{0,10}consum/i,
  nse:    /^nse$|nivel.{0,10}socio.?econ/i,
};

// ─── AMAI 2020 NSE calculation ────────────────────────────────────────────────

const AMAI_COL = {
  escolaridad:  /escolaridad\s*jdf|escolaridad\s*jefe/i,
  banos:        /ba[ñn]os?\s*complet/i,
  autos:        /autom[oó]vil/i,
  internet:     /conexi[oó]n.*m[oó]vil|internet|banda\s*ancha/i,
  trabajadores: /trabajador/i,
  habitaciones: /habitaci[oó]n/i,
};

function scoreAMAI(key: keyof typeof AMAI_COL, value: string): number {
  const v = value.toLowerCase().trim();
  switch (key) {
    case 'escolaridad': {
      if (/diplomado|maestr[ií]a|doctorado/.test(v)) return 72;
      if (/licenciatura\s*(completa|terminada|trunca)?|carrera\s*(profesional|universit)|ingenier[ií]a/.test(v)) {
        if (/complet|terminad/.test(v)) return 52;
        return 38; // incompleta
      }
      if (/preparatoria|bachillerato|prepa/.test(v)) return 38;
      if (/secundaria/.test(v)) return 22;
      if (/primaria/.test(v)) return 22;
      return 0;
    }
    case 'banos': {
      const n = parseInt(v);
      if (!isNaN(n)) return n >= 2 ? 42 : n === 1 ? 18 : 0;
      if (/2|dos|m[aá]s/.test(v)) return 42;
      if (/1|un/.test(v)) return 18;
      return 0;
    }
    case 'autos': {
      const n = parseInt(v);
      if (!isNaN(n)) return n >= 2 ? 41 : n === 1 ? 22 : 0;
      if (/2|dos|m[aá]s/.test(v)) return 41;
      if (/1|un/.test(v)) return 22;
      return 0;
    }
    case 'internet': {
      return /s[ií]|tiene|cuenta|yes/.test(v) ? 10 : 0;
    }
    case 'trabajadores': {
      const n = parseInt(v);
      if (!isNaN(n)) return n >= 3 ? 31 : n >= 1 ? 12 : 0;
      if (/ninguno|cero|no\s*tiene/.test(v)) return 0;
      if (/[3456789]|m[aá]s/.test(v)) return 31;
      return 12;
    }
    case 'habitaciones': {
      const n = parseInt(v);
      if (!isNaN(n)) {
        if (n >= 4) return 22;
        if (n === 3) return 14;
        if (n === 2) return 8;
        return 0;
      }
      return 0;
    }
  }
}

function scoreToNSE(score: number): string {
  if (score >= 193) return 'A/B';
  if (score >= 155) return 'C+';
  if (score >= 128) return 'C';
  if (score >= 105) return 'C-';
  if (score >= 80)  return 'D+';
  if (score >= 33)  return 'D';
  return 'E';
}

const NSE_ORDER = ['A/B', 'C+', 'C', 'C-', 'D+', 'D', 'E'];

const AMAI_MAX: Record<keyof typeof AMAI_COL, number> = {
  escolaridad:  72,
  banos:        42,
  autos:        41,
  trabajadores: 31,
  habitaciones: 22,
  internet:     10,
};

function calculateNSE(participantData: Record<string, string>): string | null {
  const fieldNames = Object.keys(participantData);
  let score = 0;
  let maxPossible = 0;
  let matched = 0;
  for (const [amaiKey, pattern] of Object.entries(AMAI_COL) as [keyof typeof AMAI_COL, RegExp][]) {
    const colName = fieldNames.find(f => pattern.test(f));
    if (!colName) continue;
    const val = participantData[colName];
    if (!val || val.trim() === '') continue;
    score += scoreAMAI(amaiKey, val);
    maxPossible += AMAI_MAX[amaiKey as keyof typeof AMAI_COL];
    matched++;
  }
  if (matched < 2 || maxPossible === 0) return null;
  const normalizedScore = Math.round((score / maxPossible) * 218);
  return scoreToNSE(normalizedScore);
}

function computeNSEDist(groupRows: Record<string, string>[]): CalcDist | null {
  const counts: Record<string, number> = {};
  let computed = 0;
  for (const row of groupRows) {
    const level = calculateNSE(row);
    if (!level) continue;
    counts[level] = (counts[level] ?? 0) + 1;
    computed++;
  }
  if (computed === 0) return null;
  const items = NSE_ORDER.filter(l => counts[l] > 0).map(l => ({ label: l, count: counts[l] }));
  return { fieldName: 'NSE (estimado)', chartType: 'donut', items };
}

// ─── Distribution helpers ─────────────────────────────────────────────────────

/** Generate per-age distribution, or return as categories if values are already text ranges */
function bucketAge(values: string[]): DistItem[] {
  // If values look like text ranges ("19 a 24 años", "25-35 años"), treat as categories
  const isTextRange = (v: string) => / a /i.test(v) || /años/i.test(v) || /\d+-\d+/.test(v);
  const textRangeCount = values.filter(isTextRange).length;
  if (textRangeCount > values.length * 0.4) {
    const counts: Record<string, number> = {};
    for (const v of values) {
      const key = v.trim();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([label, count]) => ({ label, count }));
  }
  // Numeric ages — one item per individual age in full range, including zeros (gaps)
  const nums = values.map(v => parseInt(v, 10)).filter(n => !isNaN(n));
  if (!nums.length) return [];
  const counts: Record<number, number> = {};
  for (const n of nums) counts[n] = (counts[n] ?? 0) + 1;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const items: DistItem[] = [];
  for (let age = min; age <= max; age++) {
    items.push({ label: String(age), count: counts[age] ?? 0 });
  }
  return items;
}

/** Compute value distribution for a field across a list of participant data objects */
function calcFieldDist(fieldName: string, rows: Record<string, string>[]): DistItem[] {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const val = row[fieldName];
    if (!val || val.trim() === '') continue;
    counts[val.trim()] = (counts[val.trim()] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => ({ label, count }));
}

/** Detect relevant fields from all available field names in the dataset */
function detectRelevantFields(allFieldNames: string[]): Record<keyof typeof FIELD_PATTERNS, string | null> {
  const result = {} as Record<keyof typeof FIELD_PATTERNS, string | null>;
  for (const [key, pattern] of Object.entries(FIELD_PATTERNS)) {
    if (key === 'age') {
      // Prefer exact match "Edad" (numeric) before fuzzy patterns like "Rango de edad"
      const exact = allFieldNames.find(f => /^edad$/i.test(f));
      result.age = exact ?? allFieldNames.find(f => pattern.test(f)) ?? null;
    } else {
      result[key as keyof typeof FIELD_PATTERNS] = allFieldNames.find(f => pattern.test(f)) ?? null;
    }
  }
  return result;
}

type GroupDists = Record<keyof typeof FIELD_PATTERNS, CalcDist | null> & { nseCalc: CalcDist | null };

/** Pre-compute distributions for a group's participants, including AMAI NSE */
function computeGroupDistributions(
  groupRows: Record<string, string>[],
  detectedFields: Record<keyof typeof FIELD_PATTERNS, string | null>
): GroupDists {
  const result = {} as GroupDists;

  for (const key of Object.keys(FIELD_PATTERNS) as Array<keyof typeof FIELD_PATTERNS>) {
    const fieldName = detectedFields[key];
    if (!fieldName) { result[key] = null; continue; }

    if (key === 'age') {
      const vals = groupRows.map(r => r[fieldName]).filter(Boolean);
      const buckets = bucketAge(vals);
      result[key] = buckets.length ? { fieldName, chartType: 'bar', items: buckets } : null;
    } else {
      const items = calcFieldDist(fieldName, groupRows);
      if (!items.length) { result[key] = null; continue; }
      const chartType: 'donut' | 'bar' = items.length <= 6 ? 'donut' : 'bar';
      result[key] = { fieldName, chartType, items };
    }
  }

  // AMAI-based NSE calculation (overrides any literal NSE column if absent)
  result.nseCalc = computeNSEDist(groupRows) ?? result.nse;

  return result;
}

/** Match a criterion label to a pre-computed distribution */
function matchCriterionDist(
  criterionLabel: string,
  dists: GroupDists
): { chartType: 'donut' | 'bar'; items: DistItem[] } | undefined {
  const l = criterionLabel.toLowerCase();
  if (/g[eé]nero|sexo/.test(l) && dists.gender) return { chartType: dists.gender.chartType, items: dists.gender.items };
  if (/edad|rango.{0,10}edad/.test(l) && dists.age) return { chartType: dists.age.chartType, items: dists.age.items };
  if (/regi[oó]n|ciudad|estado|zona/.test(l) && dists.region) return { chartType: dists.region.chartType, items: dists.region.items };
  if (/marca|favorit|preferid/.test(l) && dists.brand) return { chartType: dists.brand.chartType, items: dists.brand.items };
  if (/nse|nivel.{0,10}soci|nivel.{0,10}econ|ingreso/.test(l) && dists.nseCalc) return { chartType: dists.nseCalc.chartType, items: dists.nseCalc.items };
  return undefined;
}

/** Aggregate distributions from all groups for the global view */
function aggregateGlobalDistributions(groupDists: GroupDists[]): CalcDist[] {
  const aggregate: Record<string, CalcDist> = {};

  const addDist = (dist: CalcDist | null) => {
    if (!dist) return;
    if (!aggregate[dist.fieldName]) {
      aggregate[dist.fieldName] = { fieldName: dist.fieldName, chartType: dist.chartType, items: [] };
    }
    for (const item of dist.items) {
      const existing = aggregate[dist.fieldName].items.find(i => i.label === item.label);
      if (existing) existing.count += item.count;
      else aggregate[dist.fieldName].items.push({ ...item });
    }
  };

  for (const dists of groupDists) {
    addDist(dists.gender);
    addDist(dists.age);
    addDist(dists.region);
    addDist(dists.brand);
    addDist(dists.nseCalc); // use calculated NSE (AMAI or literal column)
  }

  // Sort NSE items by canonical order
  return Object.values(aggregate).map(d => ({
    ...d,
    items: d.fieldName === 'NSE (estimado)'
      ? NSE_ORDER.filter(l => d.items.find(i => i.label === l)).map(l => d.items.find(i => i.label === l)!)
      : d.items.sort((a, b) => b.count - a.count),
  }));
}

// ─── Endpoint ─────────────────────────────────────────────────────────────────

export default createEndpoint({
  authenticated: true,
  description: 'Analyzes recruitment data for a board against the project muestra criteria using AI',
  inputSchema: z.object({ projectCode: z.string(), boardName: z.string() }),
  outputSchema: z.object({
    muestra: z.string(),
    groups: z.array(groupAnalysis),
    globalSummary: z.string(),
    globalDistributions: z.array(distributionSchema),
    overallStatus: z.enum(['cumple', 'revisar', 'no_cumple']),
    totalParticipants: z.number(),
    generatedAt: z.string(),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName } = input;

    const project = await Projects.findOne({ filters: { projectCode } });
    const muestra = project?.muestra ?? '';
    const muestraImagen = project?.muestraImagen ?? '';
    const analysisInstructions = project?.instruccionesDeAnalisis ?? '';

    // Resolve board UUID — try direct lookup first, fall back to legacy composite
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let boardId: string;
    const { records: matchingBoards } = await Boards.findAll({
      filters: { projectCode, boardName },
      limit: 5,
    });
    const activeBoard = matchingBoards.find(b => !b.deletedAt);
    if (activeBoard) {
      boardId = activeBoard.id;
    } else {
      boardId = `recruitment-${projectCode}-${boardName}`;
    }
    const groupsBoardId = `${boardId}::groups`;

    // For CellValues/BoardColumns dual-read, prepare both UUID and legacy candidates
    const legacyBoardId = `recruitment-${projectCode}-${boardName}`;
    const boardIdCandidates = boardId !== legacyBoardId ? [boardId, legacyBoardId] : [boardId];

    // Dual-read: fetch from UUID groups board + legacy groups board
    const legacyGroupsBoardId = `${legacyBoardId}::groups`;
    const groupsCandidates = boardId !== legacyBoardId ? [groupsBoardId, legacyGroupsBoardId] : [groupsBoardId];

    const [{ records: rows }] = await Promise.all([
      RecruitmentRows.findAll({ filters: { projectCode, boardName }, limit: 2000 }),
    ]);

    // Dual-read group columns
    const groupColumnsSeen = new Set<string>();
    const groupColumns: typeof rows extends any[] ? any[] : never = [];
    for (const gBid of groupsCandidates) {
      const { records } = await BoardColumns.findAll({ filters: { boardId: gBid } as any, limit: 200 });
      for (const r of records) { if (!groupColumnsSeen.has(r.id)) { groupColumnsSeen.add(r.id); groupColumns.push(r); } }
    }

    // Dual-read group assignments
    const groupAssignmentsSeen = new Set<string>();
    const groupAssignments: any[] = [];
    for (const gBid of groupsCandidates) {
      const { records } = await CellValues.findAll({ filters: { boardId: gBid, textValue: '1' } as any, limit: 2000 });
      for (const r of records) {
        const key = `${r.rowId}::${r.columnId}`;
        if (!groupAssignmentsSeen.has(key)) { groupAssignmentsSeen.add(key); groupAssignments.push(r); }
      }
    }

    const groupColMap: Record<string, string> = {};
    for (const col of groupColumns) {
      if (col.id && col.columnName) groupColMap[col.id] = col.columnName;
    }

    const rowGroupMap: Record<string, string> = {};
    for (const cv of groupAssignments) {
      if (cv.rowId && cv.columnId && groupColMap[cv.columnId]) {
        rowGroupMap[cv.rowId] = groupColMap[cv.columnId];
      }
    }

    const rowsWithGroup = rows.filter(r => rowGroupMap[r.id]);

    if (rowsWithGroup.length === 0) {
      return {
        muestra: muestra || (muestraImagen ? '(ver imagen adjunta)' : 'Sin criterios definidos'),
        groups: [], globalSummary: 'No hay participantes asignados a grupos en este tablero.',
        globalDistributions: [], overallStatus: 'revisar' as const,
        totalParticipants: 0, generatedAt: new Date().toISOString(),
      };
    }

    const assignedRowIds = rowsWithGroup.map(r => r.id);

    // Dual-read main board columns + cell values
    const mainColsSeen = new Set<string>();
    const mainBoardCols: any[] = [];
    for (const bid of boardIdCandidates) {
      const { records } = await BoardColumns.findAll({ filters: { boardId: bid } as any, limit: 200 });
      for (const r of records) { if (!mainColsSeen.has(r.id)) { mainColsSeen.add(r.id); mainBoardCols.push(r); } }
    }

    let allParticipantCells: any[] = [];
    for (const bid of boardIdCandidates) {
      const cells = await fetchAllCellValues({ boardId: bid, rowId: { in: assignedRowIds } });
      allParticipantCells.push(...cells);
    }
    // Deduplicate by rowId::columnId (prefer UUID)
    const cellSeen = new Set<string>();
    allParticipantCells = allParticipantCells.filter(cv => {
      const key = `${cv.rowId}::${cv.columnId}`;
      if (cellSeen.has(key)) return false;
      cellSeen.add(key);
      return true;
    });

    const mainColNames: Record<string, string> = {};
    for (const col of mainBoardCols) {
      if (col.id && col.columnName && !col.deletedAt) mainColNames[col.id] = col.columnName;
    }

    const SYSTEM_COLS = new Set(['NDA Firmado', 'Identificación 2', 'Asistencia', 'NR', 'Reclutador', 'Dirección', 'Motivo Rechazo']);
    const cellsByRow: Record<string, Record<string, string>> = {};
    for (const cv of allParticipantCells) {
      if (!cv.rowId || !cv.columnId || !cv.textValue || cv.deletedAt) continue;
      const colName = mainColNames[cv.columnId];
      if (!colName || SYSTEM_COLS.has(colName)) continue;
      const val = cv.textValue;
      if (val.startsWith('http') || val.length > 200) continue;
      if (!cellsByRow[cv.rowId]) cellsByRow[cv.rowId] = {};
      cellsByRow[cv.rowId][colName] = val;
    }

    // Build participant data with group assignment
    const participantData = rowsWithGroup.map(row => ({
      nombre: row.participantName ?? row.rowName ?? 'Sin nombre',
      grupo: rowGroupMap[row.id],
      datos: cellsByRow[row.id] ?? {},
    }));

    // ── Pre-compute distributions (real data, no AI) ──────────────────────────

    const allFieldNames = [...new Set(participantData.flatMap(p => Object.keys(p.datos)))];
    const detectedFields = detectRelevantFields(allFieldNames);

    // Group participants by group name
    const rowsByGroup: Record<string, Record<string, string>[]> = {};
    const rawByGroup: Record<string, Array<{ name: string; fields: Record<string, string> }>> = {};
    for (const p of participantData) {
      if (!rowsByGroup[p.grupo]) { rowsByGroup[p.grupo] = []; rawByGroup[p.grupo] = []; }
      rowsByGroup[p.grupo].push(p.datos);
      rawByGroup[p.grupo].push({ name: p.nombre, fields: p.datos });
    }

    // Pre-compute distributions per group (including AMAI NSE)
    const groupDistributions: Record<string, GroupDists> = {};
    for (const [groupName, gRows] of Object.entries(rowsByGroup)) {
      groupDistributions[groupName] = computeGroupDistributions(gRows, detectedFields);
    }

    // Global distributions — aggregate all groups
    const globalDistributions = aggregateGlobalDistributions(Object.values(groupDistributions));

    // Match participants to AI-simplified group names
    const matchParticipants = (aiName: string) => {
      if (rawByGroup[aiName]) return rawByGroup[aiName];
      const aiLow = aiName.toLowerCase();
      for (const [orig, parts] of Object.entries(rawByGroup)) {
        if (orig.toLowerCase().includes(aiLow)) return parts;
      }
      const words = aiLow.split(/[\s\-\(\)\/]+/).filter(w => w.length > 3);
      let best = { n: 0, key: '' };
      for (const orig of Object.keys(rawByGroup)) {
        const origL = orig.toLowerCase();
        const n = words.filter(w => origL.includes(w)).length;
        if (n > best.n) best = { n, key: orig };
      }
      return best.n >= 1 ? (rawByGroup[best.key] ?? []) : [];
    };

    // Match pre-computed distributions to AI group name
    const matchGroupDist = (aiName: string): GroupDists | null => {
      if (groupDistributions[aiName]) return groupDistributions[aiName];
      const aiLow = aiName.toLowerCase();
      for (const [orig, dists] of Object.entries(groupDistributions)) {
        if (orig.toLowerCase().includes(aiLow)) return dists;
      }
      const words = aiLow.split(/[\s\-\(\)\/]+/).filter(w => w.length > 3);
      let best = { n: 0, key: '' };
      for (const orig of Object.keys(groupDistributions)) {
        const origL = orig.toLowerCase();
        const n = words.filter(w => origL.includes(w)).length;
        if (n > best.n) best = { n, key: orig };
      }
      return best.n >= 1 ? groupDistributions[best.key] : null;
    };

    // ── Build AI prompt (NO distributions requested from AI) ──────────────────

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });

    const criteriosText = muestra.trim()
      ? `CRITERIOS DE MUESTRA:\n${muestra}`
      : muestraImagen
      ? 'Los criterios de muestra están en la imagen adjunta.'
      : 'No se especificaron criterios. Analiza los datos y genera estadísticas descriptivas.';

    const criteriosDeEvaluacion = analysisInstructions.trim()
      ? `\n━━━ CRITERIOS DE EVALUACIÓN DEFINIDOS POR EL USUARIO ━━━\nUsa estos criterios exactos como checklist para cada grupo:\n\n${analysisInstructions.trim()}\n\nIMPORTANTE: Evalúa TODOS estos criterios para cada grupo, aunque cumplan.\n`
      : `\n━━━ CRITERIOS A INFERIR ━━━\nInfiere los criterios relevantes de la muestra y los datos. Evalúa al menos: género, edad/rango, marca (si aplica), NSE (si aplica), región, participantes requeridos.\n`;

    // Summary data per group (no raw participant details to keep prompt small)
    const groupSummaries = Object.entries(rowsByGroup).map(([groupName, gRows]) => {
      const total = gRows.length;
      const fieldSummary: Record<string, string> = {};
      for (const [key, fieldName] of Object.entries(detectedFields)) {
        if (!fieldName) continue;
        const vals = gRows.map(r => r[fieldName]).filter(Boolean);
        if (!vals.length) continue;
        if (key === 'age') {
          // Detect if values are text ranges ("19 a 24 años") or numeric ages
          const isTextRange = (v: string) => / a /i.test(v) || /años/i.test(v) || /\d+-\d+/.test(v);
          const textRangeCount = vals.filter(isTextRange).length;
          if (textRangeCount > vals.length * 0.4) {
            // Categorical ranges — summarize as counts
            const counts: Record<string, number> = {};
            vals.forEach(v => { counts[v.trim()] = (counts[v.trim()] ?? 0) + 1; });
            fieldSummary[fieldName] = Object.entries(counts).map(([v, c]) => `${v}: ${c}`).join(', ');
          } else {
            const nums = vals.map(v => parseInt(v)).filter(n => !isNaN(n));
            if (nums.length) {
              const ageCounts: Record<number, number> = {};
              nums.forEach(n => { ageCounts[n] = (ageCounts[n] ?? 0) + 1; });
              const distStr = Object.entries(ageCounts)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([age, count]) => `${age}→${count}`)
                .join(', ');
              const prom = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
              fieldSummary[fieldName] = `Distribución: ${distStr} | min ${Math.min(...nums)}, max ${Math.max(...nums)}, prom ${prom}`;
            }
          }
        } else {
          const counts: Record<string, number> = {};
          vals.forEach(v => { counts[v.trim()] = (counts[v.trim()] ?? 0) + 1; });
          fieldSummary[fieldName] = Object.entries(counts).map(([v, c]) => `${v}: ${c}`).join(', ');
        }
      }
      // Include NSE distribution in summary so AI knows the breakdown
      const nseDist = groupDistributions[groupName]?.nseCalc;
      if (nseDist) {
        fieldSummary['NSE (estimado AMAI)'] = nseDist.items.map(i => `${i.label}: ${i.count}`).join(', ');
      }
      // Sample other fields
      const otherFields = Object.keys(gRows[0] ?? {}).filter(f =>
        !Object.values(detectedFields).includes(f) && !SYSTEM_COLS.has(f)
      ).slice(0, 3);
      for (const f of otherFields) {
        const counts: Record<string, number> = {};
        gRows.forEach(r => { if (r[f]) counts[r[f].trim()] = (counts[r[f].trim()] ?? 0) + 1; });
        if (Object.keys(counts).length) fieldSummary[f] = Object.entries(counts).map(([v, c]) => `${v}: ${c}`).join(', ');
      }
      return { grupo: groupName, total, resumen: fieldSummary };
    });

    const userPrompt = `${criteriosText}${criteriosDeEvaluacion}

RESUMEN POR GRUPO (${groupSummaries.length} grupos, ${participantData.length} participantes):
${JSON.stringify(groupSummaries, null, 1)}

${muestraImagen ? 'IMPORTANTE: Lee la imagen adjunta para obtener los criterios completos.\n' : ''}
━━━ INSTRUCCIONES ━━━

Para CADA grupo genera un scorecard de cumplimiento. Devuelve TODOS los grupos.

REGLAS:
- criteria: incluye TODOS los criterios verificables aunque cumplan (vigilancia continua)
- Sé específico con números en "actual": "100% Mujer (8/8)", "Rango 29-45, promedio 34.5"
- Si no cumple, incluye "action" con sugerencia accionable y numérica
- NO incluyas "distribution" — las gráficas se calculan por separado con datos reales
- Para EDAD: verifica que haya dispersión a lo largo de todo el rango requerido. El campo Edad llega como "Distribución: 18→1, 19→3, 21→2..." — úsalo para evaluar balance real. Si más del 40% de participantes tienen la misma edad exacta, marca como "revisar" e indica la concentración (ej: "⚠ 3/8 tienen 19 años, falta distribución uniforme")
- STATUS: "cumple" solo si TODOS los criteria son cumple
- overallStatus = el PEOR status individual

━━━ FORMATO JSON ━━━
{
  "groups": [
    {
      "groupName": "nombre simplificado (conserva Lovers/Rejectors/NSE/edad/etc.)",
      "totalParticipants": número,
      "requiredParticipants": número o null,
      "criteria": [
        { "criterion": "Género", "expected": "Mujer", "actual": "100% Mujer (8/8)", "status": "cumple" },
        { "criterion": "Rango de edad", "expected": "25-45 años", "actual": "Rango 27-42, promedio 33 años", "status": "cumple" },
        { "criterion": "NSE", "expected": "C+ o superior", "actual": "60% C+, 30% C (90% cumple)", "status": "cumple" },
        { "criterion": "Participantes requeridos", "expected": "6", "actual": "8 reclutados", "status": "cumple" }
      ],
      "alerts": [],
      "status": "cumple",
      "complianceNote": "Una línea sobre el estado general"
    }
  ],
  "globalSummary": "globalSummary debe ser un RESUMEN ULTRA BREVE de cuotas por grupo, formato: 'Grupo X: 6/8 ✓ | Grupo Y: 3/6 ⚠ faltan 3 mujeres | Grupo Z: 5/5 ✓'. Solo una línea por grupo con reclutados/requeridos y si algo no cumple. Máximo 2 líneas totales. NO repitas criterios individuales..",
  "overallStatus": "cumple" | "revisar" | "no_cumple"
}`;

    let aiResult: {
      groups: Array<{
        groupName: string; totalParticipants: number; requiredParticipants: number | null;
        criteria: Array<{ criterion: string; expected: string; actual: string; status: 'cumple' | 'revisar' | 'no_cumple'; action?: string }>;
        alerts: string[]; status: 'cumple' | 'revisar' | 'no_cumple'; complianceNote: string;
      }>;
      globalSummary: string; overallStatus: 'cumple' | 'revisar' | 'no_cumple';
    };

    try {
      const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [
        { type: 'text', text: userPrompt },
      ];
      if (muestraImagen) userContent.push({ type: 'image_url', image_url: { url: muestraImagen, detail: 'high' } });

      const completion = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Eres un experto en análisis de reclutamiento para investigación de mercados. Responde ÚNICAMENTE con JSON válido, sin markdown.' },
          { role: 'user', content: userContent as any },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 16384,
      });
      aiResult = JSON.parse(completion.choices[0].message.content ?? '{}');
    } catch {
      aiResult = { groups: [], globalSummary: 'No se pudo generar el análisis. Intenta nuevamente.', overallStatus: 'revisar' };
    }

    // ── Merge AI criteria with pre-computed distributions ─────────────────────

    const parsedGroups = (aiResult.groups ?? []).map(g => {
      const dists = matchGroupDist(g.groupName ?? '');

      const criteria = (g.criteria ?? []).map(c => {
        const distribution = dists ? matchCriterionDist(c.criterion ?? '', dists) : undefined;
        return {
          criterion: c.criterion ?? '',
          expected: c.expected ?? '',
          actual: c.actual ?? '',
          status: (['cumple', 'revisar', 'no_cumple'].includes(c.status) ? c.status : 'revisar') as 'cumple' | 'revisar' | 'no_cumple',
          ...(c.action ? { action: c.action } : {}),
          ...(distribution ? { distribution } : {}),
        };
      });

      return {
        groupName: g.groupName ?? 'Sin nombre',
        totalParticipants: g.totalParticipants ?? 0,
        requiredParticipants: g.requiredParticipants ?? null,
        criteria,
        alerts: g.alerts ?? [],
        status: (g.status ?? 'revisar') as 'cumple' | 'revisar' | 'no_cumple',
        complianceNote: g.complianceNote ?? '',
        participants: matchParticipants(g.groupName ?? ''),
      };
    });

    const generatedAt = new Date().toISOString();

    const result = {
      muestra: muestra || (muestraImagen ? '(criterios en imagen)' : 'Sin criterios definidos'),
      groups: parsedGroups,
      globalDistributions,
      globalSummary: aiResult.globalSummary ?? '',
      overallStatus: (aiResult.overallStatus ?? 'revisar') as 'cumple' | 'revisar' | 'no_cumple',
      totalParticipants: participantData.length,
      generatedAt,
    };

    // Persist result to DB (fire-and-forget — don't block the response)
    if (project?.id) {
      try {
        const existingJson = project.lastAnalysisJson ? JSON.parse(project.lastAnalysisJson) : {};
        existingJson[boardName] = result;
        await Projects.update({
          id: project.id,
          record: {
            lastAnalysisJson: JSON.stringify(existingJson),
            lastAnalysisAt: generatedAt,
          },
        });
      } catch {
        // Non-fatal — don't surface save errors to the user
      }
    }

    return result;
  },
});
