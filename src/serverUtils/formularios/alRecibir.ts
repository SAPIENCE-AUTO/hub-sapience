import { pool } from '../../../server/compat';
import { ID_FOTO_IDENTIFICACION } from '../../lib/formularios/inicio';
import { leerDefinicion, type FotoSubida, type Resultado } from '../../lib/formularios/tipos';
import { clasificarCandidato } from './clasificar';
import { guardarHistorial } from './historial';
import { revisarIdentificacion } from './identificacion';
import { pasarAlReclutamiento, vinculoVigente, type Vinculo } from './reclutamiento';
import { actualizarTablero } from './tableroHub';

/**
 * Lo que pasa con una respuesta después de contestarle al participante (sin
 * hacerlo esperar), en orden: la identificación con la IA, el historial de
 * duplicados, la clasificación con la IA y, si el filtro está en vivo y tiene
 * tablero, el paso al tablero de todas las respuestas (2026-10-26: ahí se
 * califican, en las columnas del Hub) con las columnas puestas al día.
 */
export async function alRecibirRespuesta(respuestaId: string): Promise<void> {
  const leer = async () => (await pool.query(
    `select r.id, r.es_prueba, r.respuestas, f.id as formulario_id, f.estado, f.vinculo
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  )).rows[0];
  const r = await leer();
  if (!r) return;
  const paso = (que: string, p: Promise<unknown>) => p.catch((err) => console.error(`[filtros] ${que}`, respuestaId, (err as Error).message));

  const fotos = r.respuestas?.[ID_FOTO_IDENTIFICACION] as FotoSubida[] | undefined;
  if (Array.isArray(fotos) && fotos.length) await paso('identificación', revisarIdentificacion(respuestaId));
  await paso('historial', guardarHistorial(respuestaId));
  await paso('clasificación', clasificarCandidato(respuestaId));
  if (!r.es_prueba && r.estado === 'en_vivo' && r.vinculo) {
    await paso('paso al tablero', pasarAlTablero(respuestaId));
    await paso('columnas del Hub', actualizarTablero(r.formulario_id));
  }
}

/**
 * Pasa una respuesta al tablero del filtro. Todas pasan (califiquen o no),
 * menos quien no aceptó el aviso o no dio su identificación: sin su
 * consentimiento no se guarda en el tablero.
 */
export async function pasarAlTablero(respuestaId: string): Promise<boolean> {
  const { rows: [r] } = await pool.query(
    `select r.id, r.created_at, r.es_prueba, r.respuestas, r.resultado, r.duracion_seg, f.id as formulario_id, f.titulo, f.definicion, f.vinculo
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  );
  const resultado = r?.resultado as Resultado | undefined;
  if (!r || !resultado || !r.vinculo || resultado.terminado?.clave.startsWith('hub_')) return false;
  const vinculo = await vinculoVigente(r.vinculo as Vinculo);
  if (!vinculo) return false;
  await pasarAlReclutamiento(
    { id: r.formulario_id, titulo: r.titulo, definicion: leerDefinicion(r.definicion), vinculo },
    [{ id: r.id, createdAt: new Date(r.created_at).toISOString(), esPrueba: r.es_prueba, respuestas: r.respuestas, resultado, duracionSeg: r.duracion_seg ?? undefined }],
  );
  return true;
}
