import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function planFor(table) {
  console.log(`\n########## ${table} ##########`);
  const { rows: legacyBases } = await pool.query(`
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from ${table}
    where board_id ~ '^recruitment-'
  `);

  let noMatch = [], ambiguous = [], resolved = [];

  for (const { legacy_base } of legacyBases) {
    const { rows: boards } = await pool.query(
      `select b.id, b.project_code, b.board_name, b.deleted_at
       from boards b
       where b.deleted_at is null
         and lower('recruitment-' || trim(b.project_code) || '-' || trim(b.board_name)) = lower($1)`,
      [legacy_base],
    );
    if (boards.length === 0) noMatch.push(legacy_base);
    else if (boards.length > 1) ambiguous.push({ legacy_base, candidates: boards });
    else resolved.push({ legacy_base, target: boards[0].id });
  }

  console.log(`bases legacy distintas: ${legacyBases.length}`);
  console.log(`resueltas a exactamente 1 board vivo: ${resolved.length}`);
  console.log(`sin match (ningún board vivo calza): ${noMatch.length}`, noMatch);
  console.log(`ambiguas (>1 board vivo calza): ${ambiguous.length}`);
  console.log(JSON.stringify(ambiguous, null, 2));
  return { resolved, noMatch, ambiguous };
}

await planFor('cell_values');
await planFor('board_columns');
process.exit(0);
