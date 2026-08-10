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
//      verifica que el total de cell_values sea el MISMO antes/después (un
//      UPDATE de board_id nunca debe crear ni borrar filas). Se compara
//      contra el conteo tomado al inicio de esta misma corrida, no contra un
//      número fijo — un número fijo (2,517,271, cierto el día que se escribió
//      este script) se vuelve falso positivo en cuanto una carga incremental
//      legítima agrega filas nuevas, y aborta una migración que sí está bien.
//
// Exporta migrateLegacyBoardIds(client, { dryRun }) para que
// load-zite-to-postgres.ts la corra como fase automática después de cargar
// boards/cell_values/board_columns — así una recarga completa desde cero no
// depende de que alguien se acuerde de correr este script aparte.
import { Client } from 'pg';

async function planFor(client, table) {
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

async function applyFor(client, table, migrate) {
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

async function remainingLegacy(client, table) {
  const { rows } = await client.query(`
    select board_id, count(*)::int as n from ${table}
    where board_id ~ '^recruitment-'
    group by board_id order by n desc
  `);
  return rows;
}

/**
 * Corre la migración completa en una transacción sobre `client` (una
 * conexión dedicada, no el pool — necesita SET statement_timeout=0 de
 * sesión). Lanza si el conteo de cell_values cambia entre el inicio y el
 * final: un UPDATE de board_id nunca debe crear ni borrar filas.
 */
export async function migrateLegacyBoardIds(client, { dryRun = false } = {}) {
  await client.query('SET statement_timeout = 0');
  await client.query('BEGIN');
  try {
    const { rows: [{ n: totalBefore }] } = await client.query('select count(*)::bigint as n from cell_values');

    const cvPlan = await planFor(client, 'cell_values');
    const bcPlan = await planFor(client, 'board_columns');

    console.log(`   cell_values: migrando ${cvPlan.migrate.length} variantes, saltando ${cvPlan.skippedHasData.length} (destino con datos), ${cvPlan.ambiguous.length} ambiguos, ${cvPlan.noMatch.length} sin match vivo`);
    console.log(`   board_columns: migrando ${bcPlan.migrate.length} variantes, saltando ${bcPlan.skippedHasData.length} (destino con datos), ${bcPlan.ambiguous.length} ambiguos, ${bcPlan.noMatch.length} sin match vivo`);

    const cvRows = await applyFor(client, 'cell_values', cvPlan.migrate);
    const bcRows = await applyFor(client, 'board_columns', bcPlan.migrate);

    const { rows: [{ n: totalAfter }] } = await client.query('select count(*)::bigint as n from cell_values');
    if (String(totalAfter) !== String(totalBefore)) {
      throw new Error(`ABORTANDO: cell_values total cambió de ${totalBefore} a ${totalAfter} — un UPDATE de board_id no debería alterar el total`);
    }

    const cvRemaining = await remainingLegacy(client, 'cell_values');
    const bcRemaining = await remainingLegacy(client, 'board_columns');

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`   🧪 DRY RUN (ROLLBACK). Se habrían migrado: cell_values ${cvRows} filas, board_columns ${bcRows} filas.`);
    } else {
      await client.query('COMMIT');
      console.log(`   ✅ COMMIT. cell_values: ${cvRows} filas migradas. board_columns: ${bcRows} filas migradas.`);
    }

    const cvRemainingTotal = cvRemaining.reduce((s, r) => s + r.n, 0);
    const bcRemainingTotal = bcRemaining.reduce((s, r) => s + r.n, 0);
    console.log(`   celdas legacy sin migrar (esperado, ver CLAUDE.md): ${cvRemainingTotal} en cell_values, ${bcRemainingTotal} en board_columns`);

    return { cvRows, bcRows, cvRemaining, bcRemaining };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Uso standalone: node --env-file=.env server/scripts/migrate-legacy-board-ids.mjs [--dry-run]
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes('--dry-run');
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await migrateLegacyBoardIds(client, { dryRun });
  } catch (err) {
    console.error('\n❌', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
