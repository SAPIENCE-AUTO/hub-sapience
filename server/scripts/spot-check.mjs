import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

for (const [projectCode, needle] of [['FESTIVAL', 'status'], ['NARANJA', 'pruebas hub'], ['DRY', 'status general'], ['BRIDGE', 'bridge']]) {
  const r = await pool.query(
    `select id, project_code, board_name, deleted_at from boards where lower(project_code) = lower($1) order by board_name`,
    [projectCode],
  );
  console.log(`\n=== boards con project_code = ${projectCode} ===`);
  console.log(JSON.stringify(r.rows, null, 2));
}
process.exit(0);
