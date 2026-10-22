// Lista de eventos (oct 2026): calendar_events.row_order, el lugar de cada evento dentro de su grupo para poder reordenarlos arrastrando. Antes los eventos no tenían
// orden propio y salían por fecha de creación. Nulo = sin acomodar a mano: el evento va al final de su grupo, en orden de creación; los que ya existen quedan igual.
// Solo agrega una columna: no toca datos. Idempotente. No se ejecuta solo.
//
// Va ANTES de subir el código que la lee: el modelo de CalendarEvents pide esta columna en cada lectura.
// Uso: cd server && npx tsx --env-file=../.env scripts/add-calendar-events-row-order.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table calendar_events add column if not exists row_order numeric`);
  console.log('✅ calendar_events.row_order lista');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
