import { pool } from '../../../server/compat';
import { leerDefinicion } from '../../lib/formularios/tipos';
import { pasarAlReclutamiento, vinculoVigente, type Vinculo } from './reclutamiento';
import { actualizarTablero } from './tableroHub';

// Las personas que se traen de un filtro anterior («Traer a quienes contestaron antes», traer.ts) llegan solas al tablero en cuanto se vincula uno o se crea uno
// nuevo para el filtro (pedido de Sergio, 2026-11-10: «no quiero un botón más, que cargue la gente en su tablero»). Antes había que pasarlas una por una desde su
// detalle y «Pasar al tablero» las dejaba fuera: el tablero se quedaba vacío. Son cientos, así que se cargan por tandas en segundo plano, sin hacer esperar a quien
// vinculó (como el historial de las traídas), y al final se ponen al día las columnas del Hub una sola vez.

const TANDA = 40;
/** Una sola carga por filtro a la vez: dos al mismo tiempo verían las mismas pendientes y crearían filas repetidas. */
const enCurso = new Map<string, Promise<number>>();

/**
 * Las personas traídas que este tablero nunca ha tenido (ni viva ni borrada: a quien el equipo quitó del tablero no se le vuelve a pasar solo). No incluye a quien
 * no aceptó el aviso o no dio su identificación.
 */
export async function traidasPorCargar(formularioId: string, boardId: string): Promise<string[]> {
  const { rows } = await pool.query(
    `select r.id from formulario_respuestas r
     where r.formulario_id = $1 and (r.resultado ? 'traida') and coalesce(r.resultado->'terminado'->>'clave', '') not like 'hub\\_%'
       and not exists (
         select 1 from recruitment_rows f
         where f.board_id = $2 and f.source_form like 'Formulario Hub · %' and split_part(f.source_form, '|', 2) = r.id::text
       )
     order by r.created_at`,
    [formularioId, boardId],
  );
  return rows.map((r) => r.id as string);
}

/**
 * Pasa al tablero vinculado a las personas traídas que todavía no tiene y pone al día las columnas del Hub. Devuelve cuántas pasaron. Si ya hay una carga de este
 * filtro corriendo, espera esa y devuelve lo suyo (no empieza otra).
 */
export function cargarTraidasAlTablero(formularioId: string): Promise<number> {
  const corriendo = enCurso.get(formularioId);
  if (corriendo) return corriendo;
  const trabajo = (async () => {
    const { rows: [f] } = await pool.query(`select id, titulo, definicion, vinculo from formularios where id = $1`, [formularioId]);
    const vinculo = f ? await vinculoVigente((f.vinculo ?? null) as Vinculo | null) : null;
    if (!f || !vinculo) return 0;
    const pendientes = await traidasPorCargar(formularioId, vinculo.boardId);
    if (!pendientes.length) return 0;
    const definicion = leerDefinicion(f.definicion);
    let pasadas = 0;
    for (let i = 0; i < pendientes.length; i += TANDA) {
      const { rows } = await pool.query(
        `select id, created_at, es_prueba, respuestas, resultado, duracion_seg from formulario_respuestas where formulario_id = $1 and id = any($2::uuid[]) order by created_at`,
        [formularioId, pendientes.slice(i, i + TANDA)],
      );
      const r = await pasarAlReclutamiento(
        { id: f.id as string, titulo: f.titulo as string, definicion, vinculo },
        rows.map((x) => ({
          id: x.id as string, createdAt: new Date(x.created_at).toISOString(), esPrueba: x.es_prueba as boolean,
          respuestas: x.respuestas, resultado: x.resultado, duracionSeg: x.duracion_seg ?? undefined,
        })),
      );
      pasadas += r.pasadas;
    }
    await actualizarTablero(formularioId);
    return pasadas;
  })().finally(() => { enCurso.delete(formularioId); });
  enCurso.set(formularioId, trabajo);
  return trabajo;
}

/**
 * Lo que hacen los endpoints que vinculan un tablero: cuenta las pendientes (rápido) y arranca la carga en segundo plano. Devuelve cuántas se van a cargar.
 * Un error en la carga se anota en el registro del servidor; volver a vincular el tablero la retoma donde se quedó.
 */
export async function iniciarCargaDeTraidas(formularioId: string, boardId: string): Promise<number> {
  const pendientes = await traidasPorCargar(formularioId, boardId);
  if (pendientes.length) {
    cargarTraidasAlTablero(formularioId).catch((err) => console.error('[filtros] no se pudieron cargar las traídas al tablero', formularioId, (err as Error).message));
  }
  return pendientes.length;
}
