import { Pool, types } from 'pg';
import { DATE_OID, TIMESTAMPTZ_OID, parseDate, parseTimestamptz } from './datetimeParsers';

/**
 * Ver datetimeParsers.ts: sin esto, `pg` devuelve `Date` de JS para date/timestamptz
 * en vez del string que espera el código portado — tronaba con
 * "t.startDate?.split is not a function" en el primer endpoint que tocaba una fecha.
 */
types.setTypeParser(DATE_OID, parseDate);
types.setTypeParser(TIMESTAMPTZ_OID, parseTimestamptz);

/**
 * Un solo pool para todo el proceso.
 *
 * Los timeouts NO son opcionales: sin ellos, una consulta que se atora deja el
 * proceso colgado en silencio para siempre. Es exactamente lo que pasó cargando
 * Purchase Orders — se quedó pegado en 2000/2611 sin error ni aviso.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,

  // Cuánto esperar por una conexión libre del pool antes de rendirse.
  connectionTimeoutMillis: 10_000,

  // Mata cualquier consulta que pase de este tiempo. Súbelo para cargas masivas.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT ?? 30_000),

  // Corta transacciones que quedaron abiertas sin actividad: la causa raíz del
  // bloqueo anterior. Sin esto, un BEGIN huérfano retiene la conexión sin límite.
  idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT ?? 60_000),
});

pool.on('error', (err) => console.error('[pg] error inesperado en cliente idle', err));

/** Para diagnóstico: cuántas conexiones hay y cuántas esperan. */
export function poolStats() {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}
