// Crea la tabla `archived_files`: inventario de los archivos que
// sharepoint-to-blob.ts movió de SharePoint a Azure Blob (oct 2026, cuota del
// tenant llena). Cada fila es un archivo que ya no está en SharePoint — en su
// lugar quedó un acceso directo `<nombre>.url` que apunta a
// /archivo/<id> del Hub, donde se reproduce con un SAS de vida corta.
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
  `);
  console.log('archived_files lista.');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
