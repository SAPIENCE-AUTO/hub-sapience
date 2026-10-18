// Pagos de management (oct 2026): projects.deal_asignado_id, el deal del que sale el Management de un proyecto cuando no es el vinculado. Un deal se
// fragmenta en varios proyectos y cada uno se lleva una parte de lo cotizado (p. ej. un programa anual de un cliente): lo que cada proyecto se lleva se suma en la
// pestaña «Deals» para ver qué porcentaje de lo cotizado ya está repartido. Es aparte de deal_vinculado_id a propósito: ese vínculo alimenta presupuesto,
// costos y cobranza del proyecto. Nulo = el proyecto sigue a su deal vinculado. Si se borra el deal, el proyecto vuelve a seguir al vinculado.
// Solo agrega una columna: no toca datos. Idempotente. No se ejecuta solo.
//
// Va ANTES de subir el código que la lee: el modelo de Projects pide esta columna en cada lectura.
// Uso: cd server && npx tsx --env-file=../.env scripts/add-projects-deal-asignado.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`alter table projects add column if not exists deal_asignado_id uuid references deals(id) on delete set null`);
  console.log('✅ projects.deal_asignado_id lista');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
