// Agrega mux_asset_playback_id a observation_sessions — el webhook de Mux
// (video.asset.ready) ya guardaba mux_asset_id (el ID del asset grabado),
// pero ESO no sirve para reproducirlo: mux-player necesita un playback_id,
// que es un recurso distinto dentro del asset. Sin esta columna no hay
// forma de ofrecer la grabación una vez terminada la sesión — el cliente
// se quedaba viendo un mensaje de texto para siempre.
//
// Idempotente (add column if not exists).
//
// Uso: npx tsx --env-file=../.env add-observation-asset-playback-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_sessions
      add column if not exists mux_asset_playback_id text;
  `);
  console.log('✅ observation_sessions.mux_asset_playback_id lista (o ya existía).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
