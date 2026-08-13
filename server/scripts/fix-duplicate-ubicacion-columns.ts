// 16 tableros de calendario se quedaron con el nombre de una versión anterior
// del template: "Ubicación" (texto libre) + "Ubicación (interna)" (select con
// las salas). "Ubicación (interna)" es la que reconocen saveCalendarEvent.ts /
// getLinkedEventsInfo.ts (su lista de alias nunca incluye "Ubicación" a secas)
// y la que usa ProjectsPage.tsx/WeeklyCalendar.tsx para editar — "Ubicación"
// está congelada desde la carga inicial, ningún guardado la vuelve a tocar.
//
// Antes de borrar "Ubicación": para cada evento donde el campo nativo
// calendar_events.location no coincide con la celda de "Ubicación (interna)"
// (o falta), la sincroniza — mismo criterio que syncCalendarCellValues.ts.
// Luego hace soft-delete de "Ubicación" y sus celdas (mismo patrón que
// deleteBoardColumn.ts: deletedAt en ambos, nunca se destruye nada).
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const BOARD_IDS = [
  '962083b0-0689-465a-b4e2-c9fc37add898', // 1200
  '64abe886-6676-4ae2-bf91-41e113d0aba7', // 2BO
  '5f19838f-bff1-4de7-bfda-46fdf0f22703', // 3 DE MAYO PRUEBA 2
  '6fda9ed1-54b8-4f30-93e7-7554fc2bb90b', // 3 MAYO PRUEBA
  'e9ad8336-7ecb-472a-a2f1-4375c6a87698', // ADÁN
  '1cffbdb4-4975-472b-b24c-29893104b98d', // AFICIÓN
  '9b700f5c-16c4-4010-8059-94a751d5760e', // ÁUREO
  'a3c73f2c-2c63-459c-8653-c9e40e0f7710', // CENTURY
  'ad5006b6-4682-49d8-ba32-5c7b4a3cba1f', // ENERGÍA
  '1a66b8cd-c21f-44c3-9718-6e910a82b279', // ENZIMA
  '94eff1c3-bcb7-494b-89a2-8ed2f226dd57', // LANDSCAPE
  '0a4f79bd-35d5-4dd9-9c84-f79ff6badc86', // MIST
  '0b044f9f-cc82-45b6-974d-2ec698f6b25c', // PRUEBA – DOS DOS
  '40f39119-a537-4e6a-b37d-a5667288f98f', // PRUEBA 657
  '27e6419b-de73-4655-9e46-5df38fa46536', // PRUEBAS- NO BORRAR
  '7c928366-f55d-4a82-a596-9067047e90fa', // VALOR
];

const DELETED_BY = 'Cleanup script (Claude Code) — fix-duplicate-ubicacion-columns.ts';

async function main() {
  const now = new Date().toISOString();
  let syncedCells = 0;
  let deletedColumns = 0;
  let deletedCells = 0;

  for (const boardId of BOARD_IDS) {
    const { rows: cols } = await pool.query(
      `select id, column_name from board_columns where board_id = $1 and column_name in ('Ubicación','Ubicación (interna)') and (deleted_at is null or deleted_at = '')`,
      [boardId],
    );
    const txtCol = cols.find((c) => c.column_name === 'Ubicación');
    const selCol = cols.find((c) => c.column_name === 'Ubicación (interna)');
    if (!txtCol || !selCol) {
      console.log(`⏭  ${boardId}: no tiene ambas columnas activas, se salta`);
      continue;
    }

    // ── Sincronizar: para cada evento con location nativa, asegurar que la
    // celda de "Ubicación (interna)" coincida ──────────────────────────────
    const { rows: events } = await pool.query(
      `select id, location from calendar_events where board_id::text = $1 and location is not null and location <> ''`,
      [boardId],
    );
    for (const ev of events) {
      const { rows: existingCells } = await pool.query(
        `select id, text_value from cell_values where row_id::text = $1 and column_id::text = $2`,
        [ev.id, selCol.id],
      );
      const cell = existingCells[0];
      if (!cell) {
        await pool.query(
          `insert into cell_values (board_id, row_id, column_id, text_value) values ($1, $2, $3, $4)`,
          [boardId, ev.id, selCol.id, ev.location],
        );
        syncedCells++;
      } else if (cell.text_value !== ev.location) {
        await pool.query(`update cell_values set text_value = $1 where id = $2`, [ev.location, cell.id]);
        syncedCells++;
      }
    }

    // ── Soft-delete "Ubicación" (texto) y sus celdas ────────────────────────
    const { rowCount: cellsDeleted } = await pool.query(
      `update cell_values set deleted_at = $1 where column_id::text = $2 and (deleted_at is null or deleted_at = '')`,
      [now, txtCol.id],
    );
    await pool.query(`update board_columns set deleted_at = $1, deleted_by = $2 where id = $3`, [now, DELETED_BY, txtCol.id]);
    deletedCells += cellsDeleted ?? 0;
    deletedColumns++;
    console.log(`✅ ${boardId}: sincronizadas ${events.length} celda(s) revisadas, columna "Ubicación" borrada (soft), ${cellsDeleted ?? 0} celda(s) suya(s) borradas`);
  }

  console.log(`\nTotal: ${deletedColumns} columnas "Ubicación" borradas, ${deletedCells} celdas suyas borradas, ${syncedCells} celdas de "Ubicación (interna)" sincronizadas`);
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1); });
