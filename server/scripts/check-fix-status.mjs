import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const r = await pool.query(`
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conname in (
    'projects_status_chk','tasks_status_chk','board_columns_column_type_chk',
    'recruitment_rows_status_chk','purchase_orders_payment_terms_chk'
  )
  order by conname
`);
console.log(JSON.stringify(r.rows, null, 2));

const idx = await pool.query(`select indexname, indexdef from pg_indexes where tablename='shared_views'`);
console.log(JSON.stringify(idx.rows, null, 2));

process.exit(0);
