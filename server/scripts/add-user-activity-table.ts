// Tiempo de uso del Hub por persona (oct 2026). El DDL declarativo ya vive en
// schema.sql (generado por generate.py, ver EXTRA_TABLES) — este script hace el
// CREATE real sobre la base ya existente. No se ejecuta solo.
//
// Uso: npx tsx --env-file=../.env add-user-activity-table.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists user_activity (
      id          uuid primary key default gen_random_uuid(),
      user_id     uuid not null references users(id) on delete cascade,
      day         date not null,
      section     text not null,
      seconds     numeric not null default 0,
      updated_at  timestamptz not null default now(),
      constraint user_activity_uniq unique (user_id, day, section)
    );
  `);
  await pool.query(`create index if not exists user_activity_day_idx on user_activity (day, user_id);`);
  console.log('✅ tabla user_activity creada');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
