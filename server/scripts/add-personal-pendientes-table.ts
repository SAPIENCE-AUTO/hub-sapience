// Tabla para "Mis Pendientes" — parking lot personal, transversal (no atado a
// un proyecto). Nunca existió en Zite, así que vive fuera del pipeline de
// generate.py / export-zite-schema.json / schema.sql a propósito (ver
// CLAUDE.md §3 y el mismo criterio que ya usa add-observation-room-tables.ts).
// Como no entra al sistema de modelos generados (server/compat/index.ts), los
// endpoints le hablan con `pool.query(...)` crudo.
//
// area y status son texto libre a propósito (sin CHECK) — igual que el resto
// de la app evita constraints rígidos en campos tipo "Select" para no
// necesitar una migración cada vez que se agrega una categoría nueva. fuente
// sí lleva CHECK porque son 2 valores estructurales, no editables por el
// usuario.
//
// Idempotente. Uso: npx tsx --env-file=../.env add-personal-pendientes-table.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists pendientes_personales (
      id                 uuid primary key default gen_random_uuid(),
      user_id            uuid not null references users(id) on delete cascade,
      titulo             text not null,
      notas              text,
      area               text not null default 'Sin clasificar',
      status             text not null default 'Pendiente'
        constraint pendientes_personales_status_chk
        check (status in ('Pendiente', 'En curso', 'Resuelto')),
      fuente             text not null default 'manual'
        constraint pendientes_personales_fuente_chk
        check (fuente in ('manual', 'correo')),
      -- Campos de correo (solo cuando fuente = 'correo'). correo_message_id
      -- guarda el id del mensaje en Graph para no importar el mismo correo
      -- marcado dos veces al sincronizar.
      correo_message_id   text,
      correo_asunto       text,
      correo_remitente    text,
      correo_recibido_at  timestamptz,
      fecha_limite        date,
      completed_at        timestamptz,
      created_at          timestamptz not null default now(),
      updated_at          timestamptz not null default now()
    );

    create index if not exists pendientes_personales_user_id_idx on pendientes_personales (user_id);
    create index if not exists pendientes_personales_user_status_idx on pendientes_personales (user_id, status);
    create unique index if not exists pendientes_personales_correo_message_id_uq
      on pendientes_personales (user_id, correo_message_id)
      where correo_message_id is not null;

    drop trigger if exists pendientes_personales_set_updated on pendientes_personales;
    create trigger pendientes_personales_set_updated
      before update on pendientes_personales
      for each row execute function set_updated_at();
  `);

  console.log('✅ Tabla pendientes_personales lista (creada o ya existente).');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
