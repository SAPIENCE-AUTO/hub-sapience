import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function planFor(table) {
  console.log(`\n########## ${table} ##########`);
  const { rows: legacyBases } = await pool.query(`
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from ${table}
    where board_id ~ '^recruitment-'
  `);

  let ok = 0, skipHasData = 0, ambiguous = 0, noMatch = 0;
  const willMigrate = [];
  const willSkipHasData = [];
  const ambiguousList = [];
  const noMatchList = [];

  for (const { legacy_base } of legacyBases) {
    const { rows: boards } = await pool.query(
      `select b.id from boards b where 'recruitment-' || b.project_code || '-' || b.board_name = $1`,
      [legacy_base],
    );
    if (boards.length === 0) { noMatch++; noMatchList.push(legacy_base); continue; }
    if (boards.length > 1) { ambiguous++; ambiguousList.push(legacy_base); continue; }
    const targetId = boards[0].id;

    // dos variantes: la base sola, y con ::groups — cada una se evalúa por separado
    for (const suffix of ['', '::groups']) {
      const legacyFull = legacy_base + suffix;
      const targetFull = targetId + suffix;
      const { rows: [{ n: legacyN }] } = await pool.query(`select count(*)::int as n from ${table} where board_id = $1`, [legacyFull]);
      if (legacyN === 0) continue; // no hay filas legacy con este sufijo, nada que migrar
      const { rows: [{ n: targetN }] } = await pool.query(`select count(*)::int as n from ${table} where board_id = $1`, [targetFull]);
      if (targetN > 0) { skipHasData++; willSkipHasData.push({ legacyFull, targetFull, legacyN, targetN }); }
      else { ok++; willMigrate.push({ legacyFull, targetFull, legacyN }); }
    }
  }

  console.log(`bases legacy distintas: ${legacyBases.length}`);
  console.log(`sin match (tablero no existe): ${noMatch}`, noMatchList);
  console.log(`ambiguos (varios boards calzan): ${ambiguous}`, ambiguousList);
  console.log(`variantes (base/::groups) a migrar: ${ok}`);
  console.log(`variantes que se saltan (destino ya tiene datos): ${skipHasData}`);
  if (willSkipHasData.length) console.log('detalle de los que se saltan:', JSON.stringify(willSkipHasData, null, 2));
  const totalRowsToMigrate = willMigrate.reduce((s, x) => s + x.legacyN, 0);
  console.log(`filas totales que se migrarían: ${totalRowsToMigrate}`);
  return { willMigrate, willSkipHasData, ambiguousList, noMatchList };
}

await planFor('cell_values');
await planFor('board_columns');
process.exit(0);
