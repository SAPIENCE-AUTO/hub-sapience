// Estadística por reclutador (nov 2026): las dos tablas donde se guarda quién es quién cuando los participantes escriben el nombre de distintas
// formas («manuel», «manel», «manu»). Igual que las de Indicadores, viven fuera del pipeline de generate.py: los endpoints les hablan con
// `pool.query`. Solo agrega: no toca ninguna tabla existente. Idempotente. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-reclutadores-tables.ts
import { pool } from '../compat/db';
import { SQL_TABLAS_RECLUTADORES } from '../../src/serverUtils/indicadores/reclutadoresAlmacen';

async function main() {
  await pool.query(SQL_TABLAS_RECLUTADORES);
  console.log('✅ Tablas de reclutadores creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
