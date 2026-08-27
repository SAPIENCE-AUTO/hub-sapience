import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table users add column if not exists home_page text;`);
  console.log('✅ Columna home_page agregada a users.');

  const r = await pool.query(
    `update users set home_page = '/mis-pendientes' where lower(email) = lower('sergio@sapience.com.mx')`,
  );
  console.log(`✅ home_page = '/mis-pendientes' para sergio@sapience.com.mx (${r.rowCount} fila actualizada).`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
