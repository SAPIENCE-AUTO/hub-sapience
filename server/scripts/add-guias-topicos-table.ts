// Guías de tópicos (oct 2026, paquetes/guias-topicos). El DDL declarativo ya vive en schema.sql (generado por generate.py, ver EXTRA_TABLES) — este script
// hace el CREATE real sobre la base ya existente (con los defaults que el generador no expresa) y deja el updated_at automático. Idempotente. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-guias-topicos-table.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists guias_topicos (
      id            uuid primary key default gen_random_uuid(),
      project_id    uuid references projects(id) on delete set null,
      titulo        text not null default 'Guía sin nombre',
      estado        jsonb not null default '{}'::jsonb,
      version       integer not null default 1,
      created_by_id uuid references users(id) on delete set null,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now(),
      deleted_at    timestamptz
    );
  `);
  await pool.query(`create index if not exists guias_topicos_project_idx on guias_topicos (project_id, updated_at desc) where deleted_at is null;`);

  // updated_at automático, igual que el resto de las tablas (set_updated_at ya existe en la base)
  const fn = await pool.query(`select 1 from pg_proc where proname = 'set_updated_at'`);
  if (fn.rowCount) {
    await pool.query(`drop trigger if exists guias_topicos_set_updated on guias_topicos`);
    await pool.query(`create trigger guias_topicos_set_updated before update on guias_topicos for each row execute function set_updated_at()`);
  } else {
    console.warn('⚠ no existe la función set_updated_at: updated_at no se actualizará solo');
  }
  console.log('✅ tabla guias_topicos lista');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
