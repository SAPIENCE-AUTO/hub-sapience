// Tabla Clients (sep 2026) — primera tabla que no viene del export de Zite.
// Homologa el concepto de "cliente" (hoy texto libre suelto y repetido en
// Deals, Projects, CRMItems, Invoices y CollectionProcesses, sin ID) con la
// tabla `clients` real que ya tiene Sharpli, vía `sharpli_client_id`.
//
// Este script hace el ALTER real sobre la base ya existente — el DDL
// declarativo generado (schema.sql / server/compat/schema-map.ts / types.ts)
// ya refleja este estado para una carga desde cero, generado por
// generate.py (ver EXTRA_TABLES / EXTRA_COLUMNS ahí). No se ejecuta solo.
//
// El backfill de los ~60 nombres de cliente ya en uso hoy vive aparte en
// server/scripts/backfill-clients.ts — correr este script primero.
//
// Uso: npx tsx --env-file=../.env add-clients-table.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists clients (
      id                 uuid primary key default gen_random_uuid(),
      name               text,
      sharpli_client_id  uuid,
      created_at         timestamptz not null default now(),
      updated_at         timestamptz not null default now()
    );
  `);
  await pool.query(`
    create or replace function set_updated_at() returns trigger as $$
    begin new.updated_at = now(); return new; end;
    $$ language plpgsql;
  `);
  await pool.query(`
    drop trigger if exists clients_set_updated on clients;
    create trigger clients_set_updated before update on clients for each row execute function set_updated_at();
  `);
  await pool.query(`
    create unique index if not exists clients_name_uniq on clients (lower(trim(name)));
  `);

  const tables = ['deals', 'projects', 'crm_items', 'invoices', 'collection_processes'];
  for (const t of tables) {
    await pool.query(`alter table ${t} add column if not exists client_id uuid references clients(id) on delete set null;`);
    console.log(`✅ ${t}.client_id`);
  }

  console.log('✅ tabla clients creada + client_id agregado a las 5 tablas');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
