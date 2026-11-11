// Buscador de gente (nov 2026): las cuatro tablas donde se guarda lo que el buscador sabe de las preguntas de los tableros de reclutamiento (el nombre de cada pregunta y las respuestas que se repiten,
// sin datos de personas) y las búsquedas guardadas. Igual que las de Indicadores y las de la estadística por reclutador, viven fuera del pipeline de generate.py: los endpoints les hablan con
// `pool.query`. Solo agrega: no toca ninguna tabla existente. Idempotente. No se ejecuta solo (pide el sí de Sergio antes de correrlo en producción).
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-busqueda-tables.ts
import { pool } from '../compat/db';
import { SQL_TABLAS_BUSQUEDA } from '../../src/serverUtils/busqueda/almacen';

async function main() {
  await pool.query(SQL_TABLAS_BUSQUEDA);
  console.log('✅ Tablas del buscador de gente creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
