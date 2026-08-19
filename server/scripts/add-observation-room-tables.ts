// Crea las 4 tablas de la Sala de observación (Mux/StreamYard). Estas tablas
// NUNCA existieron en Zite — están fuera del pipeline de generate.py /
// export-zite-schema.json / schema.sql a propósito (ver CLAUDE.md §3: esos
// tres archivos se generan de una sola fuente y no se editan a mano; algo que
// nunca estuvo en el export de Zite no puede pasar por ahí). Por eso viven en
// un script aparte, igual que add-cotizacion-created-by.ts hace para cambios
// no derivables del export — con la diferencia de que aquí son tablas nuevas,
// no una columna.
//
// Como no entran al sistema de 41 modelos generados (server/compat/index.ts),
// los endpoints les hablan con `pool.query(...)` crudo en vez de un modelo.
//
// Idempotente (create table/index if not exists) para poder correrlo más de
// una vez sin romper nada.
//
// Uso: npx tsx --env-file=../.env add-observation-room-tables.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists observation_sessions (
      id                  uuid primary key default gen_random_uuid(),
      -- se engancha al calendario existente; on delete set null porque el
      -- historial de la sesión (chat, asistencia) sobrevive aunque se borre
      -- el evento de calendario que le dio origen.
      calendar_event_id   uuid references calendar_events(id) on delete set null,
      slug                text unique not null,
      nombre              text,
      cliente             text,
      mux_live_stream_id  text,
      mux_stream_key      text,
      mux_playback_id     text,
      mux_asset_id        text,
      estado              text not null default 'borrador'
        constraint observation_sessions_estado_chk
        check (estado in ('borrador', 'esperando', 'vivo', 'terminada')),
      scheduled_at        timestamptz,
      started_at          timestamptz,
      ended_at            timestamptz,
      created_at          timestamptz not null default now(),
      updated_at          timestamptz not null default now()
    );

    drop trigger if exists observation_sessions_set_updated on observation_sessions;
    create trigger observation_sessions_set_updated
      before update on observation_sessions
      for each row execute function set_updated_at();

    create table if not exists observers (
      id          uuid primary key default gen_random_uuid(),
      session_id  uuid not null references observation_sessions(id) on delete cascade,
      nombre      text,
      apellido    text,
      email       text,
      created_at  timestamptz not null default now()
    );
    create index if not exists observers_session_id_idx on observers (session_id);

    -- Insert-only por diseño (ver CLAUDE (1).md): nunca upsert ni
    -- sobrescritura, la historia completa de heartbeats es el dato que
    -- alimenta el cómputo de tramos de conexión.
    create table if not exists observer_heartbeats (
      id          uuid primary key default gen_random_uuid(),
      session_id  uuid not null references observation_sessions(id) on delete cascade,
      observer_id uuid not null references observers(id) on delete cascade,
      ts          timestamptz not null default now()
    );
    create index if not exists observer_heartbeats_session_observer_ts_idx
      on observer_heartbeats (session_id, observer_id, ts);

    create table if not exists observation_chat (
      id           uuid primary key default gen_random_uuid(),
      session_id   uuid not null references observation_sessions(id) on delete cascade,
      observer_id  uuid references observers(id) on delete set null,
      body         text not null,
      es_productor boolean not null default false,
      borrado      boolean not null default false,
      created_at   timestamptz not null default now()
    );
    create index if not exists observation_chat_session_created_idx
      on observation_chat (session_id, created_at);
  `);
  console.log('✅ Tablas de la Sala de observación creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
