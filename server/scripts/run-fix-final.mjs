import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sql = readFileSync(new URL('../../fix-final.sql', import.meta.url), 'utf8');

const client = await pool.connect();
try {
  const result = await client.query(sql);
  const last = Array.isArray(result) ? result[result.length - 1] : result;
  console.log('OK. Última consulta devolvió', last?.rows?.length ?? 0, 'filas:');
  console.log(JSON.stringify(last?.rows, null, 2));
} finally {
  client.release();
  await pool.end();
}
