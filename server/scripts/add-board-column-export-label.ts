import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table board_columns add column if not exists export_label text`);
  console.log('✅ board_columns.export_label lista');
  process.exit(0);
}

main();
