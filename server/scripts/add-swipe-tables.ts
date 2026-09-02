// Crea las 5 tablas del módulo "Swipe" (descarte de ideas tipo Tinder en
// workshops). Igual que las tablas de la Sala de observación
// (add-observation-room-tables.ts), estas NUNCA existieron en Zite — viven
// fuera del pipeline de generate.py / export-zite-schema.json / schema.sql
// a propósito, en un script aparte que se corre una vez a mano.
//
// Como no entran al sistema de 41 modelos generados (server/compat/index.ts),
// los endpoints les hablan con `pool.query(...)` crudo en vez de un modelo.
//
// Idempotente (create table/index if not exists) para poder correrlo más de
// una vez sin romper nada.
//
// Uso: npx tsx --env-file=../.env add-swipe-tables.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists swipe_sesiones (
      id                  uuid primary key default gen_random_uuid(),
      codigo              text unique not null,
      nombre              text not null,
      cliente             text,
      -- tabla real del Hub es "projects" (no "proyectos" — spec original
      -- tenía el nombre en español, que no existe en este esquema).
      proyecto_id         uuid references projects(id) on delete set null,
      estado              text not null default 'borrador'
        constraint swipe_sesiones_estado_chk
        check (estado in ('borrador', 'activa', 'cerrada')),
      -- FK lógica, no constraint: apunta a swipe_capitulos, que referencia
      -- de vuelta a esta tabla (mismo patrón que observation_sessions no
      -- tiene con sus hijas, evita el ciclo de creación).
      capitulo_activo_id  uuid,
      max_super_likes     int not null default 3,
      created_by          uuid references users(id) on delete set null,
      created_at          timestamptz not null default now()
    );

    create table if not exists swipe_capitulos (
      id           uuid primary key default gen_random_uuid(),
      sesion_id    uuid not null references swipe_sesiones(id) on delete cascade,
      nombre       text not null,
      descripcion  text,
      orden        int not null,
      estado       text not null default 'bloqueado'
        constraint swipe_capitulos_estado_chk
        check (estado in ('bloqueado', 'abierto', 'cerrado')),
      created_at   timestamptz not null default now()
    );
    create index if not exists swipe_capitulos_sesion_id_idx on swipe_capitulos (sesion_id);

    create table if not exists swipe_ideas (
      id           uuid primary key default gen_random_uuid(),
      capitulo_id  uuid not null references swipe_capitulos(id) on delete cascade,
      titulo       text not null,
      descripcion  text,
      imagen_url   text,
      orden        int not null,
      created_at   timestamptz not null default now()
    );
    create index if not exists swipe_ideas_capitulo_id_idx on swipe_ideas (capitulo_id);

    create table if not exists swipe_participantes (
      id            uuid primary key default gen_random_uuid(),
      sesion_id     uuid not null references swipe_sesiones(id) on delete cascade,
      alias         text not null,
      device_token  text not null,
      last_seen_at  timestamptz default now(),
      created_at    timestamptz not null default now(),
      unique (sesion_id, device_token)
    );
    create index if not exists swipe_participantes_sesion_id_idx on swipe_participantes (sesion_id);

    create table if not exists swipe_votos (
      id               uuid primary key default gen_random_uuid(),
      idea_id          uuid not null references swipe_ideas(id) on delete cascade,
      participante_id  uuid not null references swipe_participantes(id) on delete cascade,
      valor            text not null
        constraint swipe_votos_valor_chk
        check (valor in ('potencial', 'descarte', 'super')),
      ms_decision      int,
      created_at       timestamptz not null default now(),
      unique (idea_id, participante_id)
    );
    create index if not exists swipe_votos_idea_id_idx on swipe_votos (idea_id);
  `);
  console.log('✅ Tablas del módulo Swipe creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
