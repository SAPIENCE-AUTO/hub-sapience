import { pool } from '../../../server/compat';
import type { MapaTraidas } from '../../lib/respuestaFillout';

// Una traída es la persona que se trae de un filtro anterior al de ahora (traer.ts): se guarda como otra respuesta (id propio) con `resultado.traida.respuestaId`, el id de la
// respuesta original. Para las estadísticas es la MISMA vez que la persona llenó el filtro (ver src/lib/respuestaFillout.ts), así que se necesita saber cuál es la original.

type Consulta = { query: (texto: string, valores?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }> };

/**
 * Las traídas del Hub: id de la respuesta copiada → id de la respuesta original. Solo entran las que dicen cuál es su original. Una base sin tabla de respuestas de filtros (los
 * entornos de prueba) no tiene traídas: devuelve el mapa vacío en vez de fallar; cualquier otro error sí se propaga (no se deben contar mal las estadísticas en silencio).
 */
export async function mapaDeTraidas(consulta: Consulta = pool): Promise<MapaTraidas> {
  let rows: Array<Record<string, any>>;
  try {
    ({ rows } = await consulta.query(
      `select id::text as copia, resultado->'traida'->>'respuestaId' as original
       from formulario_respuestas
       where resultado ? 'traida' and coalesce(resultado->'traida'->>'respuestaId', '') <> ''`,
    ));
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === '42P01' || /relation "formulario_respuestas" does not exist/i.test(e.message ?? '')) return new Map();
    throw err;
  }
  const mapa = new Map<string, string>();
  for (const r of rows) {
    const copia = String(r.copia ?? ''), original = String(r.original ?? '');
    if (copia && original && copia !== original) mapa.set(copia, original);
  }
  return mapa;
}

// La consulta recorre las respuestas de todos los filtros (medido el 2026-11-11: de 0.1 a 1 s desde fuera de la nube, 3,067 respuestas) y los íconos del tablero y el historial se piden cada vez
// que alguien abre un tablero: ahí el mapa se reusa hasta un minuto. Una traída recién hecha tarda ese minuto en juntarse con su original; no pasa nada por eso. El cálculo de la estadística
// por reclutador pide el mapa sin esperar (`mapaDeTraidas`).
const VIGENCIA_MS = 60_000;
let guardado: { hasta: number; mapa: MapaTraidas } | null = null;

/** Como `mapaDeTraidas`, pero reusa el último hasta por un minuto. */
export async function mapaDeTraidasReciente(): Promise<MapaTraidas> {
  const ahora = Date.now();
  if (guardado && guardado.hasta > ahora) return guardado.mapa;
  const mapa = await mapaDeTraidas();
  guardado = { hasta: ahora + VIGENCIA_MS, mapa };
  return mapa;
}

/** Olvida el mapa guardado (las pruebas lo piden después de armar sus datos). */
export function olvidarTraidas(): void {
  guardado = null;
}
