import { Boards, type BoardsRecordType } from '../../server/compat';

// ── Types ────────────────────────────────────────────────────────────────────

type BoardSuffix = '::groups' | '::children' | '';

export type ResolvedBoard = {
  /** UUID real (o legacy si no se pudo resolver) + suffix si aplica */
  boardId: string;
  /** UUID real (o legacy) sin suffix */
  baseBoardId: string;
  /** Compuesto legacy con suffix (ej: pm-PJT-001-Timeline::groups) */
  legacyCompositeId: string;
  /** Compuesto legacy sin suffix */
  legacyBaseId: string;
  /** Nombre del board */
  boardName: string;
  /** Código del proyecto */
  projectCode: string;
  /** Tipo del board: pm, calendar, recruitment, etc. */
  boardType: string;
  /** Sufijo extraído: ::groups, ::children, o vacío */
  suffix: BoardSuffix;
  /** true si el input era un compuesto legacy (no UUID) */
  isLegacy: boolean;
  /** true si fallbackToLegacy se usó y no se encontró Board activo */
  unresolvedLegacy?: boolean;
  /**
   * true si es un board virtual events-.
   * events- NO existe en la tabla Boards, no se migra a UUID,
   * y se conserva como legacy permanentemente.
   */
  isVirtualEventsBoard?: boolean;
  /** El registro Board real. null para events- virtuales o legacy sin resolver */
  board: BoardsRecordType | null;
};

export type ResolveBoardIdOptions = {
  /** El boardId o key compuesto a resolver */
  boardIdOrKey: string;
  /** ProjectCode — ayuda a parsear compuestos sin ambigüedad */
  projectCode?: string;
  /** BoardName — para búsqueda directa si ya se conoce */
  boardName?: string;
  /**
   * Si true, cuando no encuentre un Board activo retorna el legacy id
   * en vez de lanzar error. Útil para endpoints de lectura durante la transición.
   * Default: false (estricto).
   */
  fallbackToLegacy?: boolean;
};

// ── Constants ────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ordered longest-prefix-first so recruitment- is tested before a hypothetical "re-" prefix */
const KNOWN_PREFIXES = [
  { prefix: 'recruitment-', boardType: 'recruitment' },
  { prefix: 'cal-',         boardType: 'calendar' },
  { prefix: 'events-',      boardType: 'events' },
  { prefix: 'pm-',          boardType: 'pm' },
] as const;

const SUFFIXES: BoardSuffix[] = ['::groups', '::children'];

const DEBUG = typeof process !== 'undefined'
  && process.env?.DEBUG_BOARD_RESOLUTION === 'true';

// ── Internal helpers ─────────────────────────────────────────────────────────

function extractSuffix(input: string): { base: string; suffix: BoardSuffix } {
  for (const s of SUFFIXES) {
    if (input.endsWith(s)) {
      return { base: input.slice(0, -s.length), suffix: s };
    }
  }
  return { base: input, suffix: '' };
}

function detectPrefix(base: string): { prefix: string; boardType: string; rest: string } | null {
  for (const p of KNOWN_PREFIXES) {
    if (base.startsWith(p.prefix)) {
      return { prefix: p.prefix, boardType: p.boardType, rest: base.slice(p.prefix.length) };
    }
  }
  return null;
}

/**
 * Extrae boardName del "rest" (lo que queda después del prefix) cuando
 * se conoce el projectCode. No usa split por guiones — quita el projectCode
 * del inicio y lo que sobra es el boardName.
 *
 * Ej: rest = "PJT-001-Timeline CDMX - Ola 1", projectCode = "PJT-001"
 *   → boardName = "Timeline CDMX - Ola 1"
 *
 * Ej: rest = "PJT-001" (sin boardName), projectCode = "PJT-001"
 *   → boardName = ""
 */
function extractBoardName(rest: string, projectCode: string): string {
  if (rest === projectCode) return '';
  const expectedPrefix = `${projectCode}-`;
  if (rest.startsWith(expectedPrefix)) {
    return rest.slice(expectedPrefix.length);
  }
  return rest;
}

/**
 * Construye el legacy composite boardId.
 * `prefixType` es el tipo lógico derivado del PREFIJO del input (pm, calendar,
 * recruitment), NO del boardType almacenado en el registro Board (que puede
 * estar vacío en boards legacy).
 */
function buildLegacyComposite(prefixType: string, projectCode: string, boardName: string): string {
  const prefix = prefixType === 'calendar' ? 'cal-'
    : prefixType === 'recruitment' ? 'recruitment-'
    : prefixType === 'events' ? 'events-'
    : 'pm-';
  return boardName ? `${prefix}${projectCode}-${boardName}` : `${prefix}${projectCode}`;
}

/**
 * Dado un array de Boards activos, elige el mejor match según boardType.
 * Prioridad:
 *   1. boardType coincide exactamente con el prefixType detectado
 *   2. boardType está vacío (legacy — acepta cualquier prefijo)
 *   3. primer registro activo disponible (último fallback)
 */
function pickBestBoard(
  activeRecords: BoardsRecordType[],
  prefixType: string,
): BoardsRecordType | undefined {
  if (activeRecords.length === 0) return undefined;
  if (activeRecords.length === 1) return activeRecords[0];

  // Map prefix type to the DB boardType value used for exact match
  const dbTypeForPrefix: Record<string, string> = {
    pm: 'pm',
    calendar: 'calendar',
    recruitment: 'recruitment',
  };
  const exactType = dbTypeForPrefix[prefixType];

  // 1. Exact boardType match
  if (exactType) {
    const exact = activeRecords.find(b => b.boardType === exactType);
    if (exact) return exact;
  }

  // 2. Empty boardType fallback (legacy boards)
  const emptyType = activeRecords.find(b => !b.boardType || b.boardType === '');
  if (emptyType) return emptyType;

  // 3. Last resort
  return activeRecords[0];
}

function makeUnresolvedResult(
  boardIdOrKey: string, base: string, suffix: BoardSuffix,
  boardName: string, projectCode: string, boardType: string,
): ResolvedBoard {
  return {
    boardId: boardIdOrKey,
    baseBoardId: base,
    legacyCompositeId: boardIdOrKey,
    legacyBaseId: base,
    boardName,
    projectCode,
    boardType,
    suffix,
    isLegacy: true,
    unresolvedLegacy: true,
    board: null,
  };
}

// ── LookupBoardUUID ──────────────────────────────────────────────────────────
//
// Use when the endpoint already knows projectCode + boardName + boardType.
// Never throws — returns { found: false, reason } when no active board matches.

export type LookupResult = {
  /** UUID del board activo, presente solo si found === true */
  uuid?: string;
  /** Legacy composite ID (ej: recruitment-PJT-001-Filtro) */
  legacyId: string;
  /** true si se encontró un Board activo que matchea */
  found: boolean;
  /** El registro Board completo, presente solo si found === true */
  board?: BoardsRecordType;
  /** Razón legible cuando found === false */
  reason?: string;
};

export async function lookupBoardUUID(
  projectCode: string,
  boardName: string,
  boardType: string,
): Promise<LookupResult> {
  const legacyId = buildLegacyComposite(boardType, projectCode, boardName);

  try {
    const filters: Record<string, string> = { projectCode };
    if (boardName) filters.boardName = boardName;

    const { records } = await Boards.findAll({ filters: filters as any, limit: 10 });
    const activeRecords = records.filter(b => !b.deletedAt);

    if (activeRecords.length === 0) {
      if (DEBUG) console.log('[lookupBoardUUID] No active board found', { projectCode, boardName, boardType });
      return { legacyId, found: false, reason: `No active board for projectCode="${projectCode}", boardName="${boardName}", boardType="${boardType}"` };
    }

    const best = pickBestBoard(activeRecords, boardType);
    if (!best) {
      return { legacyId, found: false, reason: `pickBestBoard returned undefined for ${activeRecords.length} candidates` };
    }

    if (DEBUG) console.log('[lookupBoardUUID] resolved', { projectCode, boardName, boardType, uuid: best.id });

    return { uuid: best.id, legacyId, found: true, board: best };
  } catch (err) {
    // Never throw — surface the error as a reason
    if (DEBUG) console.log('[lookupBoardUUID] error (returning found:false)', String(err));
    return { legacyId, found: false, reason: `Lookup error: ${String(err)}` };
  }
}

// ── Main function ────────────────────────────────────────────────────────────

export async function resolveBoardId(opts: ResolveBoardIdOptions): Promise<ResolvedBoard> {
  const { boardIdOrKey, projectCode, boardName: explicitBoardName, fallbackToLegacy = false } = opts;

  // 1. Extract suffix (::groups, ::children)
  const { base, suffix } = extractSuffix(boardIdOrKey);

  // 2. Is it a UUID?
  const isUuid = UUID_RE.test(base);

  // ── UUID path ──────────────────────────────────────────────────────────────
  if (isUuid) {
    const board = await Boards.findOne({ id: base });

    if (!board || board.deletedAt) {
      if (fallbackToLegacy) {
        if (DEBUG) console.log('[resolveBoardId] UUID not found, fallback', { base, suffix });
        return makeUnresolvedResult(boardIdOrKey, base, suffix, explicitBoardName ?? '', projectCode ?? '', '');
      }
      throw new Error(`Board not found or deleted: ${base}`);
    }

    const bName = board.boardName ?? '';
    const pCode = board.projectCode ?? '';
    const bType = board.boardType ?? 'pm';
    const legacyBase = buildLegacyComposite(bType, pCode, bName);

    if (DEBUG) console.log('[resolveBoardId] resolved UUID', { base, bName, pCode, bType, suffix });

    return {
      boardId: suffix ? `${board.id}${suffix}` : board.id,
      baseBoardId: board.id,
      legacyCompositeId: suffix ? `${legacyBase}${suffix}` : legacyBase,
      legacyBaseId: legacyBase,
      boardName: bName,
      projectCode: pCode,
      boardType: bType,
      suffix,
      isLegacy: false,
      board,
    };
  }

  // ── Legacy composite path ──────────────────────────────────────────────────

  const detected = detectPrefix(base);

  // 3. Handle events- virtual boards.
  //    ┌─────────────────────────────────────────────────────────────────────┐
  //    │ events- is a VIRTUAL prefix. There is NO record in the Boards      │
  //    │ table for events boards. This prefix is NOT migrated to UUID and   │
  //    │ is kept as legacy permanently. The boardId for events is always    │
  //    │ `events-{projectCode}` (no boardName segment).                    │
  //    └─────────────────────────────────────────────────────────────────────┘
  if (detected?.boardType === 'events') {
    const pCode = projectCode ?? detected.rest;
    const legacyBase = `events-${pCode}`;

    if (DEBUG) console.log('[resolveBoardId] virtual events board (permanent legacy)', { pCode, suffix });

    return {
      boardId: suffix ? `${legacyBase}${suffix}` : legacyBase,
      baseBoardId: legacyBase,
      legacyCompositeId: suffix ? `${legacyBase}${suffix}` : legacyBase,
      legacyBaseId: legacyBase,
      boardName: '',
      projectCode: pCode,
      boardType: 'events',
      suffix,
      isLegacy: true,
      isVirtualEventsBoard: true,
      board: null,
    };
  }

  // 4. Parse composite — extract boardName and projectCode
  let resolvedBoardName = explicitBoardName ?? '';
  let resolvedProjectCode = projectCode ?? '';
  const resolvedPrefixType = detected?.boardType ?? 'pm';

  if (detected && projectCode) {
    // We have the prefix and the projectCode — safe extraction
    resolvedBoardName = explicitBoardName ?? extractBoardName(detected.rest, projectCode);
    resolvedProjectCode = projectCode;
  } else if (detected && !projectCode) {
    // No projectCode provided — must search Boards table to disambiguate.
    //
    // IMPORTANT: Use `resolvedPrefixType` (derived from the INPUT string's prefix)
    // to build the comparison composite, NOT `b.boardType` from the DB record.
    // Reason: ~27% of boards have empty boardType. If the input is
    // `cal-PJT-001-Timeline` and the Board has boardType='', using b.boardType
    // would generate `pm-PJT-001-Timeline` which would never match the input.
    const { records } = await Boards.findAll({ limit: 500 });
    const activeBoards = records.filter(b => !b.deletedAt);

    const match = activeBoards.find(b => {
      const composite = buildLegacyComposite(
        resolvedPrefixType, // ← always use the prefix from the input, not b.boardType
        b.projectCode ?? '',
        b.boardName ?? '',
      );
      return composite === base;
    });

    if (match) {
      resolvedBoardName = match.boardName ?? '';
      resolvedProjectCode = match.projectCode ?? '';
    } else if (!fallbackToLegacy) {
      throw new Error(`Board not found for legacy composite: ${base}`);
    } else {
      if (DEBUG) console.log('[resolveBoardId] unresolved legacy (no projectCode)', { base, suffix });
      return makeUnresolvedResult(boardIdOrKey, base, suffix, '', '', resolvedPrefixType);
    }
  }

  // 5. Look up the active Board by boardName + projectCode.
  //    When multiple active Boards match (same name, same project), use
  //    pickBestBoard to prefer the one whose boardType matches the detected prefix.
  if (resolvedBoardName || resolvedProjectCode) {
    const filters: Record<string, string> = {};
    if (resolvedBoardName) filters.boardName = resolvedBoardName;
    if (resolvedProjectCode) filters.projectCode = resolvedProjectCode;

    const { records } = await Boards.findAll({ filters: filters as any, limit: 10 });
    const activeRecords = records.filter(b => !b.deletedAt);

    const activeBoard = pickBestBoard(activeRecords, resolvedPrefixType);

    if (activeBoard) {
      // Use the prefix type for legacy composite (not the possibly-empty db boardType)
      const legacyBase = buildLegacyComposite(
        resolvedPrefixType,
        activeBoard.projectCode ?? '',
        activeBoard.boardName ?? '',
      );

      if (DEBUG) console.log('[resolveBoardId] resolved legacy → UUID', {
        legacy: base, uuid: activeBoard.id, suffix,
        dbBoardType: activeBoard.boardType, prefixType: resolvedPrefixType,
      });

      return {
        boardId: suffix ? `${activeBoard.id}${suffix}` : activeBoard.id,
        baseBoardId: activeBoard.id,
        legacyCompositeId: suffix ? `${legacyBase}${suffix}` : legacyBase,
        legacyBaseId: legacyBase,
        boardName: activeBoard.boardName ?? '',
        projectCode: activeBoard.projectCode ?? '',
        boardType: activeBoard.boardType || resolvedPrefixType,
        suffix,
        isLegacy: true,
        board: activeBoard,
      };
    }
  }

  // 6. No active Board found
  if (fallbackToLegacy) {
    if (DEBUG) console.log('[resolveBoardId] unresolved legacy fallback', { base, suffix });
    return makeUnresolvedResult(boardIdOrKey, base, suffix, resolvedBoardName, resolvedProjectCode, resolvedPrefixType);
  }

  throw new Error(`Board not found: ${base} (boardName=${resolvedBoardName}, projectCode=${resolvedProjectCode})`);
}
