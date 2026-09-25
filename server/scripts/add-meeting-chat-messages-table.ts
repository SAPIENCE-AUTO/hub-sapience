// Chat con IA sobre la transcripción de una minuta (sep 2026) — puerto de
// FloatingTranscriptChat.tsx/ChatMessages de Sharpli. El DDL declarativo ya
// vive en schema.sql (generado por generate.py, ver EXTRA_TABLES ahí) — este
// script hace el CREATE real sobre la base ya existente. No se ejecuta solo.
//
// Uso: npx tsx --env-file=../.env add-meeting-chat-messages-table.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    create table if not exists meeting_chat_messages (
      id                    uuid primary key default gen_random_uuid(),
      meeting_recording_id  uuid not null references meeting_recordings(id) on delete cascade,
      role                  text not null check (role in ('user', 'assistant')),
      content               text not null,
      created_at            timestamptz not null default now()
    );
  `);
  await pool.query(`create index if not exists meeting_chat_messages_recording_idx on meeting_chat_messages (meeting_recording_id, created_at);`);

  console.log('✅ tabla meeting_chat_messages creada');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
