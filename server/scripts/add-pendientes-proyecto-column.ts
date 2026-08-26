// Agrega el vínculo opcional a proyecto en pendientes_personales — feedback
// tras el primer corte del feature ("le falta poder vincularlo a un
// proyecto"). Nullable: un pendiente personal puede no estar atado a nada.
// Idempotente. Uso: npx tsx --env-file=../.env add-pendientes-proyecto-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table pendientes_personales add column if not exists proyecto_code text;
    create index if not exists pendientes_personales_proyecto_idx on pendientes_personales (proyecto_code) where proyecto_code is not null;
  `);
  console.log('✅ Columna proyecto_code lista.');
  await pool.end();
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
