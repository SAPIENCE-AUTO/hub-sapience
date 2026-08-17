// Aplica en Postgres la columna nueva `created_by_id` en `cotizaciones` que
// generate.py ya reflejó en schema.sql/schema-map.ts (campo "Created By" en
// export-zite-schema.json). No existe una carga desde cero pendiente, así que
// este ALTER es la única forma de que la base viva alcance al esquema
// generado — idempotente (IF NOT EXISTS) para poder correrlo más de una vez.
//
// Uso: npx tsx --env-file=../.env add-cotizacion-created-by.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table cotizaciones
      add column if not exists created_by_id uuid references users(id) on delete set null;
  `);
  console.log('✅ cotizaciones.created_by_id agregada (o ya existía)');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
