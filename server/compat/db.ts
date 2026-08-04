import { Pool } from 'pg';

/**
 * Un solo pool para todo el proceso.
 * En Zite cada endpoint era aislado; aquí conviene reutilizar conexiones.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[pg] error inesperado en cliente idle', err));
