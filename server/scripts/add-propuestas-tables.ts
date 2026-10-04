// Generador de propuestas (oct 2026, SPEC_feature_propuestas_hub.md, etapa 2).
// El DDL declarativo ya vive en schema.sql (generado por generate.py, ver
// EXTRA_TABLES) — este script hace el CREATE real sobre la base ya existente
// (con los defaults y el ON DELETE CASCADE que el generador no expresa) y crea
// el bucket privado de Storage. Idempotente. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-propuestas-tables.ts
import { pool } from '../compat/db';
import { getSupabaseAdmin } from '../supabaseAdmin';

const BUCKET = process.env.PROPUESTAS_BUCKET ?? 'propuestas';

async function main() {
  await pool.query(`
    create table if not exists propuestas (
      id            uuid primary key default gen_random_uuid(),
      deal_id       uuid references deals(id) on delete set null,
      client_id     uuid references clients(id) on delete set null,
      titulo        text,
      estado        text not null default 'borrador',
      metodo        text,
      brief_texto   text,
      brief_path    text,
      notas         text,
      esqueleto     jsonb,
      contenido     jsonb,
      problemas     jsonb not null default '[]'::jsonb,
      ajustes_paleta jsonb not null default '[]'::jsonb,
      pptx_path     text,
      version       integer not null default 1,
      created_by    uuid references users(id) on delete set null,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now(),
      constraint propuestas_estado_chk check ("estado" in ('borrador','esqueleto','esqueleto_aprobado','contenido','revisado','construida','error')),
      constraint propuestas_metodo_chk check ("metodo" is null or "metodo" in ('cualitativo','cuantitativo','mixto'))
    );
  `);
  await pool.query(`create index if not exists propuestas_deal_idx on propuestas (deal_id, updated_at desc);`);

  await pool.query(`
    create table if not exists propuesta_archivos (
      id            uuid primary key default gen_random_uuid(),
      propuesta_id  uuid not null references propuestas(id) on delete cascade,
      tipo          text not null,
      slot          text,
      path          text not null,
      created_at    timestamptz not null default now(),
      constraint propuesta_archivos_tipo_chk check ("tipo" in ('foto_portada','ilustracion','entregable','foto_fase'))
    );
  `);
  await pool.query(`create index if not exists propuesta_archivos_propuesta_idx on propuesta_archivos (propuesta_id);`);

  // updated_at automático, igual que el resto de las tablas (set_updated_at ya existe en la base)
  const fn = await pool.query(`select 1 from pg_proc where proname = 'set_updated_at'`);
  if (fn.rowCount) {
    await pool.query(`drop trigger if exists propuestas_set_updated on propuestas`);
    await pool.query(`create trigger propuestas_set_updated before update on propuestas for each row execute function set_updated_at()`);
  } else {
    console.warn('⚠ no existe la función set_updated_at: updated_at no se actualizará solo');
  }
  console.log('✅ tablas propuestas y propuesta_archivos listas');

  const admin = getSupabaseAdmin();
  const { error } = await admin.storage.createBucket(BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  console.log(error ? `ℹ bucket "${BUCKET}" ya existía` : `✅ bucket privado "${BUCKET}" creado`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
