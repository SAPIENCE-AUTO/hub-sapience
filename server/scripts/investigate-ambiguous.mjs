import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const ambiguousBases = [
  'recruitment-BARRERAS-HOGARES Y PERSONAS ACROSS NSE',
  'recruitment-ENERGÍA-STATUS RECLUTAMIENTO',
  'recruitment-TONY-Respuestas filtro',
];

for (const base of ambiguousBases) {
  const boards = await pool.query(
    `select b.id, b.created_at from boards b
     where 'recruitment-' || b.project_code || '-' || b.board_name = $1`,
    [base],
  );
  console.log(`\n=== ${base} ===`);
  for (const b of boards.rows) {
    const n = await pool.query('select count(*)::int as n from cell_values where board_id = $1', [b.id]);
    const nGroups = await pool.query('select count(*)::int as n from cell_values where board_id = $1', [`${b.id}::groups`]);
    console.log(`  board ${b.id} (creado ${b.created_at}): celdas directas=${n.rows[0].n}, celdas ::groups=${nGroups.rows[0].n}`);
  }
  const legacyN = await pool.query('select count(*)::int as n from cell_values where board_id = $1', [base]);
  const legacyGroupsN = await pool.query('select count(*)::int as n from cell_values where board_id = $1', [`${base}::groups`]);
  console.log(`  [legacy] "${base}": ${legacyN.rows[0].n} filas, "${base}::groups": ${legacyGroupsN.rows[0].n} filas`);
}

process.exit(0);
