// Migra los board_id legacy ("recruitment-{project_code}-{board_name}", con
// sufijo opcional "::groups") a la UUID real de boards, en cell_values y
// board_columns. Reglas:
//   1. Solo cruza contra boards con deleted_at is null.
//   2. Comparación en minúsculas y con project_code/board_name recortados
//      (trim) — no un split posicional, project_code/board_name pueden
//      contener guiones.
//   3. Si el legacy_base no calza con ningún board vivo, o calza con MÁS DE
//      UNO (duplicados vivos, ej. ENERGÍA/STATUS RECLUTAMIENTO), se deja
//      intacto — no se adivina.
//   4. Si el destino (UUID resuelto, con el mismo sufijo ::groups preservado)
//      ya tiene filas propias, se deja el legacy intacto — no se mezclan datos.
//   5. Todo en una transacción con statement_timeout = 0; antes de COMMIT se
//      verifica que el total de cell_values no haya cambiado.
import { Client } from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');
const EXPECTED_CELL_VALUES_TOTAL = 2_517_271;
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET statement_timeout = 0');

async function planFor(table) {
  const { rows: legacyBases } = await client.query(`
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from ${table}
    where board_id ~ '^recruitment-'
  `);

  const migrate = [];
  const skippedHasData = [];
  const ambiguous = [];
  const noMatch = [];

  for (const { legacy_base } of legacyBases) {
    const { rows: boards } = await client.query(
      `select b.id from boards b
       where b.deleted_at is null
         and lower('recruitment-' || trim(b.project_code) || '-' || trim(b.board_name)) = lower($1)`,
      [legacy_base],
    );
    if (boards.length === 0) { noMatch.push(legacy_base); continue; }
    if (boards.length > 1) { ambiguous.push(legacy_base); continue; }
    const targetId = boards[0].id;

    for (const suffix of ['', '::groups']) {
      const legacyFull = legacy_base + suffix;
      const targetFull = targetId + suffix;
      const { rows: [{ n: legacyN }] } = await client.query(`select count(*)::int as n from ${table} where board_id = $1`, [legacyFull]);
      if (legacyN === 0) continue;
      const { rows: [{ n: targetN }] } = await client.query(`select count(*)::int as n from ${table} where board_id = $1`, [targetFull]);
      if (targetN > 0) skippedHasData.push({ legacyFull, targetFull, legacyN, targetN });
      else migrate.push({ legacyFull, targetFull, legacyN });
    }
  }
  return { migrate, skippedHasData, ambiguous, noMatch };
}

async function applyFor(table, migrate) {
  let totalRows = 0;
  for (const { legacyFull, targetFull, legacyN } of migrate) {
    const res = await client.query(`update ${table} set board_id = $1 where board_id = $2`, [targetFull, legacyFull]);
    if (res.rowCount !== legacyN) {
      throw new Error(`${table}: esperaba actualizar ${legacyN} filas de "${legacyFull}", actualizó ${res.rowCount}`);
    }
    totalRows += res.rowCount;
  }
  return totalRows;
}

async function remainingLegacy(table) {
  const { rows } = await client.query(`
    select board_id, count(*)::int as n from ${table}
    where board_id ~ '^recruitment-'
    group by board_id order by n desc
  `);
  return rows;
}

try {
  await client.query('BEGIN');

  const cvPlan = await planFor('cell_values');
  const bcPlan = await planFor('board_columns');

  console.log(`cell_values: migrando ${cvPlan.migrate.length} variantes, saltando ${cvPlan.skippedHasData.length} (destino con datos), ${cvPlan.ambiguous.length} ambiguos, ${cvPlan.noMatch.length} sin match vivo`);
  console.log(`board_columns: migrando ${bcPlan.migrate.length} variantes, saltando ${bcPlan.skippedHasData.length} (destino con datos), ${bcPlan.ambiguous.length} ambiguos, ${bcPlan.noMatch.length} sin match vivo`);

  const cvRows = await applyFor('cell_values', cvPlan.migrate);
  const bcRows = await applyFor('board_columns', bcPlan.migrate);

  const { rows: [{ n: finalTotal }] } = await client.query('select count(*)::bigint as n from cell_values');
  console.log(`cell_values total tras la migración: ${finalTotal} (esperado ${EXPECTED_CELL_VALUES_TOTAL})`);

  if (String(finalTotal) !== String(EXPECTED_CELL_VALUES_TOTAL)) {
    throw new Error(`ABORTANDO: cell_values total = ${finalTotal}, esperado ${EXPECTED_CELL_VALUES_TOTAL}`);
  }

  const cvRemaining = await remainingLegacy('cell_values');
  const bcRemaining = await remainingLegacy('board_columns');

  if (DRY_RUN) {
    await client.query('ROLLBACK');
    console.log(`\n🧪 DRY RUN (ROLLBACK). Se habrían migrado: cell_values ${cvRows} filas, board_columns ${bcRows} filas.`);
  } else {
    await client.query('COMMIT');
    console.log(`\n✅ COMMIT. cell_values: ${cvRows} filas migradas. board_columns: ${bcRows} filas migradas.`);
  }

  console.log('\n── lo que queda en legacy (cell_values) ──');
  console.log(JSON.stringify(cvRemaining, null, 2));
  console.log(`total celdas legacy restantes: ${cvRemaining.reduce((s, r) => s + r.n, 0)}`);

  console.log('\n── lo que queda en legacy (board_columns) ──');
  console.log(JSON.stringify(bcRemaining, null, 2));
} catch (err) {
  await client.query('ROLLBACK');
  console.error('\n❌ ROLLBACK:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
