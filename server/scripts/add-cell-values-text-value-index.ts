// Aplica en Postgres el índice nuevo en cell_values(text_value) que
// generate.py ya reflejó en schema.sql (ver comentario ahí: getDashboardData.ts
// tardaba 8.8s en un Parallel Seq Scan sobre ~2.8M filas por falta de este
// índice). CONCURRENTLY para no bloquear escrituras mientras se construye
// sobre una tabla de este tamaño en la base viva — más lento de construir,
// pero no tumba al resto de la app mientras corre.
//
// Uso: npx tsx --env-file=../.env add-cell-values-text-value-index.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 0 });

async function main() {
  console.log('Creando índice (puede tardar varios minutos sobre 2.8M filas)...');
  const t0 = Date.now();
  await pool.query('create index concurrently if not exists cell_values_text_value_idx on cell_values (text_value);');
  console.log(`✅ cell_values_text_value_idx creado en ${Math.round((Date.now() - t0) / 1000)}s`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
