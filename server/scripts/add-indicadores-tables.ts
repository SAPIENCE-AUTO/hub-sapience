// Módulo «Indicadores» (oct 2026): las dos tablas donde se guarda el último cálculo de cada área (para que la pantalla abra al instante) y
// las metas que Sergio escribe. Igual que las de Swipe, viven fuera del pipeline de generate.py: los endpoints les hablan con `pool.query`.
// Solo agrega: no toca ninguna tabla existente. Idempotente. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/add-indicadores-tables.ts
import { pool } from '../compat/db';

async function main() {
  await pool.query(`
    -- Una fila por área con el último cálculo completo (el JSON ya trae los proyectos contados; la pantalla suma por periodo).
    create table if not exists indicadores_calculos (
      area          text primary key,
      calculado_en  timestamptz not null default now(),
      calculado_por text,
      datos         jsonb not null
    );

    -- La meta de cada indicador (por ejemplo «no elegibles que entran: máximo 5 %»).
    create table if not exists indicadores_metas (
      area            text not null,
      indicador       text not null,
      valor           numeric not null,
      actualizado_por text,
      updated_at      timestamptz not null default now(),
      primary key (area, indicador)
    );
  `);
  console.log('✅ Tablas de indicadores creadas (o ya existían).');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
