// Agrega la columna que marca si el meeting de Zoom de una sesión quedó
// desactualizado respecto a la fecha/hora/nombre reales del evento de
// calendario — ver src/api/saveCalendarEvent.ts (quién la prende) y
// src/api/syncZoomMeeting.ts (quién la apaga, empujando el cambio a Zoom).
//
// Uso: npx tsx --env-file=../.env add-observation-zoom-needs-update-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_sessions
      add column if not exists zoom_needs_update boolean not null default false;
  `);
  console.log('✅ Columna zoom_needs_update agregada a observation_sessions (o ya existía).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
