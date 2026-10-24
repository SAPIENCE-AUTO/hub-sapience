import { pool } from '../../../server/compat';
import { ID_FOTO_IDENTIFICACION } from '../../lib/formularios/inicio';
import { leerDefinicion, type FotoSubida, type Resultado } from '../../lib/formularios/tipos';
import { clasificarCandidato } from './clasificar';
import { guardarHistorial } from './historial';
import { revisarIdentificacion } from './identificacion';
import { pasarAlReclutamiento, vinculoVigente, type Vinculo } from './reclutamiento';

/**
 * Lo que pasa con una respuesta después de contestarle al participante (sin
 * hacerlo esperar), en orden: la identificación con la IA, el historial de
 * duplicados, el paso solo al tablero si el filtro está en vivo y califica en
 * un perfil con lugar, y la clasificación de candidato con la IA.
 */
export async function alRecibirRespuesta(respuestaId: string): Promise<void> {
  const leer = async () => (await pool.query(
    `select r.id, r.created_at, r.es_prueba, r.califica, r.respuestas, r.resultado, r.duracion_seg,
            f.id as formulario_id, f.estado, f.titulo, f.definicion, f.vinculo
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  )).rows[0];
  const r = await leer();
  if (!r) return;
  const paso = (que: string, p: Promise<unknown>) => p.catch((err) => console.error(`[filtros] ${que}`, respuestaId, (err as Error).message));

  const fotos = r.respuestas?.[ID_FOTO_IDENTIFICACION] as FotoSubida[] | undefined;
  if (Array.isArray(fotos) && fotos.length) await paso('identificación', revisarIdentificacion(respuestaId));
  await paso('historial', guardarHistorial(respuestaId));
  if (!r.es_prueba && r.estado === 'en_vivo' && r.califica && r.vinculo) await paso('paso al tablero', pasarSiHayLugar(respuestaId));
  await paso('clasificación', clasificarCandidato(respuestaId));
}

/**
 * Pasa al tablero a quien califica, si alguno de sus perfiles tiene lugar.
 * Si todos sus perfiles ya llenaron su cuota, se queda en Filtros marcada
 * «perfil lleno» (de respaldo) y no pasa sola.
 */
export async function pasarSiHayLugar(respuestaId: string): Promise<'pasada' | 'llena' | 'no'> {
  const { rows: [r] } = await pool.query(
    `select r.id, r.created_at, r.es_prueba, r.respuestas, r.resultado, r.duracion_seg, f.id as formulario_id, f.titulo, f.definicion, f.vinculo
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  );
  const resultado = r?.resultado as Resultado | undefined;
  if (!r || !resultado?.califica || !r.vinculo) return 'no';
  const def = leerDefinicion(r.definicion);

  const { rows: otras } = await pool.query(
    `select resultado->'frentes' as frentes from formulario_respuestas
     where formulario_id = $1 and not es_prueba and califica and id <> $2 and created_at <= $3 and not (resultado ? 'traida')`,
    [r.formulario_id, r.id, r.created_at],
  );
  const cuenta = new Map<string, number>();
  for (const o of otras) for (const id of (o.frentes as string[] | null) ?? []) cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
  const conLugar = resultado.frentes.filter((id) => (cuenta.get(id) ?? 0) < (def.frentes?.find((f) => f.id === id)?.meta ?? Infinity));
  if (!conLugar.length) {
    await pool.query(`update formulario_respuestas set resultado = resultado || '{"perfilLleno": true}'::jsonb where id = $1`, [r.id]);
    return 'llena';
  }
  const vinculo = await vinculoVigente(r.vinculo as Vinculo);
  if (!vinculo) return 'no';
  await pasarAlReclutamiento(
    { id: r.formulario_id, titulo: r.titulo, definicion: def, vinculo },
    [{ id: r.id, createdAt: new Date(r.created_at).toISOString(), esPrueba: r.es_prueba, respuestas: r.respuestas, resultado, duracionSeg: r.duracion_seg ?? undefined }],
  );
  return 'pasada';
}
