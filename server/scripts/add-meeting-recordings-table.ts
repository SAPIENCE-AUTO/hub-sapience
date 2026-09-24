// Módulo de Minutas / notetaker (sep 2026) — tabla nueva, no viene de Zite.
// El DDL declarativo ya vive en schema.sql (generado por generate.py, ver
// EXTRA_TABLES ahí) — este script hace el ALTER real sobre la base ya
// existente. No se ejecuta solo.
//
// Uso: npx tsx --env-file=../.env add-meeting-recordings-table.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists meeting_recordings (
      id                    uuid primary key default gen_random_uuid(),
      recall_bot_id         text,
      subject               text,
      owner_email           text,
      meeting_start         timestamptz,
      meeting_end           timestamptz,
      status                text,
      meeting_type          text,
      recall_download_url   text,
      mux_asset_id          text,
      mux_playback_id       text,
      assembly_transcript_id text,
      transcript            text,
      transcript_data       jsonb,
      summary_json          jsonb,
      project_id            uuid references projects(id) on delete set null,
      deal_id               uuid references deals(id) on delete set null,
      created_at            timestamptz not null default now(),
      updated_at            timestamptz not null default now()
    );
  `);
  await pool.query(`
    drop trigger if exists meeting_recordings_set_updated on meeting_recordings;
    create trigger meeting_recordings_set_updated before update on meeting_recordings for each row execute function set_updated_at();
  `);
  await pool.query(`create unique index if not exists meeting_recordings_recall_bot_id_uniq on meeting_recordings (recall_bot_id);`);
  await pool.query(`create index if not exists meeting_recordings_project_id_idx on meeting_recordings (project_id);`);
  await pool.query(`create index if not exists meeting_recordings_deal_id_idx on meeting_recordings (deal_id);`);

  console.log('✅ tabla meeting_recordings creada');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
