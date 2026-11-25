// Pilares (unidades de negocio), nov 2026: crea las tablas `pilares` (el catálogo editable: Cualitativo, Cuantitativo, Digital, Estrategia…) y `deal_pilares` (cuánto del ingreso y del
// costo de cada deal le toca a cada pilar) y deja los cuatro pilares de arranque. El DDL declarativo ya vive en schema.sql (generado por generate.py, ver EXTRA_TABLES): este script
// hace el CREATE real sobre la base ya existente y es IDEMPOTENTE (se puede correr dos veces sin duplicar nada). No toca ninguna tabla que ya exista ni ningún deal.
// No se ejecuta solo: hay que correrlo ANTES de subir el código que lo usa, porque `getDeals`… no cambia, pero las pantallas de Pilares leen estas tablas.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-pilares-tables.ts
import { fileURLToPath } from 'node:url';
import { PILARES_DE_ARRANQUE } from '../../src/lib/pilares/catalogo';

interface Bd { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

/** Crea las dos tablas, sus índices y el trigger de updated_at, y siembra los pilares de arranque si todavía no están. Devuelve cuántos pilares sembró. */
export async function crearTablasPilares(db: Bd, opciones: { avisar?: (texto: string) => void } = {}): Promise<{ sembrados: number }> {
  await db.query(`
    create table if not exists pilares (
      id              uuid primary key default gen_random_uuid(),
      name            text,
      color           text,
      sort_order      integer,
      deactivated_at  timestamptz,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now(),
      constraint pilares_name_chk check ("name" is not null and trim("name") <> ''),
      constraint pilares_color_chk check ("color" is null or "color" ~ '^#[0-9A-Fa-f]{6}$')
    );
  `);
  await db.query(`
    create table if not exists deal_pilares (
      id          uuid primary key default gen_random_uuid(),
      deal_id     uuid not null references deals(id) on delete cascade,
      pilar_id    uuid not null references pilares(id) on delete restrict,
      price       numeric(14,2),
      cost        numeric(14,2),
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      constraint deal_pilares_price_chk check ("price" is null or "price" >= 0),
      constraint deal_pilares_cost_chk check ("cost" is null or "cost" >= 0)
    );
  `);
  await db.query(`create unique index if not exists pilares_name_uniq on pilares (lower(trim(name)));`);
  await db.query(`create unique index if not exists deal_pilares_deal_pilar_uniq on deal_pilares (deal_id, pilar_id);`);
  await db.query(`create index if not exists deal_pilares_pilar_id_idx on deal_pilares (pilar_id);`);

  // updated_at automático, igual que el resto de las tablas (set_updated_at ya existe en la base)
  const fn = await db.query(`select 1 from pg_proc where proname = 'set_updated_at'`);
  if (fn.rows.length) {
    for (const t of ['pilares', 'deal_pilares']) {
      await db.query(`drop trigger if exists ${t}_set_updated on ${t}`);
      await db.query(`create trigger ${t}_set_updated before update on ${t} for each row execute function set_updated_at()`);
    }
  } else {
    opciones.avisar?.('⚠ no existe la función set_updated_at: updated_at no se actualizará solo');
  }

  // Los pilares de arranque: solo los que falten (por nombre, sin importar mayúsculas), al final del orden que ya haya.
  let sembrados = 0;
  for (const p of PILARES_DE_ARRANQUE) {
    const r = await db.query(
      `insert into pilares (name, color, sort_order)
       select $1::text, $2::text, coalesce((select max(sort_order) from pilares), 0) + 1
        where not exists (select 1 from pilares where lower(trim(name)) = lower($1::text))
       returning id`,
      [p.nombre, p.color],
    );
    sembrados += r.rows.length;
  }
  return { sembrados };
}

async function main() {
  const { pool } = await import('../compat/db');
  const r = await crearTablasPilares(pool as unknown as Bd, { avisar: t => console.warn(t) });
  console.log(`✅ tablas pilares y deal_pilares listas; pilares de arranque sembrados: ${r.sembrados}`);
  await pool.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
