// El área ahora se maneja como grupos reales (BoardColumns/CellValues, mismo
// motor que Reclutamiento/Calendario — ver MisPendientesPage.tsx), no como
// texto libre en la fila. Sin datos reales dependiendo de esta columna
// (feature recién lanzado), se puede tirar directo.
// Idempotente. Uso: npx tsx --env-file=../.env drop-pendientes-area-column.ts

import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pool.query(`alter table pendientes_personales drop column if exists area;`);
  console.log('✅ Columna area eliminada.');
  await pool.end();
}

main().catch(err => { console.error('❌ Error:', err); process.exit(1); });
