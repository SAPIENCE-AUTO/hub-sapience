import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table chat_conversations add column if not exists deleted_at timestamptz;`);
  console.log('✅ Columna deleted_at agregada a chat_conversations.');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
