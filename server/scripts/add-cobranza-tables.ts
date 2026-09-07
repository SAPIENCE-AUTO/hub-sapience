// Crea las 2 tablas nuevas del módulo de Cobranza (adjuntos por proceso y
// bitácora de cambios). Igual que Ejes/Prework/Personal Pendientes, estas
// tablas NUNCA existieron en Zite — viven fuera del pipeline de generate.py /
// export-zite-schema.json / schema.sql a propósito, en un script aparte que
// se corre una vez a mano. `collection_processes` sí es una tabla real de
// Zite (server/compat/schema-map.ts) y ya existe — no se toca aquí.
//
// Como no entran al sistema de modelos generados (server/compat/index.ts),
// los endpoints les hablan con `pool.query(...)` crudo en vez de un modelo.
//
// Idempotente (create table/index if not exists) para poder correrlo más de
// una vez sin romper nada.
//
// Uso: npx tsx --env-file=../../.env add-cobranza-tables.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists collection_attachments (
      id                     uuid primary key default gen_random_uuid(),
      collection_process_id uuid not null references collection_processes(id) on delete cascade,
      doc_type               text not null
        constraint collection_attachments_doc_type_chk
        check (doc_type in ('Orden de compra cliente', 'Factura', 'Comprobante de plataforma', 'Otro')),
      name                    text,
      file_url                text,
      description             text,
      uploaded_by_email       text,
      uploaded_by_name        text,
      uploaded_at             timestamptz,
      created_at              timestamptz not null default now()
    );
    create index if not exists collection_attachments_collection_process_id_idx
      on collection_attachments (collection_process_id);

    create table if not exists collection_audit_log (
      id                     uuid primary key default gen_random_uuid(),
      "timestamp"            timestamptz not null default now(),
      collection_process_id uuid references collection_processes(id) on delete set null,
      action                 text not null
        constraint collection_audit_log_action_chk
        check (action in ('Creado', 'Fase actualizada', 'Estatus actualizado',
                           'Fecha programada', 'Marcado como pagado', 'Editado',
                           'Adjunto agregado', 'Adjunto eliminado')),
      user_email              text,
      user_name               text,
      comments                text,
      project_code            text
    );
    create index if not exists collection_audit_log_collection_process_id_idx
      on collection_audit_log (collection_process_id);
  `);
  console.log('✅ Tablas del módulo Cobranza creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
