// Crea las 5 tablas del módulo "Ejes" (mapeo de ideas en 2 ejes, con mapa
// de cuadrantes en tiempo real). Igual que Swipe/Observación, estas tablas
// NUNCA existieron en Zite — viven fuera del pipeline de generate.py /
// export-zite-schema.json / schema.sql a propósito, en un script aparte que
// se corre una vez a mano.
//
// Como no entran al sistema de 41 modelos generados (server/compat/index.ts),
// los endpoints les hablan con `pool.query(...)` crudo en vez de un modelo.
//
// Idempotente (create table/index if not exists) para poder correrlo más de
// una vez sin romper nada.
//
// Uso: npx tsx --env-file=../../.env add-ejes-tables.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists ejes_sesiones (
      id                  uuid primary key default gen_random_uuid(),
      codigo              text unique not null,
      nombre              text not null,
      cliente             text,
      proyecto_id         uuid references projects(id) on delete set null,
      estado              text not null default 'borrador'
        constraint ejes_sesiones_estado_chk
        check (estado in ('borrador', 'activa', 'cerrada')),
      created_by          uuid references users(id) on delete set null,
      created_at          timestamptz not null default now()
    );

    create table if not exists ejes_tableros (
      id                  uuid primary key default gen_random_uuid(),
      sesion_id           uuid not null references ejes_sesiones(id) on delete cascade,
      nombre              text not null,
      descripcion         text,
      orden               int not null,
      estado              text not null default 'bloqueado'
        constraint ejes_tableros_estado_chk
        check (estado in ('bloqueado', 'abierto', 'cerrado')),
      eje_x_label         text not null default 'Eje X',
      eje_x_min           numeric not null default 0,
      eje_x_max           numeric not null default 100,
      eje_y_label         text not null default 'Eje Y',
      eje_y_min           numeric not null default 0,
      eje_y_max           numeric not null default 100,
      -- nombres de cuadrante opcionales, uno por combinación alto/bajo de
      -- cada eje. Nulos si no se configuran.
      cuadrante_alto_alto_label  text,
      cuadrante_bajo_alto_label  text,
      cuadrante_bajo_bajo_label  text,
      cuadrante_alto_bajo_label  text,
      created_at          timestamptz not null default now()
    );
    create index if not exists ejes_tableros_sesion_id_idx on ejes_tableros (sesion_id);

    create table if not exists ejes_ideas (
      id           uuid primary key default gen_random_uuid(),
      tablero_id   uuid not null references ejes_tableros(id) on delete cascade,
      titulo       text not null,
      descripcion  text,
      imagen_url   text,
      orden        int not null,
      created_at   timestamptz not null default now()
    );
    create index if not exists ejes_ideas_tablero_id_idx on ejes_ideas (tablero_id);

    create table if not exists ejes_participantes (
      id            uuid primary key default gen_random_uuid(),
      sesion_id     uuid not null references ejes_sesiones(id) on delete cascade,
      alias         text not null,
      device_token  text not null,
      created_at    timestamptz not null default now(),
      unique (sesion_id, device_token)
    );
    create index if not exists ejes_participantes_sesion_id_idx on ejes_participantes (sesion_id);

    create table if not exists ejes_evaluaciones (
      id               uuid primary key default gen_random_uuid(),
      idea_id          uuid not null references ejes_ideas(id) on delete cascade,
      participante_id  uuid not null references ejes_participantes(id) on delete cascade,
      valor_x          numeric not null,
      valor_y          numeric not null,
      ms_decision      int,
      created_at       timestamptz not null default now(),
      unique (idea_id, participante_id)
    );
    create index if not exists ejes_evaluaciones_idea_id_idx on ejes_evaluaciones (idea_id);
  `);
  console.log('✅ Tablas del módulo Ejes creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
