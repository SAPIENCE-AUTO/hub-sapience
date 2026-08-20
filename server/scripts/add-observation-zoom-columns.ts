// Agrega las columnas de Zoom a observation_sessions (meeting creado por
// API + link de unión + link para el host). Ver server/zoom/client.ts.
//
// Uso: npx tsx --env-file=../.env add-observation-zoom-columns.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_sessions
      add column if not exists zoom_meeting_id text,
      add column if not exists zoom_join_url text,
      add column if not exists zoom_start_url text;
  `);
  console.log('✅ Columnas de Zoom agregadas a observation_sessions (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
