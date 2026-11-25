import { pool } from '../../../server/compat';
import { faltaLaColumna, type Consulta } from './aleatorio';

/**
 * Modo de un capítulo de Swipe: 'swipe' son las cartas de siempre y 'duelo' es «elegir entre las imágenes» (una ronda
 * proyectada donde cada persona elige UNA imagen y el conteo se ve en vivo). Si la columna aún no existe en la base
 * (el despliegue llegó antes que add-swipe-tables.ts) todo se toma como 'swipe', para que nadie se quede sin ideas.
 */
export type ModoCapitulo = 'swipe' | 'duelo';

export async function modoDeCapitulo(capituloId: string, db: Consulta = pool): Promise<ModoCapitulo> {
  try {
    const r = await db.query(`select modo from swipe_capitulos where id = $1`, [capituloId]);
    return r.rows[0]?.modo === 'duelo' ? 'duelo' : 'swipe';
  } catch (err) {
    if (faltaLaColumna(err)) return 'swipe';
    throw err;
  }
}

/** Los capítulos de la sesión que son rondas de «elegir entre imágenes». */
export async function capitulosDuelo(sesionId: string, db: Consulta = pool): Promise<Set<string>> {
  try {
    const r = await db.query(`select id from swipe_capitulos where sesion_id = $1 and modo = 'duelo'`, [sesionId]);
    return new Set(r.rows.map((row) => row.id as string));
  } catch (err) {
    if (faltaLaColumna(err)) return new Set();
    throw err;
  }
}
