import { pool } from '../../../server/compat';
import { publishEvent } from '../../lib/ably';
import { cuotasPorNombre, leerMuestra } from '../../lib/reclutamiento/muestra';
import { columnas, type FilaRespuesta } from '../../lib/formularios/tabla';
import { esConteoDeFotos } from '../../lib/formularios/fotoTablero';
import { leerDefinicion, type Definicion, type Resultado } from '../../lib/formularios/tipos';
import { recalificar } from './traer';
import { asegurarColumnas, columnasParaTablero, correoDeRespuesta, vinculoVigente, type Vinculo } from './reclutamiento';

/**
 * Las columnas del Hub en el tablero (pedido de Sergio, 2026-10-26): todas
 * las respuestas llegan al tablero y ahí se califican, en columnas normales
 * que el equipo filtra, ordena y guarda en vistas: Califica (Candidato, Casi,
 * No entra), Perfil, Por qué no califica, IA y Sugerido. El Hub las mantiene
 * al día (con las reglas y cuotas de hoy), salvo las celdas que cambió el
 * equipo: de cada una guarda lo último que escribió y, si la celda ya no dice
 * eso, no la vuelve a tocar.
 *
 * Sugeridos: los mejores candidatos (IA alto primero, sin historial que
 * preocupe, los que contestaron antes) hasta cubrir lo que le falta a cada
 * perfil: su cuota (la del perfil en la muestra si la hay; si no, la del filtro) menos los
 * que ya están en un grupo. Quien cae en varios perfiles se sugiere para uno
 * solo, el que más le falta, y cuenta una vez.
 */
export const CLAVES_HUB = ['resultado', 'frente', 'motivo', 'ia', 'sugerido'] as const;

const PUNTOS_IA: Record<string, number> = { alto: 3, medio: 2, bajo: 0 };
const HISTORIAL_QUE_PREOCUPA = new Set(['ya_participo', 'mismo_proyecto']);

/** Cuántos le faltan a cada perfil: la cuota (de la muestra o del filtro) menos los que ya están en un grupo. */
function cuotas(def: Definicion, muestraPorPerfil: Map<string, number>): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of def.frentes ?? []) m.set(f.id, muestraPorPerfil.get(f.nombre.trim().toLowerCase()) ?? f.meta);
  return m;
}

/** Quién se sugiere para qué perfil (por id de respuesta). */
export function sugerir(
  def: Definicion,
  filas: { id: string; resultado: Resultado; createdAt: string; enGrupo: boolean }[],
  muestraPorPerfil = new Map<string, number>(),
): Map<string, string> {
  const falta = cuotas(def, muestraPorPerfil);
  // Los que ya están en un grupo cuentan para su perfil (el primero de los suyos que todavía necesita gente).
  for (const f of filas.filter((x) => x.enGrupo && x.resultado.califica)) {
    const p = f.resultado.frentes.find((id) => (falta.get(id) ?? 0) > 0);
    if (p) falta.set(p, (falta.get(p) ?? 0) - 1);
  }
  const candidatos = filas
    .filter((f) => !f.enGrupo && f.resultado.califica && !HISTORIAL_QUE_PREOCUPA.has(f.resultado.historial?.nivel ?? ''))
    .sort((a, b) => (PUNTOS_IA[b.resultado.ia?.encaje ?? ''] ?? 1) - (PUNTOS_IA[a.resultado.ia?.encaje ?? ''] ?? 1)
      || Number(!!a.resultado.historial?.nivel) - Number(!!b.resultado.historial?.nivel)
      || a.createdAt.localeCompare(b.createdAt));
  const out = new Map<string, string>();
  for (const c of candidatos) {
    const abiertos = c.resultado.frentes.filter((id) => (falta.get(id) ?? 0) > 0);
    if (!abiertos.length) continue;
    // El que más gente le falta; si empatan, donde mejor encaja según la IA.
    const encaje = (id: string) => PUNTOS_IA[c.resultado.ia?.perfiles.find((p) => p.id === id)?.encaje ?? ''] ?? 1;
    const perfil = abiertos.reduce((a, b) => {
      const fa = falta.get(a) ?? 0;
      const fb = falta.get(b) ?? 0;
      return fb > fa || (fb === fa && encaje(b) > encaje(a)) ? b : a;
    });
    falta.set(perfil, (falta.get(perfil) ?? 0) - 1);
    out.set(c.id, perfil);
  }
  return out;
}

const valorDeCelda = (celda: unknown): string => {
  if (!celda || typeof celda !== 'object') return '';
  const c = celda as { textValue?: unknown; numberValue?: unknown };
  return c.textValue != null ? String(c.textValue) : c.numberValue != null ? String(c.numberValue) : '';
};

/**
 * Pone al día las columnas del Hub de todas las filas que un filtro tiene en
 * su tablero. Califica con las reglas de hoy (sin tocar a quien se cortó en
 * «Antes de empezar») y recalcula los sugeridos. Devuelve cuántas celdas
 * cambió y cuántas respetó porque las cambió el equipo.
 */
export async function actualizarTablero(formularioId: string): Promise<{ escritas: number; respetadas: number }> {
  const { rows: [f] } = await pool.query(
    `select f.id, f.definicion, f.vinculo, f.proyecto_id, m.definicion as muestra
     from formularios f left join muestras m on m.proyecto_id = f.proyecto_id where f.id = $1`,
    [formularioId],
  );
  const vinculo = await vinculoVigente((f?.vinculo ?? null) as Vinculo | null);
  if (!f || !vinculo) return { escritas: 0, respetadas: 0 };
  const def = leerDefinicion(f.definicion);

  // Las filas de este filtro en el tablero (una por respuesta).
  const { rows: filasTablero } = await pool.query(
    `select id, split_part(source_form, '|', 2) as respuesta, cell_data, email from recruitment_rows
     where board_id = $1 and source_form like 'Formulario Hub · %' and (deleted_at is null or deleted_at = '')`,
    [vinculo.boardId],
  );
  if (!filasTablero.length) return { escritas: 0, respetadas: 0 };
  const filaDe = new Map(filasTablero.map((r) => [r.respuesta as string, r]));
  const { rows: respuestas } = await pool.query(
    `select id, created_at, es_prueba, respuestas, resultado, duracion_seg from formulario_respuestas where formulario_id = $1 and id::text = any($2::text[])`,
    [formularioId, [...filaDe.keys()]],
  );
  const { rows: enGrupos } = await pool.query(
    `select distinct row_id from cell_values where board_id = $1 and text_value = '1' and deleted_at is null and row_id = any($2::text[])`,
    [`${vinculo.boardId}::groups`, filasTablero.map((r) => String(r.id))],
  );
  const enGrupo = new Set(enGrupos.map((r) => r.row_id as string));

  // Califica con las reglas de hoy (quien no dio el aviso o la identificación se queda como estaba).
  const filas = respuestas.map((r) => {
    const anterior = r.resultado as Resultado;
    const resultado = anterior.terminado?.clave.startsWith('hub_') ? anterior : recalificar(def, r.respuestas, anterior);
    return { id: r.id as string, createdAt: new Date(r.created_at).toISOString(), esPrueba: r.es_prueba as boolean, respuestas: r.respuestas, duracionSeg: r.duracion_seg ?? undefined, resultado, anterior, fila: filaDe.get(String(r.id))! };
  });
  // La cuota de cada perfil sale de la muestra (si la hay).
  const muestraPorPerfil = f.muestra ? cuotasPorNombre(leerMuestra(f.muestra)) : new Map<string, number>();
  const sugeridos = sugerir(def, filas.map((x) => ({ ...x, enGrupo: enGrupo.has(String(x.fila.id)) })), muestraPorPerfil);
  const nombrePerfil = (id: string) => def.frentes?.find((x) => x.id === id)?.nombre ?? id;

  // Las columnas (las crea si a un tablero vinculado antes le faltan IA o Sugerido).
  const todas = columnasParaTablero(def);
  const yaTenia = new Set(Object.keys(vinculo.columnas ?? {}));
  const { mapa } = await asegurarColumnas(formularioId, vinculo, todas, def);
  // En un tablero vinculado antes, IA y Sugerido se acomodan junto a las demás del Hub (no al final).
  for (const [clave, mas] of [['ia', 0.1], ['sugerido', 0.2]] as const) {
    if (!yaTenia.has(clave) && mapa[clave] && mapa.motivo) {
      await pool.query(
        `update board_columns set column_order = (select column_order from board_columns where id = $2) + $3 where id = $1`,
        [mapa[clave], mapa.motivo, mas],
      );
    }
  }
  const cols = columnas(def, [], { completas: true }).filter((c) => (CLAVES_HUB as readonly string[]).includes(c.clave));
  // Las fotos que llegaron como «1 foto» (antes de que se vieran en el tablero) pasan a su referencia.
  const colsFoto = todas.filter((c) => c.tipo === 'Archivo' && c.tablero);
  // Columnas nuevas que se llenan en las filas que ya estaban (la dirección completa).
  const colsRellenar = todas.filter((c) => c.rellenar);
  // El correo en el «Email» propio del tablero, si quedó vacío (antes no se llenaba).
  const correoDe = correoDeRespuesta(def);

  let escritas = 0;
  let respetadas = 0;
  for (const x of filas) {
    const sugerido = sugeridos.get(x.id);
    const resultado: Resultado = { ...x.resultado, sugerido: sugerido ? nombrePerfil(sugerido) : undefined };
    const fila: FilaRespuesta = { createdAt: x.createdAt, esPrueba: x.esPrueba, respuestas: x.respuestas, resultado, duracionSeg: x.duracionSeg };
    const escrito: Record<string, string> = { ...(x.anterior.tablero?.escrito ?? {}) };
    let cellData: Record<string, unknown> = {};
    try { cellData = JSON.parse(x.fila.cell_data || '{}'); } catch { /* se rehace */ }
    let cambio = false;
    for (const c of cols) {
      const colId = mapa[c.clave];
      if (!colId) continue;
      const nuevo = String(c.valor(fila) ?? '');
      const actual = valorDeCelda(cellData[colId]);
      // La cambió el equipo: se respeta.
      if (escrito[c.clave] !== undefined && actual !== escrito[c.clave]) { respetadas++; continue; }
      if (actual === nuevo) { escrito[c.clave] = nuevo; continue; }
      await pool.query(
        `insert into cell_values (board_id, row_id, column_id, text_value) values ($1, $2, $3, $4)
         on conflict (board_id, row_id, column_id) where deleted_at is null do update set text_value = excluded.text_value, updated_at = now()`,
        [vinculo.boardId, String(x.fila.id), colId, nuevo],
      );
      if (nuevo) cellData[colId] = { textValue: nuevo }; else delete cellData[colId];
      escrito[c.clave] = nuevo;
      escritas++;
      cambio = true;
    }
    for (const c of colsFoto) {
      const colId = mapa[c.clave];
      const nuevo = String(c.tablero!(fila) ?? '');
      const actual = valorDeCelda(cellData[colId]);
      if (!colId || !nuevo || actual === nuevo || (actual && !esConteoDeFotos(actual))) continue;
      await pool.query(
        `insert into cell_values (board_id, row_id, column_id, text_value) values ($1, $2, $3, $4)
         on conflict (board_id, row_id, column_id) where deleted_at is null do update set text_value = excluded.text_value, updated_at = now()`,
        [vinculo.boardId, String(x.fila.id), colId, nuevo],
      );
      cellData[colId] = { textValue: nuevo };
      escritas++;
      cambio = true;
    }
    for (const c of colsRellenar) {
      const colId = mapa[c.clave];
      const nuevo = String(c.valor(fila) ?? '');
      if (!colId || !nuevo || valorDeCelda(cellData[colId])) continue;
      await pool.query(
        `insert into cell_values (board_id, row_id, column_id, text_value) values ($1, $2, $3, $4)
         on conflict (board_id, row_id, column_id) where deleted_at is null do update set text_value = excluded.text_value, updated_at = now()`,
        [vinculo.boardId, String(x.fila.id), colId, nuevo],
      );
      cellData[colId] = { textValue: nuevo };
      escritas++;
      cambio = true;
    }
    const correo = correoDe(x.respuestas);
    if (correo && !String(x.fila.email ?? '').trim()) {
      await pool.query(`update recruitment_rows set email = $2 where id = $1 and coalesce(email, '') = ''`, [x.fila.id, correo]);
      escritas++;
    }
    if (cambio) await pool.query(`update recruitment_rows set cell_data = $2 where id = $1`, [x.fila.id, JSON.stringify(cellData)]);
    // Solo lo que calcula el Hub (la calificación, el sugerido y lo escrito): lo demás (IA, historial) lo pueden
    // estar escribiendo al mismo tiempo los pasos de otra respuesta, y no se pisa.
    const { califica, terminado, noCalifica, descartes, gruposExcluidos, nse, frentes, alertas, incompleto } = resultado;
    const propio = { califica, terminado, noCalifica, descartes, gruposExcluidos, nse, frentes, alertas, incompleto, sugerido: resultado.sugerido, tablero: { fila: String(x.fila.id), escrito } };
    const antes = { ...x.anterior, sugerido: x.anterior.sugerido, tablero: x.anterior.tablero };
    if (Object.entries(propio).every(([k, v]) => JSON.stringify(v) === JSON.stringify((antes as Record<string, unknown>)[k]))) continue;
    await pool.query(
      `update formulario_respuestas set resultado = (resultado - 'terminado' - 'noCalifica' - 'nse' - 'sugerido') || $2::jsonb, califica = $3 where id = $1`,
      [x.id, JSON.stringify(propio), califica],
    );
  }

  if (escritas) {
    publishEvent(`board:${vinculo.projectCode}`, 'recruitment.rows.changed', {
      projectCode: vinculo.projectCode, boardId: vinculo.boardId, rowId: '', changeType: 'updated',
      entityType: 'recruitment', groupId: '', senderEmail: '', timestamp: new Date().toISOString(),
    }).catch(() => {});
  }
  return { escritas, respetadas };
}
