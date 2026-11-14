// Agrega a observation_sessions lo que el Hub guarda de la sesión de Talks de cada evento: el id de la
// sesión en Talks y sus dos links (el del equipo, que abre «Abrir en Talks», y el de participantes).
// Ver src/api/createTalksSession.ts, src/api/getTalksSession.ts y server/talks/client.ts.
//
// observation_sessions no sale de generate.py / schema.sql (ver add-observation-room-tables.ts), así que
// sus columnas nuevas se agregan con un script aparte, igual que las de Zoom y las de la grabación.
//
// NO se ejecuta solo. Hay que correrlo ANTES de subir el código que lo usa: sin estas columnas el botón
// «Crear links de sesión» avisa que falta la migración (no rompe el resto de la Sala de observación).
//
// Idempotente (add column if not exists): correrlo dos veces no hace nada la segunda.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-observation-talks-columns.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_sessions
      add column if not exists talks_session_id text,
      add column if not exists talks_link_equipo text,
      add column if not exists talks_link_participantes text;
  `);
  console.log('✅ Columnas de Talks agregadas a observation_sessions (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
