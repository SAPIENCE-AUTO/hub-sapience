import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table tasks add column if not exists deleted_at timestamptz`);
  await pool.query(`alter table tasks add column if not exists deleted_by text`);
  console.log('✅ tasks.deleted_at / tasks.deleted_by listas');
  process.exit(0);
}

main();
