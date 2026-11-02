// Catálogo de clientes (nov 2026): razones sociales, condiciones de cobro y contactos. El DDL declarativo ya vive en schema.sql (generado por generate.py,
// ver EXTRA_TABLES) — este script hace el CREATE real sobre la base ya existente y agrega la columna que liga cada proceso de cobranza a su razón social.
// Idempotente. No se ejecuta solo, y no toca `clients` (que comparte nombre y enlace con Sharpli).
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-clientes-ficha-tables.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists client_entities (
      id                uuid primary key default gen_random_uuid(),
      client_id         uuid references clients(id) on delete set null,
      legal_name        text,
      rfc               text,
      tax_regime        text,
      postal_code       text,
      cfdi_use          text,
      payment_method    text,
      payment_form      text,
      billing_emails    text,
      credit_days       integer,
      requires_po       boolean,
      requires_portal   boolean,
      portal_url        text,
      requires_gr       boolean,
      requires_proforma boolean,
      process_notes     text,
      deactivated_at    timestamptz,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now(),
      constraint client_entities_payment_method_chk check ("payment_method" is null or "payment_method" in ('PUE', 'PPD')),
      constraint client_entities_credit_days_chk check ("credit_days" is null or "credit_days" >= 0)
    );
  `);
  await pool.query(`
    create table if not exists client_contacts (
      id            uuid primary key default gen_random_uuid(),
      client_id     uuid references clients(id) on delete set null,
      entity_id     uuid references client_entities(id) on delete set null,
      name          text,
      email         text,
      phone         text,
      contact_role  text,
      notes         text,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now(),
      constraint client_contacts_role_chk check ("contact_role" is null or "contact_role" in ('Recibe facturas', 'Libera pagos', 'Seguimiento', 'Otro'))
    );
  `);
  await pool.query(`alter table collection_processes add column if not exists client_entity_id uuid references client_entities(id) on delete set null;`);

  await pool.query(`create unique index if not exists client_entities_client_rfc_uniq on client_entities (client_id, upper(rfc)) where rfc is not null and rfc <> '';`);
  await pool.query(`create index if not exists client_entities_client_id_idx on client_entities (client_id);`);
  await pool.query(`create index if not exists client_contacts_client_id_idx on client_contacts (client_id);`);
  await pool.query(`create index if not exists collection_processes_client_entity_id_idx on collection_processes (client_entity_id);`);

  // updated_at automático, igual que el resto de las tablas (set_updated_at ya existe en la base)
  const fn = await pool.query(`select 1 from pg_proc where proname = 'set_updated_at'`);
  if (fn.rowCount) {
    for (const t of ['client_entities', 'client_contacts']) {
      await pool.query(`drop trigger if exists ${t}_set_updated on ${t}`);
      await pool.query(`create trigger ${t}_set_updated before update on ${t} for each row execute function set_updated_at()`);
    }
  } else {
    console.warn('⚠ no existe la función set_updated_at: updated_at no se actualizará solo');
  }
  console.log('✅ tablas client_entities y client_contacts listas, y collection_processes.client_entity_id agregada');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
