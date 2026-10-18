// Módulo «Pagos de análisis / management» (oct 2026): las tablas donde se guarda, por proyecto, el presupuesto que se reparte (qué rubros de la
// cotización lo forman y, si no valen lo del deal, cuánto) y entre quién se reparte, con qué porcentaje. Igual que las de Indicadores, viven fuera
// del pipeline de generate.py: los endpoints les hablan con `pool.query`. Solo agrega o afloja: no borra nada. Idempotente. No se ejecuta solo.
//
// Si se borra un proyecto el reparto se conserva (project_id queda en null y project_codigo guarda cómo se llamaba): es plata que se debe.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-pagos-management-tables.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    -- Una fila por proyecto con reparto. moneda va solo si algún rubro tiene un monto puesto a mano; si no, valen la moneda y los montos del deal.
    -- presupuesto es de la primera versión (un solo monto, el de Management): ya no se usa, el presupuesto sale de pagos_management_rubros.
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
      constraint pagos_management_proyectos_presupuesto_chk check (presupuesto is null or presupuesto >= 0)
    );
    -- La primera versión exigía un presupuesto cuando había moneda; con rubros ya no aplica.
    alter table pagos_management_proyectos drop constraint if exists pagos_management_proyectos_moneda_presupuesto_chk;

    -- Los rubros de la cotización que forman el presupuesto de un reparto. monto en null = vale lo que dice el deal de ese rubro.
    create table if not exists pagos_management_rubros (
      id          uuid primary key default gen_random_uuid(),
      reparto_id  uuid not null references pagos_management_proyectos(id) on delete cascade,
      rubro       text not null,
      monto       numeric(14,2),
      orden       integer not null default 0,
      created_at  timestamptz not null default now(),
      constraint pagos_management_rubros_rubro_chk check (rubro in ('Management', 'Reclutamiento e incentivos', 'Moderación', 'Logística y operación', 'Back office')),
      constraint pagos_management_rubros_monto_chk check (monto is null or monto >= 0),
      constraint pagos_management_rubros_reparto_rubro_uniq unique (reparto_id, rubro)
    );
    -- Los repartos de la primera versión tenían un solo presupuesto, el de Management: pasa a ser su renglón de Management.
    insert into pagos_management_rubros (reparto_id, rubro, monto, orden)
      select r.id, 'Management', r.presupuesto, 0
        from pagos_management_proyectos r
       where not exists (select 1 from pagos_management_rubros x where x.reparto_id = r.id);

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
      constraint pagos_management_personas_porcentaje_chk check (porcentaje > 0 and porcentaje <= 1000)
    );
    -- La primera versión no dejaba pasar de 100 %; ahora se puede pasar (el reparto avisa), con un tope de 1000 % por persona contra errores de dedo.
    alter table pagos_management_personas drop constraint if exists pagos_management_personas_porcentaje_chk;
    alter table pagos_management_personas add constraint pagos_management_personas_porcentaje_chk check (porcentaje > 0 and porcentaje <= 1000);
    create unique index if not exists pagos_management_personas_usuario_uniq on pagos_management_personas (reparto_id, user_id) where user_id is not null;
    create index if not exists pagos_management_personas_reparto_idx on pagos_management_personas (reparto_id);
  `);
  console.log('✅ Tablas de pagos de management creadas o al día (y repartos anteriores pasados a rubros).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
