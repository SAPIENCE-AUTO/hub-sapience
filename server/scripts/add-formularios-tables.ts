// Crea las 2 tablas de Tools → Formularios y el bucket PRIVADO de Storage donde viven las fotos que suben los
// participantes. Igual que Swipe (add-swipe-tables.ts), estas tablas nunca existieron en Zite: viven fuera del
// pipeline de generate.py y los endpoints les hablan con `pool.query(...)`. Solo agrega: no toca ninguna tabla
// existente. Idempotente. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-formularios-tables.ts
import { pool } from '../compat/db';
import { getSupabaseAdmin } from '../supabaseAdmin';

const BUCKET = process.env.FORMULARIOS_BUCKET ?? 'formularios';

async function main() {
  await pool.query(`
    create table if not exists formularios (
      id           uuid primary key default gen_random_uuid(),
      proyecto_id  uuid references projects(id) on delete set null,
      -- va en el enlace público /f/:codigo
      codigo       text unique not null,
      titulo       text not null,
      plantilla    text,
      definicion   jsonb not null,
      -- borrador: nadie puede contestar · prueba: se contesta y todo queda marcado como prueba ·
      -- en_vivo: respuestas reales · cerrado: ya no acepta respuestas
      estado       text not null default 'borrador'
        constraint formularios_estado_chk check (estado in ('borrador', 'prueba', 'en_vivo', 'cerrado')),
      created_by   uuid references users(id) on delete set null,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    );
    create index if not exists formularios_proyecto_id_idx on formularios (proyecto_id);

    create table if not exists formulario_respuestas (
      id             uuid primary key default gen_random_uuid(),
      formulario_id  uuid not null references formularios(id) on delete cascade,
      es_prueba      boolean not null,
      respuestas     jsonb not null,
      -- lo calcula el servidor con la definición completa (src/lib/formularios/motor.ts → evaluar)
      resultado      jsonb not null,
      califica       boolean not null default false,
      nombre         text,
      telefono       text,
      device_token   text,
      duracion_seg   int,
      created_at     timestamptz not null default now()
    );
    create index if not exists formulario_respuestas_formulario_id_idx on formulario_respuestas (formulario_id, created_at desc);

    -- Agregada después del alta inicial: tablero de Reclutamiento al que se pasan las respuestas
    -- { boardId, boardName, projectCode, columnas: { claveDeColumna: board_columns.id } }.
    alter table formularios add column if not exists vinculo jsonb;
  `);
  console.log('✅ Tablas de formularios creadas (o ya existían).');

  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(error ? `ℹ bucket "${BUCKET}" ya existía` : `✅ bucket privado "${BUCKET}" creado`);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
