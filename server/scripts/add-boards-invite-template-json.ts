// Aplica en Postgres la columna nueva `invite_template_json` en `boards` que
// generate.py ya reflejó en schema.sql/schema-map.ts (campo "Invite Template
// JSON" en export-zite-schema.json, agregada para el configurador de invite
// por calendario). No existe una carga desde cero pendiente, así que este
// ALTER es la única forma de que la base viva alcance al esquema generado —
// idempotente (IF NOT EXISTS) para poder correrlo más de una vez.
//
// Uso: npx tsx --env-file=../.env add-boards-invite-template-json.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table boards
      add column if not exists invite_template_json text;
  `);
  console.log('✅ boards.invite_template_json agregada (o ya existía)');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
