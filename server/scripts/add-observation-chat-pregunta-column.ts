// Agrega `es_pregunta` a observation_chat — soporte para "/pregunta" en el
// chat de la Sala de observación: el cliente que observa puede marcar un
// mensaje como pregunta para el moderador (en vez de charla casual), y ese
// mensaje se resalta distinto tanto en la sala pública como en el panel del
// productor dentro del Hub. Ver ObservationRoomPage.tsx / ObservationRoomPanel.tsx.
//
// Idempotente (add column if not exists).
//
// Uso: npx tsx --env-file=../.env add-observation-chat-pregunta-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table observation_chat
      add column if not exists es_pregunta boolean not null default false;
  `);
  console.log('✅ observation_chat.es_pregunta lista (o ya existía).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
