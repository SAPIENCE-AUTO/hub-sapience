import { BoardColumns, CellValues, RecruitmentRows, pool } from '../../../server/compat';
import { publishEvent } from '../../lib/ably';
import { columnas, columnasPorRenombrar, nombreColumnaTablero, nombreLibre, type Columna, type FilaRespuesta } from '../../lib/formularios/tabla';
import type { Definicion } from '../../lib/formularios/tipos';

/**
 * Pasa respuestas de un formulario a un tablero de Reclutamiento: una fila
 * por persona (estado «Pendiente») y una columna por pregunta — el mismo
 * resultado que deja un formulario de Fillout vinculado (filloutNativeWebhook.ts),
 * con las mismas tablas (recruitment_rows, board_columns, cell_values).
 *
 * Las columnas se ubican por su clave estable (lib/formularios/tabla.ts) y el
 * mapa clave → columna se guarda en `formularios.vinculo`, así la misma
 * pregunta cae siempre en la misma columna aunque alguien la renombre en el
 * tablero. Cada respuesta se pasa una sola vez a cada tablero: su fila lleva
 * `source_form = «Formulario Hub · título|id de la respuesta»`. Si se cambia
 * de tablero, el nuevo recibe también a quienes ya estaban en el anterior.
 */

export interface Vinculo {
  boardId: string;
  boardName: string;
  projectCode: string;
  columnas: Record<string, string>;
  /** Clave → nombre que el Hub le puso a la columna la última vez (para renombrar solo las que nadie cambió). */
  nombres?: Record<string, string>;
}

const PREFIJO_ORIGEN = 'Formulario Hub · ';
export const origenRespuesta = (titulo: string, respuestaId: string) => `${PREFIJO_ORIGEN}${titulo}|${respuestaId}`;

/** Ids de respuestas que ya tienen su fila (viva) en este tablero. */
export async function respuestasYaPasadas(ids: string[], boardId: string): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await pool.query(
    `select split_part(source_form, '|', 2) as id
     from recruitment_rows
     where source_form like $1 and split_part(source_form, '|', 2) = any($2::text[])
       and board_id = $3 and (deleted_at is null or deleted_at = '')`,
    [`${PREFIJO_ORIGEN}%`, ids, boardId],
  );
  return new Set(rows.map((r) => r.id as string));
}

/**
 * El vínculo guarda el nombre del tablero, pero el equipo lo puede renombrar o
 * borrar desde Reclutamiento: se relee del tablero antes de usarlo. `null` si
 * ya no existe.
 */
export async function vinculoVigente(vinculo: Vinculo | null): Promise<Vinculo | null> {
  if (!vinculo) return null;
  const { rows: [b] } = await pool.query(
    `select board_name, project_code from boards where id = $1 and board_type = 'recruitment' and deleted_at is null`,
    [vinculo.boardId],
  );
  return b ? { ...vinculo, boardName: b.board_name ?? vinculo.boardName, projectCode: b.project_code ?? vinculo.projectCode } : null;
}

/** Todas las columnas que el screener puede tener en un tablero (nombre y celular van en las columnas base). */
export function columnasParaTablero(def: Definicion): Columna[] {
  return columnas(def, [], { completas: true }).filter((c) => c.clave !== 'nombre' && c.clave !== 'celular');
}

/**
 * Crea en el tablero las columnas que falten (`crear`), en el orden del
 * screener, y renombra las que el Hub dejó con un nombre que ya no es el de su
 * pregunta (columnasPorRenombrar: las que renombró el equipo se respetan).
 * Guarda en el vínculo el mapa clave → columna y los nombres puestos. Las que
 * ya existen (aunque las hayan renombrado) se reusan.
 */
async function ajustarColumnas(
  formularioId: string, vinculo: Vinculo, cols: Columna[], def: Definicion, crear: boolean,
): Promise<{ mapa: Record<string, string>; creadas: number; renombradas: number }> {
  const { records: existentes } = await BoardColumns.findAll({
    filters: { boardId: vinculo.boardId }, limit: 1000, fields: ['id', 'columnName', 'columnType', 'deletedAt'],
  });
  const vivas = existentes.filter((c) => !c.deletedAt);
  const vivasIds = new Set(vivas.map((c) => c.id));
  const mapa: Record<string, string> = { ...vinculo.columnas };
  const puestos: Record<string, string> = { ...vinculo.nombres };

  const renombres = columnasPorRenombrar({
    vivas: vivas.map((c) => ({ id: c.id, nombre: c.columnName ?? '' })), mapa, puestos, cols,
    antes: columnas(def, [], { completas: true, comoAntes: true }),
  });
  for (const r of renombres) {
    await BoardColumns.update({ id: r.id, record: { columnName: r.nombre } });
    puestos[r.clave] = r.nombre;
  }

  const usados = new Set(vivas.map((c) => {
    const r = renombres.find((x) => x.id === c.id);
    return (r ? r.nombre : c.columnName ?? '').toLowerCase();
  }));
  const porCrear = crear ? cols.filter((c) => !mapa[c.clave] || !vivasIds.has(mapa[c.clave])) : [];
  let orden = vivas.filter((c) => !(c.columnType ?? '').startsWith('__')).length;
  const registros = porCrear.map((c) => {
    const nombre = nombreLibre(nombreColumnaTablero(c), usados);
    usados.add(nombre.toLowerCase());
    puestos[c.clave] = nombre;
    return { columnName: nombre, boardId: vinculo.boardId, columnType: c.tipo, columnOrder: orden++ };
  });
  for (let i = 0; i < registros.length; i += 100) {
    const { records } = await BoardColumns.bulkCreate({ records: registros.slice(i, i + 100) });
    records.forEach((r, j) => { mapa[porCrear[i + j].clave] = r.id; });
  }
  if (crear) {
    await pool.query(
      `update formularios set vinculo = $2, updated_at = now() where id = $1`,
      [formularioId, JSON.stringify({ ...vinculo, columnas: mapa, nombres: puestos })],
    );
  } else if (renombres.length) {
    // Al guardar solo cambian los nombres: no se pisa el mapa de columnas, que otro paso puede estar ampliando.
    await pool.query(
      `update formularios set vinculo = jsonb_set(vinculo, '{nombres}', coalesce(vinculo->'nombres', '{}'::jsonb) || $2::jsonb)
       where id = $1 and vinculo->>'boardId' = $3`,
      [formularioId, JSON.stringify(Object.fromEntries(renombres.map((r) => [r.clave, r.nombre]))), vinculo.boardId],
    );
  }
  return { mapa, creadas: registros.length, renombradas: renombres.length };
}

export const asegurarColumnas = (formularioId: string, vinculo: Vinculo, cols: Columna[], def: Definicion) =>
  ajustarColumnas(formularioId, vinculo, cols, def, true);

/**
 * Al guardar el screener: las columnas que ya están en el tablero toman el
 * nombre nuevo de su pregunta. No crea columnas (una pregunta a medio escribir
 * no llega al tablero hasta que se pasan respuestas).
 */
export async function renombrarColumnas(formularioId: string, vinculo: Vinculo | null, def: Definicion): Promise<number> {
  const vigente = await vinculoVigente(vinculo);
  if (!vigente) return 0;
  const { renombradas } = await ajustarColumnas(formularioId, vigente, columnasParaTablero(def), def, false);
  return renombradas;
}

export async function pasarAlReclutamiento(
  formulario: { id: string; titulo: string; definicion: Definicion; vinculo: Vinculo },
  filas: (FilaRespuesta & { id: string })[],
  senderEmail?: string,
): Promise<{ pasadas: number; yaEstaban: number; columnasCreadas: number }> {
  const { vinculo } = formulario;
  const ya = await respuestasYaPasadas(filas.map((f) => f.id), vinculo.boardId);
  const nuevas = filas.filter((f) => !ya.has(f.id));
  if (nuevas.length === 0) return { pasadas: 0, yaEstaban: ya.size, columnasCreadas: 0 };

  // Todas las columnas del screener, no solo las contestadas: así una pregunta que se agregó en el editor
  // después de vincular también llega al tablero (con su texto de ese momento).
  const todas = columnas(formulario.definicion, nuevas, { completas: true });
  const colNombre = todas.find((c) => c.clave === 'nombre');
  const colCelular = todas.find((c) => c.clave === 'celular');
  const cols = todas.filter((c) => c !== colNombre && c !== colCelular);
  const { mapa, creadas } = await asegurarColumnas(formulario.id, vinculo, cols, formulario.definicion);

  // ── una fila por persona ──
  for (const f of nuevas) {
    const nombre = colNombre?.valor(f);
    const celular = colCelular?.valor(f);
    const row = await RecruitmentRows.create({
      record: {
        rowName: nombre ? String(nombre) : 'Sin nombre',
        projectCode: vinculo.projectCode,
        boardName: vinculo.boardName,
        boardId: vinculo.boardId,
        participantName: nombre ? String(nombre) : undefined,
        phone: celular ? String(celular) : undefined,
        status: 'Pendiente',
        sourceForm: origenRespuesta(formulario.titulo, f.id),
        level: 0,
        // La nota de historial, la misma que pone Fillout («🔴 YA PARTICIPÓ: …»), si ya se calculó.
        ...((f.resultado as { historial?: { nota?: string } }).historial?.nota ? { notes: (f.resultado as { historial?: { nota?: string } }).historial!.nota } : {}),
      },
    });
    const celdas = cols
      .map((c) => ({ c, v: c.valor(f) }))
      .filter(({ v }) => v !== undefined && v !== '')
      .map(({ c, v }) => ({
        columnId: mapa[c.clave],
        valor: c.tipo === 'Número' && typeof v === 'number' ? { numberValue: v } : { textValue: String(v) },
      }));
    for (let i = 0; i < celdas.length; i += 100) {
      await CellValues.bulkCreate({
        records: celdas.slice(i, i + 100).map((x) => ({ boardId: vinculo.boardId, rowId: row.id, columnId: x.columnId, ...x.valor })),
      });
    }
    await RecruitmentRows.update({ id: row.id, record: { cellData: JSON.stringify(Object.fromEntries(celdas.map((x) => [x.columnId, x.valor]))) } });
  }

  // Mismo aviso que publishRecruitmentRowsChanged.ts: quien tenga el tablero abierto lo ve sin recargar.
  publishEvent(`board:${vinculo.projectCode}`, 'recruitment.rows.changed', {
    projectCode: vinculo.projectCode, boardId: vinculo.boardId, rowId: '', changeType: 'created',
    entityType: 'recruitment', groupId: '', senderEmail: senderEmail ?? '', timestamp: new Date().toISOString(),
  }).catch(() => {});

  return { pasadas: nuevas.length, yaEstaban: ya.size, columnasCreadas: creadas };
}
