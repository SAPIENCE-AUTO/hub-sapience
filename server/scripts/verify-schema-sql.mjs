import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const client = await pool.connect();
try {
  await client.query('create schema if not exists schema_verify');
  await client.query('set search_path to schema_verify, public');
  await client.query(sql);
  console.log('✅ schema.sql es sintácticamente válido y corre limpio en un schema desechable.');
} catch (err) {
  console.error('❌ error al aplicar schema.sql:', err.message, 'position:', err.position);
  if (err.position) {
    const pos = Number(err.position);
    console.error('contexto:', JSON.stringify(sql.slice(Math.max(0, pos - 200), pos + 50)));
  }
  process.exitCode = 1;
} finally {
  await client.query('drop schema if exists schema_verify cascade');
  client.release();
  await pool.end();
}
