// Agrega row_order a pendientes_personales para permitir reordenar a mano por
// drag-and-drop en Mis Pendientes (antes solo se ordenaba automático: resueltos
// al final, luego por fecha de creación). Mismo patrón que las demás columnas
// agregadas después de la creación original de la tabla
// (add-pendientes-notas-column.ts, add-pendientes-proyecto-column.ts, etc.) —
// ALTER TABLE suelto, no pasa por generate.py porque esta tabla nunca existió
// en Zite.
//
// El backfill asigna row_order según el orden que ya se ve hoy (por usuario,
// created_at desc, con huecos de 1000) para que activar la columna no cambie
// de golpe el orden visual de los pendientes existentes.
//
// Idempotente. Uso: npx tsx --env-file=../.env add-pendientes-row-order-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table pendientes_personales add column if not exists row_order integer`);

  await pool.query(`
    update pendientes_personales p
       set row_order = sub.rn * 1000
      from (
        select id, row_number() over (partition by user_id order by created_at desc) as rn
          from pendientes_personales
      ) sub
     where p.id = sub.id and p.row_order is null
  `);

  await pool.query(`alter table pendientes_personales alter column row_order set not null`);
  await pool.query(`alter table pendientes_personales alter column row_order set default 0`);

  console.log('✅ pendientes_personales.row_order lista (columna + backfill).');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
