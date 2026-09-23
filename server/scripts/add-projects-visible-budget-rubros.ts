import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table projects add column if not exists visible_budget_rubros text`);
  console.log('✅ projects.visible_budget_rubros lista');
  process.exit(0);
}

main();
