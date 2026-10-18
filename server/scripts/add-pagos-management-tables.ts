// Módulo «Pagos de análisis / management» (oct 2026): las dos tablas donde se guarda, por proyecto, el monto de management que se reparte (si no es
// el del deal) y entre quién se reparte, con qué porcentaje. Igual que las de Indicadores, viven fuera del pipeline de generate.py: los endpoints
// les hablan con `pool.query`. Solo agrega: no toca ninguna tabla existente. Idempotente. No se ejecuta solo.
//
// Si se borra un proyecto el reparto se conserva (project_id queda en null y project_codigo guarda cómo se llamaba): es plata que se debe.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-pagos-management-tables.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    -- Una fila por proyecto con reparto. presupuesto en null = vale el monto de management que dice el deal; moneda solo va si se puso un presupuesto a mano.
    create table if not exists pagos_management_proyectos (
      id              uuid primary key default gen_random_uuid(),
      project_id      uuid unique references projects(id) on delete set null,
      project_codigo  text not null,
      presupuesto     numeric(14,2),
      moneda          text,
      actualizado_por text,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now(),
      constraint pagos_management_proyectos_moneda_chk check (moneda is null or moneda in ('MXN', 'USD', 'EUR')),
      constraint pagos_management_proyectos_presupuesto_chk check (presupuesto is null or presupuesto >= 0),
      constraint pagos_management_proyectos_moneda_presupuesto_chk check (moneda is null or presupuesto is not null)
    );

    -- Las personas del reparto de cada proyecto: un usuario interno (user_id) o una persona externa (solo nombre), con su porcentaje.
    -- nombre guarda cómo se llamaba al repartir, para que el reparto se entienda aunque el usuario se borre.
    create table if not exists pagos_management_personas (
      id          uuid primary key default gen_random_uuid(),
      reparto_id  uuid not null references pagos_management_proyectos(id) on delete cascade,
      user_id     uuid references users(id) on delete set null,
      nombre      text not null,
      externo     boolean not null default false,
      porcentaje  numeric(10,6) not null,
      orden       integer not null default 0,
      created_at  timestamptz not null default now(),
      constraint pagos_management_personas_porcentaje_chk check (porcentaje > 0 and porcentaje <= 100)
    );
    create unique index if not exists pagos_management_personas_usuario_uniq on pagos_management_personas (reparto_id, user_id) where user_id is not null;
    create index if not exists pagos_management_personas_reparto_idx on pagos_management_personas (reparto_id);
  `);
  console.log('✅ Tablas de pagos de management creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
