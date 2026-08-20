// Agrega la columna que registra QUÉ correo de la cuenta de Zoom quedó
// asignado a cada sesión — necesaria para poder detectar cruces de horario
// entre sesiones simultáneas (varias cuentas de Zoom, una por sesión activa
// a la vez, igual que ya se hace con los live streams de Mux).
//
// Uso: npx tsx --env-file=../.env add-observation-zoom-host-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_sessions
      add column if not exists zoom_host_email text;
  `);
  console.log('✅ Columna zoom_host_email agregada a observation_sessions (o ya existía).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
