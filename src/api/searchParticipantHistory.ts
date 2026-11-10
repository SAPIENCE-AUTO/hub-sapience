import { z } from 'zod';
import { createEndpoint, RecruitmentRows, Projects } from '../../server/compat';
import {
  buildIdentityClusters, findClusterForRow, aggregateClusterReasons,
  resolveSignals, DuplicateSignalEnum, Signal, IdentityRow, participoEnProyecto,
} from '../lib/duplicateIdentity';
import { getGlobalIdentityData } from '../lib/globalIdentityCache';
import { getInferredStartDates } from '../lib/projectStartFallback';
import { respuestaDe, respuestasEnTablero } from '../lib/respuestaFillout';

const normalizeClient = (s?: string) => (s ?? '').toLowerCase().trim();

const STATUS_PRIORITY = ['Asistió', 'Confirmado', 'Contactado', 'Pendiente', 'Descartado', 'No show'];

// ── History entry shape ─────────────────────────────────────────────────────
// Un tablero (proyecto + nombre) donde está la misma respuesta de Fillout; ver respuestaFillout.ts.
const LugarSchema = z.object({ projectCode: z.string(), boardName: z.string().optional() });

const HistoryEntrySchema = z.object({
  rowId:            z.string().optional(),
  projectCode:      z.string(),
  boardName:        z.string().optional(),
  group:            z.string().optional(),
  status:           z.string().optional(),
  sourceForm:       z.string().optional(),
  participated:     z.boolean(),
  sameProject:      z.boolean(),
  sameBoard:        z.boolean(),
  isCurrentRow:     z.boolean(),
  clientName:       z.string().optional(),
  projectStartDate: z.string().optional(),
  sameClient:       z.boolean(),
  isRecent:         z.boolean(),
  warningLevel:     z.enum(['same_client', 'recent', 'old', 'same_board']).nullable(),
  /** Otros tableros donde está copiada esta misma respuesta de Fillout (no son otras veces que llenó el filtro). */
  tambienEn:        z.array(LugarSchema).optional(),
});

type EntryShape = z.infer<typeof HistoryEntrySchema>;

const ResultSchema = z.object({
  id:                   z.string(),
  fullName:             z.string().optional(),
  email:                z.string().optional(),
  phone:                z.string().optional(),
  matchedBy:            z.array(z.string()),
  signals:              z.array(DuplicateSignalEnum),
  primaryBadge:         DuplicateSignalEnum.nullable(),
  secondaryBadges:      z.array(DuplicateSignalEnum),
  sameBoardCount:       z.number(),
  hasHighRisk:          z.boolean(),
  hasInternalDuplicate: z.boolean(),
  identityClusterId:    z.string(),
  identityMatchReasons: z.array(z.enum(['email', 'name', 'phone'])),
  history:              z.array(HistoryEntrySchema),
  /** Tableros de OTROS proyectos donde está copiada una respuesta que la persona ya tiene en el tablero que se está viendo: no cuentan como apariciones. */
  mismaRespuestaEn:     z.array(LugarSchema).optional(),
});

// ── Shared: build history + signals from a set of rows ──────────────────────
function buildPersonResult(
  personRows: IdentityRow[],
  opts: {
    projectCode?: string;
    boardName?: string;
    rowId?: string;
    currentClientNorm: string;
    referenceDate: Date;
    sixMonthsAgo: Date;
    projectMap: Map<string, { client?: string; startDate?: string; startDateInferred?: boolean }>;
    clusterId: string;
    clusterReasons: ('email' | 'name' | 'phone')[];
    matchedBy: string[];
  },
) {
  const { projectCode, boardName, rowId, currentClientNorm, referenceDate, sixMonthsAgo, projectMap } = opts;

  let fullName: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;
  for (const r of personRows) {
    if (!fullName && r.participantName) fullName = r.participantName;
    if (!email    && r.email)           email    = r.email;
    if (!phone    && r.phone)           phone    = r.phone;
  }

  const sameBoardEntries: EntryShape[] = [];
  const crossBoardMap = new Map<string, EntryShape>();
  const claveTablero = (row: IdentityRow) => `${row.projectCode}||${row.boardName ?? ''}`;

  // Una fila de otro tablero entra al mapa por tablero; si ya había una de ese tablero se fusionan (el mejor estatus, la peor alerta).
  const agregarCruzada = (row: IdentityRow, entry: EntryShape) => {
    const boardKey = claveTablero(row);
    const existing = crossBoardMap.get(boardKey);
    if (!existing) {
      crossBoardMap.set(boardKey, entry);
      return;
    }
    const curIdx  = STATUS_PRIORITY.indexOf(row.status ?? '');
    const prevIdx = STATUS_PRIORITY.indexOf(existing.status ?? '');
    const betterStatus = (curIdx !== -1 && (prevIdx === -1 || curIdx < prevIdx)) ? row.status : existing.status;
    const levelRank = (l: EntryShape['warningLevel']) =>
      l === 'same_client' ? 4 : l === 'recent' ? 3 : l === 'old' ? 2 : l === 'same_board' ? 1 : 0;
    const worstWarning = levelRank(entry.warningLevel) >= levelRank(existing.warningLevel)
      ? entry.warningLevel : existing.warningLevel;
    const finalParticipated = worstWarning === 'same_client' || worstWarning === 'recent';
    crossBoardMap.set(boardKey, {
      ...existing,
      status: betterStatus,
      group: existing.group || row.group,
      sourceForm: existing.sourceForm || row.sourceForm,
      participated: finalParticipated,
      warningLevel: worstWarning,
      sameClient: existing.sameClient || entry.sameClient,
    });
  };

  // Un mismo formulario vinculado a varios tableros copia cada respuesta a todos ellos: esas copias son UNA vez que la persona llenó el filtro,
  // no «otros formularios» (ver respuestaFillout.ts). Las copias en otros proyectos donde no participó se agrupan por respuesta y, más abajo,
  // o van a la nota «misma respuesta en…» (si la persona ya tiene esa respuesta en este tablero) o quedan en una sola entrada.
  const respuestasAqui = respuestasEnTablero(personRows, projectCode, boardName);
  const copias = new Map<string, { row: IdentityRow; entry: EntryShape }[]>();

  for (const row of personRows) {
    if (!row.projectCode) continue;

    const rawParticipated = participoEnProyecto(row);
    const sameProject     = !!projectCode && row.projectCode === projectCode;
    const sameBoard       = sameProject && !!boardName && row.boardName === boardName;
    const isCurrentRow    = !!rowId && row.id === rowId;

    const projData         = projectMap.get(row.projectCode) ?? {};
    const clientName       = projData.client;
    const projectStartDate = projData.startDate;

    const otherStartDate  = projectStartDate ? new Date(projectStartDate) : null;
    const isFutureProject = !sameProject && !sameBoard && !!otherStartDate && otherStartDate > referenceDate;
    const isRecent        = !projectStartDate || new Date(projectStartDate) > sixMonthsAgo;

    const sameClient = !isFutureProject && !sameBoard && !sameProject && !!currentClientNorm &&
      !!clientName && normalizeClient(clientName) === currentClientNorm;

    let participated: boolean;
    let warningLevel: EntryShape['warningLevel'];

    if (isFutureProject) {
      participated = false; warningLevel = null;
    } else if (sameBoard) {
      participated = false; warningLevel = 'same_board';
    } else if (sameClient && rawParticipated) {
      participated = true; warningLevel = 'same_client';
    } else if (!sameProject && rawParticipated && isRecent) {
      participated = true; warningLevel = 'recent';
    } else if (!sameProject && rawParticipated && !isRecent) {
      participated = false; warningLevel = 'old';
    } else {
      participated = false; warningLevel = null;
    }

    const entry: EntryShape = {
      rowId: row.id, projectCode: row.projectCode, boardName: row.boardName,
      group: row.group, status: row.status, sourceForm: row.sourceForm,
      participated, sameProject, sameBoard, isCurrentRow,
      clientName, projectStartDate, sameClient, isRecent, warningLevel,
    };

    if (sameBoard) {
      sameBoardEntries.push(entry);
      continue;
    }

    // Copia de una respuesta de Fillout en OTRO proyecto, sin haber participado ahí: se resuelve después del ciclo. Si participó con esa copia
    // es historial real y entra como siempre; y las copias en otro tablero del MISMO proyecto también se muestran como siempre.
    const respuesta = respuestaDe(row);
    if (!sameProject && respuesta && !rawParticipated) {
      const grupo = copias.get(respuesta);
      if (grupo) grupo.push({ row, entry }); else copias.set(respuesta, [{ row, entry }]);
      continue;
    }
    agregarCruzada(row, entry);
  }

  const lugarDe = (row: IdentityRow) => ({ projectCode: row.projectCode as string, boardName: row.boardName });
  const sinRepetir = (filas: IdentityRow[]) => {
    const vistos = new Set<string>();
    return filas.filter(f => { const k = claveTablero(f); if (vistos.has(k)) return false; vistos.add(k); return true; }).map(lugarDe);
  };
  const mismaRespuestaFilas: IdentityRow[] = [];
  for (const [respuesta, grupo] of copias) {
    if (respuestasAqui.has(respuesta)) {
      // La misma respuesta que ya tiene en este tablero: solo una nota, no cuenta como otra aparición ni como «solo registrado».
      for (const { row } of grupo) mismaRespuestaFilas.push(row);
      continue;
    }
    // Una respuesta que solo está en otros proyectos: una sola entrada (la primera) y, de nota, los demás tableros donde está.
    const [primera, ...otras] = grupo;
    agregarCruzada(primera.row, primera.entry);
    const lugares = sinRepetir(otras.map(o => o.row).filter(r => claveTablero(r) !== claveTablero(primera.row)));
    if (lugares.length > 0) {
      const e = crossBoardMap.get(claveTablero(primera.row))!;
      e.tambienEn = [...(e.tambienEn ?? []), ...lugares];
    }
  }
  const mismaRespuestaEn = sinRepetir(mismaRespuestaFilas);

  sameBoardEntries.sort((a, b) => {
    if (a.isCurrentRow && !b.isCurrentRow) return -1;
    if (!a.isCurrentRow && b.isCurrentRow) return 1;
    return STATUS_PRIORITY.indexOf(a.status ?? '') - STATUS_PRIORITY.indexOf(b.status ?? '');
  });

  const history: EntryShape[] = [...sameBoardEntries, ...[...crossBoardMap.values()]];

  const sameBoardCount = sameBoardEntries.length;
  const signalSet = new Set<Signal>();

  for (const entry of crossBoardMap.values()) {
    if (entry.sameProject) continue;
    if (entry.projectStartDate && new Date(entry.projectStartDate) > referenceDate) continue;

    if (entry.warningLevel === 'same_client')  signalSet.add('same_client');
    else if (entry.warningLevel === 'recent')  signalSet.add('recent');
    else if (entry.warningLevel === 'old')     signalSet.add('old');
    else if (entry.warningLevel === null)      signalSet.add('registered_only');
  }

  if (sameBoardCount > 1) signalSet.add('same_board_duplicate');

  const { signals, primaryBadge, secondaryBadges } = resolveSignals(signalSet);

  return {
    id:                   opts.clusterId,
    fullName,
    email,
    phone,
    matchedBy:            opts.matchedBy,
    signals,
    primaryBadge,
    secondaryBadges,
    sameBoardCount,
    hasHighRisk:          primaryBadge === 'same_client' || primaryBadge === 'recent',
    hasInternalDuplicate: sameBoardCount > 1,
    identityClusterId:    opts.clusterId,
    identityMatchReasons: opts.clusterReasons,
    history,
    mismaRespuestaEn:     mismaRespuestaEn.length > 0 ? mismaRespuestaEn : undefined,
  };
}

// ── Helper: load project metadata ───────────────────────────────────────────
async function loadProjectMap(projectCodes: string[]): Promise<Map<string, { client?: string; startDate?: string; startDateInferred?: boolean }>> {
  const projectMap = new Map<string, { client?: string; startDate?: string; startDateInferred?: boolean }>();
  if (projectCodes.length === 0) return projectMap;
  const { records } = await Projects.findAll({
    filters: { projectCode: { in: [...new Set(projectCodes)] } },
    fields: ['projectCode', 'client', 'startDate'],
    limit: 500,
  });
  for (const p of records) {
    if (p.projectCode) projectMap.set(p.projectCode, { client: p.client, startDate: p.startDate });
  }
  // Proyectos sin fecha de inicio: respaldo con su última actividad real (ver projectStartFallback.ts).
  for (const [code, fecha] of await getInferredStartDates([...projectMap.keys()])) {
    const pd = projectMap.get(code);
    if (pd && !pd.startDate) { pd.startDate = fecha; pd.startDateInferred = true; }
  }
  return projectMap;
}

// ── Endpoint ────────────────────────────────────────────────────────────────

export default createEndpoint({
  authenticated: true,
  description: 'Search participant history — seed mode (canonical, complete) or query mode (exploratory)',
  inputSchema: z.object({
    seedRowId:     z.string().optional(),
    query:         z.string().optional(),
    projectCode:   z.string().optional(),
    boardName:     z.string().optional(),
    rowId:         z.string().optional(),
    currentClient: z.string().optional(),
  }),
  outputSchema: z.object({
    results: z.array(ResultSchema),
  }),

  execute: async ({ input }) => {
    const isSeedMode = !!input.seedRowId;

    // ═══════════════════════════════════════════════════════════════════════
    // SEED MODE — canonical, complete identity resolution
    // ═══════════════════════════════════════════════════════════════════════
    if (isSeedMode) {
      // Comparte cache con getBoardDuplicateBadges.ts (mismo fetch+clustering
      // de todo el sistema) — abrir el tablero ya calienta esto, así que el
      // modal de historial normalmente lo encuentra tibio. Ver globalIdentityCache.ts.
      const { activeRows, projectMap, globalClusters: clusters } = await getGlobalIdentityData();
      if (activeRows.length === 0) return { results: [] };

      const match = findClusterForRow(clusters, input.seedRowId!);
      if (!match) return { results: [] };

      const { clusterId, cluster } = match;
      const rowById = new Map(activeRows.map(r => [r.id, r]));
      const personRows = cluster.rowIds.map(id => rowById.get(id)).filter((r): r is IdentityRow => !!r);

      const currentProjectStartDate = input.projectCode && !projectMap.get(input.projectCode)?.startDateInferred ? projectMap.get(input.projectCode)?.startDate : undefined;
      const referenceDate = currentProjectStartDate ? new Date(currentProjectStartDate) : new Date();
      const sixMonthsAgo = new Date(referenceDate);
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const currentClientNorm = normalizeClient(input.currentClient);

      const clusterReasons = aggregateClusterReasons(cluster);

      const result = buildPersonResult(personRows, {
        projectCode:     input.projectCode,
        boardName:       input.boardName,
        rowId:           input.rowId ?? input.seedRowId,
        currentClientNorm,
        referenceDate,
        sixMonthsAgo,
        projectMap,
        clusterId,
        clusterReasons,
        matchedBy: clusterReasons,
      });

      return { results: [result] };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // QUERY MODE — exploratory search
    // ═══════════════════════════════════════════════════════════════════════
    const q = (input.query ?? '').trim();
    if (q.length < 2) return { results: [] };

    const searchFields = ['id', 'participantName', 'email', 'phone', 'projectCode', 'boardName', 'status', 'group', 'sourceForm', 'deletedAt'];

    const [byName, byEmail, byPhone] = await Promise.all([
      RecruitmentRows.findAll({ filters: { participantName: { contains: q } }, limit: 200, fields: searchFields }),
      RecruitmentRows.findAll({ filters: { email:           { contains: q } }, limit: 200, fields: searchFields }),
      RecruitmentRows.findAll({ filters: { phone:           { contains: q } }, limit: 200, fields: searchFields }),
    ]);

    const matchedByEmailIds = new Set(byEmail.records.map(r => r.id));
    const matchedByNameIds  = new Set(byName.records.map(r => r.id));
    const matchedByPhoneIds = new Set(byPhone.records.map(r => r.id));

    const seen = new Set<string>();
    const allRows: IdentityRow[] = [];
    for (const r of [...byEmail.records, ...byName.records, ...byPhone.records]) {
      if (!seen.has(r.id)) { seen.add(r.id); allRows.push(r); }
    }
    const activeRows = allRows.filter(r => !r.deletedAt);
    if (activeRows.length === 0) return { results: [] };

    // Strict — ver comentario del modo seed arriba.
    const clusters = buildIdentityClusters(activeRows, { mode: 'strict' });

    const rowProjectCodes = activeRows.map(r => r.projectCode).filter(Boolean) as string[];
    if (input.projectCode) rowProjectCodes.push(input.projectCode);
    const projectMap = await loadProjectMap(rowProjectCodes);

    const currentProjectStartDate = input.projectCode && !projectMap.get(input.projectCode)?.startDateInferred ? projectMap.get(input.projectCode)?.startDate : undefined;
    const referenceDate = currentProjectStartDate ? new Date(currentProjectStartDate) : new Date();
    const sixMonthsAgo = new Date(referenceDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const currentClientNorm = normalizeClient(input.currentClient);

    const rowById = new Map(activeRows.map(r => [r.id, r]));

    const results = [...clusters.entries()].slice(0, 10).map(([clusterId, cluster]) => {
      const personRows = cluster.rowIds.map(id => rowById.get(id)).filter((r): r is IdentityRow => !!r);
      if (personRows.length === 0) return null;

      const queryMatchedBy = new Set<string>();
      for (const rid of cluster.rowIds) {
        if (matchedByEmailIds.has(rid)) queryMatchedBy.add('email');
        if (matchedByNameIds.has(rid))  queryMatchedBy.add('name');
        if (matchedByPhoneIds.has(rid)) queryMatchedBy.add('phone');
      }

      const clusterReasons = aggregateClusterReasons(cluster);

      return buildPersonResult(personRows, {
        projectCode:     input.projectCode,
        boardName:       input.boardName,
        rowId:           input.rowId,
        currentClientNorm,
        referenceDate,
        sixMonthsAgo,
        projectMap,
        clusterId,
        clusterReasons,
        matchedBy: [...queryMatchedBy],
      });
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    results.sort((a, b) => b.history.length - a.history.length);

    return { results };
  },
});
