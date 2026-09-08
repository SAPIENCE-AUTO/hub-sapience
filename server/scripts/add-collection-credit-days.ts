import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table collection_processes add column if not exists credit_days integer`);
  console.log('✅ collection_processes.credit_days lista');
  process.exit(0);
}

main();
