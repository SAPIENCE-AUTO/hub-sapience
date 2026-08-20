// Agrega las 3 columnas de la Sala de observación (botón "Crear stream" +
// dos columnas de Link) a los tableros de calendario que YA EXISTEN.
// `ensureCalendarDefaultColumns` (src/serverUtils/calendarDefaults.ts) solo
// crea columnas para tableros nuevos sin ninguna columna todavía — este
// script es el backfill para los que ya estaban en uso.
//
// Idempotente: por tablero, solo inserta las columnas de las 3 que le
// falten (busca por nombre, ignorando las borradas).
//
// Uso: npx tsx --env-file=../.env add-observation-board-columns.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const NEW_COLUMNS = [
  {
    columnName: 'Crear stream',
    columnType: 'Botón',
    columnOrder: 13000,
    optionsJson: JSON.stringify({ action: 'create_observation_stream', label: 'Crear stream', variant: 'default' }),
  },
  { columnName: 'Link Zoom', columnType: 'Link', columnOrder: 14000, optionsJson: null },
  { columnName: 'Link de observación', columnType: 'Link', columnOrder: 15000, optionsJson: null },
];

async function main() {
  const { rows: boards } = await pool.query(
    `select id from boards where board_type = 'calendar' and deleted_at is null`,
  );
  console.log(`${boards.length} tablero(s) de calendario encontrados.`);

  let created = 0;
  for (const board of boards) {
    const { rows: existing } = await pool.query(
      `select column_name from board_columns where board_id = $1 and deleted_at is null`,
      [board.id],
    );
    const existingNames = new Set(existing.map((r) => r.column_name));

    for (const col of NEW_COLUMNS) {
      if (existingNames.has(col.columnName)) continue;
      await pool.query(
        `insert into board_columns (board_id, column_name, column_type, column_order, options_json)
         values ($1, $2, $3, $4, $5)`,
        [board.id, col.columnName, col.columnType, col.columnOrder, col.optionsJson],
      );
      created++;
    }
  }

  console.log(`✅ ${created} columna(s) nueva(s) creada(s) en total.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
