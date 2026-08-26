// "Notas" pasa a ser una columna dinámica más (como cualquier otra que el
// usuario agregue) — ya no un campo fijo en la tabla. Sin datos reales
// dependiendo de esto (feature recién lanzado), se puede tirar directo.
// Idempotente. Uso: npx tsx --env-file=../.env drop-pendientes-notas-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table pendientes_personales drop column if exists notas;`);
  console.log('✅ Columna notas eliminada.');
  await pool.end();
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
