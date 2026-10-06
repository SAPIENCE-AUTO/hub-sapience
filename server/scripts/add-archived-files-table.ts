// Crea `archived_files` y `archived_file_shares`. archived_files es el
// inventario de los archivos que sharepoint-to-blob.ts movió de SharePoint a
// Azure Blob (oct 2026, cuota del tenant llena). Cada fila es un archivo que
// ya no está en SharePoint — en su lugar quedó un acceso directo
// `<nombre>.url` que apunta a /archivo/<id> del Hub, donde se reproduce con un
// SAS de vida corta.
//
// Igual que las tablas de observación (add-observation-room-tables.ts), nunca
// existió en Zite, así que vive fuera de generate.py / schema.sql y los
// endpoints le hablan con `pool.query` crudo.
//
// Idempotente. Uso: npx tsx --env-file=../.env add-archived-files-table.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`
    create table if not exists archived_files (
      id                    uuid primary key default gen_random_uuid(),
      -- null cuando la carpeta raíz de SharePoint no casó con ningún proyecto
      -- del Hub (proyectos viejos nunca dados de alta) — se asigna a mano.
      project_id            uuid references projects(id) on delete set null,
      -- carpeta raíz original en SharePoint (≈ nombre del proyecto)
      project_folder        text not null,
      file_name             text not null,
      -- ruta completa dentro de la biblioteca, incluye project_folder y file_name
      sharepoint_path       text not null,
      sharepoint_site_url   text,
      sharepoint_drive_id   text not null,
      sharepoint_item_id    text not null unique,
      -- id del acceso directo .url que quedó en su lugar
      shortcut_item_id      text,
      blob_name             text not null unique,
      size_bytes            bigint not null,
      content_type          text,
      original_modified_at  timestamptz,
      -- copied: está en Blob y aún en SharePoint · archived: ya se borró de SharePoint
      estado                text not null default 'copied'
        constraint archived_files_estado_chk check (estado in ('copied', 'archived')),
      created_at            timestamptz not null default now(),
      updated_at            timestamptz not null default now()
    );

    drop trigger if exists archived_files_set_updated on archived_files;
    create trigger archived_files_set_updated
      before update on archived_files
      for each row execute function set_updated_at();

    create index if not exists archived_files_project_idx on archived_files (project_id);
    create index if not exists archived_files_folder_idx on archived_files (project_folder);

    -- Links para clientes: token aleatorio con vigencia, revocable, con
    -- registro de uso. La página pública /grabacion/<token> los consume vía
    -- getSharedArchivedFile (authenticated: false).
    create table if not exists archived_file_shares (
      id                uuid primary key default gen_random_uuid(),
      archived_file_id  uuid not null references archived_files(id) on delete cascade,
      token             text not null unique,
      -- para quién es ("Danone – Mariana"); solo referencia interna
      nota              text,
      allow_download    boolean not null default false,
      expires_at        timestamptz not null,
      revoked_at        timestamptz,
      created_by_email  text not null,
      access_count      integer not null default 0,
      last_accessed_at  timestamptz,
      created_at        timestamptz not null default now()
    );

    create index if not exists archived_file_shares_file_idx on archived_file_shares (archived_file_id);
  `);
  console.log('archived_files y archived_file_shares listas.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
