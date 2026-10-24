import { pool } from '../../../server/compat';
import { evaluar } from '../../lib/formularios/motor';
import { SECCION_INICIO } from '../../lib/formularios/inicio';
import { leerDefinicion, type Definicion, type Respuestas, type Resultado } from '../../lib/formularios/tipos';
import { guardarHistorial } from './historial';

// «Traer a quienes contestaron antes» (pedido de Sergio, 2026-10-24): al crear
// un filtro desde uno anterior, quienes contestaron aquel llegan a este como
// candidatos «traídos»: con sus respuestas de entonces (y su fecha), calificados
// con las reglas de este filtro y con el historial medido contra este proyecto.
// No cuentan en las cuotas ni pasan solos al tablero: se pasan uno por uno.

/** El aviso y la identificación ya se dieron en el filtro de origen: no cuentan como preguntas pendientes. */
const sinInicio = (def: Definicion): Definicion => ({ ...def, secciones: def.secciones.filter((s) => s.id !== SECCION_INICIO) });

/** Califica de nuevo con el filtro de ahora, conservando lo que se agregó después (traída, historial, IA, identificación). */
export function recalificar(def: Definicion, respuestas: Respuestas, anterior: Resultado): Resultado {
  const { traida, historial, ia, perfilLleno } = anterior;
  const identificacion = (anterior as { identificacion?: unknown }).identificacion;
  return { ...evaluar(sinInicio(def), respuestas), traida, historial, ia, perfilLleno, ...(identificacion ? { identificacion } : {}) } as Resultado;
}

/**
 * Copia al filtro `hacia` a quienes contestaron `desde` (una vez por persona:
 * la respuesta más reciente de cada celular). No trae a quien no aceptó el
 * aviso ni dio su identificación. Devuelve los ids nuevos; el historial se
 * calcula después, sin hacer esperar.
 */
export async function traerRespuestas(desde: string, hacia: string): Promise<string[]> {
  const { rows: [base] } = await pool.query(
    `select f.titulo, p.project_code from formularios f left join projects p on p.id = f.proyecto_id where f.id = $1`,
    [desde],
  );
  const { rows: [nuevo] } = await pool.query(`select definicion from formularios where id = $1`, [hacia]);
  if (!base || !nuevo) return [];
  const def = leerDefinicion(nuevo.definicion);

  const { rows } = await pool.query(
    `select distinct on (coalesce(nullif(right(regexp_replace(coalesce(telefono, ''), '\\D', '', 'g'), 10), ''), id::text))
            id, created_at, es_prueba, respuestas, resultado, nombre, telefono, duracion_seg
     from formulario_respuestas
     where formulario_id = $1 and not (resultado ? 'traida')
     order by coalesce(nullif(right(regexp_replace(coalesce(telefono, ''), '\\D', '', 'g'), 10), ''), id::text), created_at desc`,
    [desde],
  );
  const ids: string[] = [];
  for (const r of rows) {
    const anterior = r.resultado as Resultado;
    // Sin consentimiento no se reutiliza: quien no aceptó el aviso o no quiso dar su identificación.
    if (anterior.terminado?.clave.startsWith('hub_')) continue;
    const resultado: Resultado = {
      ...evaluar(sinInicio(def), r.respuestas as Respuestas),
      traida: { formularioId: desde, titulo: base.titulo, proyecto: base.project_code ?? undefined, respuestaId: r.id, fecha: new Date(r.created_at).toISOString() },
    };
    const { rows: [n] } = await pool.query(
      `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono, duracion_seg)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [hacia, r.es_prueba, JSON.stringify(r.respuestas), JSON.stringify(resultado), resultado.califica, r.nombre, r.telefono, r.duracion_seg],
    );
    ids.push(n.id as string);
  }
  return ids;
}

/** El historial de las traídas, una por una (sin hacer esperar a quien creó el filtro). */
export async function historialDeTraidas(ids: string[]): Promise<void> {
  for (const id of ids) await guardarHistorial(id).catch((err) => console.error('[filtros] historial de una traída', id, (err as Error).message));
}
