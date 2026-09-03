// Agrega `estado` a `ejes_ideas` para poder activar ideas 1 a 1 dentro de un
// tablero (antes, abrir el tablero exponía todas sus ideas de golpe). Mismo
// enum/patrón que `ejes_tableros.estado`. Idempotente.
//
// Uso: npx tsx --env-file=../../.env add-ejes-idea-estado.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    alter table ejes_ideas add column if not exists estado text not null default 'bloqueado';
  `);
  await pool.query(`
    do $$
    begin
      if not exists (select 1 from pg_constraint where conname = 'ejes_ideas_estado_chk') then
        alter table ejes_ideas add constraint ejes_ideas_estado_chk check (estado in ('bloqueado', 'abierto', 'cerrado'));
      end if;
    end $$;
  `);
  console.log('✅ Columna estado agregada a ejes_ideas (o ya existía).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
