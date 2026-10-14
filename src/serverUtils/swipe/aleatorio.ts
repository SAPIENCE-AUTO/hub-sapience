import { pool } from '../../../server/compat';

/** Lo único que se necesita del pool: así las pruebas le pasan una base en memoria. */
export interface Consulta { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

/** Postgres: la columna no existe (todavía no se corrió add-swipe-tables.ts con la opción de orden aleatorio). */
export const faltaLaColumna = (err: unknown) => (err as { code?: string } | null)?.code === '42703';

/**
 * ¿El capítulo se muestra en orden aleatorio? Si la columna aún no existe se toma como que no, para que el participante
 * nunca se quede sin ideas por un despliegue que llegó antes que la columna.
 */
export async function capituloEsAleatorio(capituloId: string, db: Consulta = pool): Promise<boolean> {
  try {
    const r = await db.query(`select aleatorio from swipe_capitulos where id = $1`, [capituloId]);
    return r.rows[0]?.aleatorio === true;
  } catch (err) {
    if (faltaLaColumna(err)) return false;
    throw err;
  }
}
