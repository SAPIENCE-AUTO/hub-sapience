import { Projects, Boards, BoardColumns, CellValues, RecruitmentRows, pool } from '../../server/compat';

// Mismos patrones que analyzeRecruitmentStatus.ts (FIELD_PATTERNS) — el
// naming de columnas de Reclutamiento varía por proyecto, así que detectar
// por regex en vez de un nombre fijo es la única forma que funciona en
// datos reales. Se deja fuera "brand" (no aplica a este dashboard).
const FIELD_PATTERNS = {
  genero: /g[eé]nero|sexo/i,
  edad: /^edad$|rango.{0,10}edad|edad.{0,10}rango|^edad\b/i,
  region: /regi[oó]n|ciudad|estado|zona|localidad/i,
  nse: /^nse$|nivel.{0,10}socio.?econ/i,
} as const;

type Campo = keyof typeof FIELD_PATTERNS;

export interface Perfil { genero?: string; edad?: string; nse?: string; region?: string }

/** "25" -> "25-34". Ya viene como rango de texto ("25 a 34 años") -> se deja tal cual. */
function bucketEdad(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (/ a |años|\d+\s*-\s*\d+/i.test(v)) return v;
  const n = parseInt(v, 10);
  if (isNaN(n)) return v;
  if (n < 18) return '<18';
  if (n <= 24) return '18-24';
  if (n <= 34) return '25-34';
  if (n <= 44) return '35-44';
  if (n <= 54) return '45-54';
  if (n <= 64) return '55-64';
  return '65+';
}

/**
 * Perfil (género/edad/NSE/región) de cada participante de un estudio,
 * jalado de su fila original de Reclutamiento (prework_asignaciones.
 * recruitment_row_id) — no se vuelve a capturar nada, se reusa lo que ya
 * existe. "Best effort": un participante agregado a mano (sin
 * recruitment_row_id) o cuyo tablero no tenga esas columnas simplemente no
 * aparece en el mapa devuelto.
 */
export async function getPerfilesParticipantes(estudioId: string): Promise<Map<string, Perfil>> {
  const resultado = new Map<string, Perfil>();

  const { rows: asignaciones } = await pool.query<{ participante_id: string; recruitment_row_id: string }>(
    `select prework_participante_id as participante_id, recruitment_row_id
     from prework_asignaciones
     where prework_estudio_id = $1 and recruitment_row_id is not null`,
    [estudioId],
  );
  if (asignaciones.length === 0) return resultado;

  // Map de uno-a-MUCHOS a propósito: nada impide que dos participantes de
  // Prework terminen ligados a la misma fila de Reclutamiento (invitación
  // duplicada, fila reusada) — con un Map uno-a-uno el segundo pisaba al
  // primero y su perfil se perdía en silencio.
  const rowIdToParticipantes = new Map<string, string[]>();
  for (const a of asignaciones) {
    if (!rowIdToParticipantes.has(a.recruitment_row_id)) rowIdToParticipantes.set(a.recruitment_row_id, []);
    rowIdToParticipantes.get(a.recruitment_row_id)!.push(a.participante_id);
  }
  const rowIds = [...rowIdToParticipantes.keys()];

  const { records: rows } = await RecruitmentRows.findAll({
    filters: { id: { in: rowIds } } as any, limit: rowIds.length, fields: ['boardId', 'deletedAt'],
  });
  const rowsByBoard = new Map<string, string[]>();
  for (const r of rows) {
    if (r.deletedAt || !r.boardId) continue;
    if (!rowsByBoard.has(r.boardId)) rowsByBoard.set(r.boardId, []);
    rowsByBoard.get(r.boardId)!.push(r.id);
  }
  if (rowsByBoard.size === 0) return resultado;

  const { rows: estudioRows } = await pool.query<{ proyecto_id: string }>(
    `select proyecto_id from prework_estudios where id = $1`, [estudioId],
  );
  const proyecto = estudioRows[0] ? await Projects.findOne({ id: estudioRows[0].proyecto_id, fields: ['projectCode'] }) : null;
  const projectCode = (proyecto?.projectCode as string) ?? '';

  const boardIds = [...rowsByBoard.keys()];
  const { records: boards } = await Boards.findAll({
    filters: { id: { in: boardIds } } as any, limit: boardIds.length, fields: ['boardName', 'deletedAt'],
  });
  const boardById = new Map(boards.map(b => [b.id, b]));

  for (const [boardId, boardRowIds] of rowsByBoard) {
    const board = boardById.get(boardId);
    if (!board || board.deletedAt || !board.boardName) continue;
    const boardName = board.boardName as string;
    const candidatos = [boardId, `recruitment-${projectCode}-${boardName}`];

    const colResults = await Promise.all(candidatos.map(bid =>
      BoardColumns.findAll({ filters: { boardId: bid }, limit: 200, fields: ['columnName', 'deletedAt'] })
    ));
    const colNameById = new Map<string, string>();
    for (const { records } of colResults) {
      for (const c of records) if (!c.deletedAt && c.columnName) colNameById.set(c.id, c.columnName as string);
    }

    const colNames = [...colNameById.values()];
    const campoCol: Partial<Record<Campo, string>> = {};
    for (const [campo, pattern] of Object.entries(FIELD_PATTERNS) as [Campo, RegExp][]) {
      const match = colNames.find(n => pattern.test(n));
      if (match) campoCol[campo] = match;
    }
    if (Object.keys(campoCol).length === 0) continue;

    const cellResults = await Promise.all(candidatos.map(bid =>
      CellValues.findAll({
        filters: { boardId: bid, rowId: { in: boardRowIds } } as any,
        limit: boardRowIds.length * 30, fields: ['rowId', 'columnId', 'textValue', 'deletedAt'],
      })
    ));

    const valoresPorFila = new Map<string, Record<string, string>>();
    for (const { records } of cellResults) {
      for (const cell of records) {
        if (cell.deletedAt || !cell.rowId || !cell.columnId || !cell.textValue) continue;
        const colName = colNameById.get(cell.columnId);
        if (!colName) continue;
        if (!valoresPorFila.has(cell.rowId)) valoresPorFila.set(cell.rowId, {});
        valoresPorFila.get(cell.rowId)![colName] = cell.textValue;
      }
    }

    for (const rowId of boardRowIds) {
      const participanteIds = rowIdToParticipantes.get(rowId);
      const valores = participanteIds ? valoresPorFila.get(rowId) : undefined;
      if (!participanteIds || !valores) continue;

      const perfil: Perfil = {};
      if (campoCol.genero && valores[campoCol.genero]) perfil.genero = valores[campoCol.genero].trim();
      if (campoCol.edad && valores[campoCol.edad]) perfil.edad = bucketEdad(valores[campoCol.edad]);
      if (campoCol.nse && valores[campoCol.nse]) perfil.nse = valores[campoCol.nse].trim();
      if (campoCol.region && valores[campoCol.region]) perfil.region = valores[campoCol.region].trim();
      if (Object.keys(perfil).length === 0) continue;
      for (const participanteId of participanteIds) resultado.set(participanteId, perfil);
    }
  }

  return resultado;
}
