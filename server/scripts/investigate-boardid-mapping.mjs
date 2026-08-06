import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Para cada board_id legacy DISTINTO (sin el sufijo ::groups), cuántos boards reales
// calzan con 'recruitment-' || project_code || '-' || board_name.
const r = await pool.query(`
  with legacy as (
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from cell_values
    where board_id ~ '^recruitment-'
  ),
  matched as (
    select l.legacy_base, count(b.id) as n_matches
    from legacy l
    left join boards b
      on 'recruitment-' || b.project_code || '-' || b.board_name = l.legacy_base
    group by l.legacy_base
  )
  select
    count(*) filter (where n_matches = 0) as sin_match,
    count(*) filter (where n_matches = 1) as un_match,
    count(*) filter (where n_matches > 1) as ambiguos,
    count(*) as total_distintos
  from matched
`);
console.log('resumen board_id legacy distintos (cell_values, base sin ::groups):', r.rows[0]);

const ambiguos = await pool.query(`
  with legacy as (
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from cell_values
    where board_id ~ '^recruitment-'
  )
  select l.legacy_base, b.id, b.project_code, b.board_name, b.created_at
  from legacy l
  join boards b
    on 'recruitment-' || b.project_code || '-' || b.board_name = l.legacy_base
  where l.legacy_base in (
    select legacy_base from (
      select l2.legacy_base, count(b2.id) as n
      from legacy l2
      join boards b2 on 'recruitment-' || b2.project_code || '-' || b2.board_name = l2.legacy_base
      group by l2.legacy_base
      having count(b2.id) > 1
    ) x
  )
  order by l.legacy_base, b.created_at
  limit 40
`);
console.log('detalle de ambiguos (primeros):', JSON.stringify(ambiguos.rows, null, 2));

const sinMatch = await pool.query(`
  with legacy as (
    select distinct regexp_replace(board_id, '::groups$', '') as legacy_base
    from cell_values
    where board_id ~ '^recruitment-'
  )
  select l.legacy_base
  from legacy l
  left join boards b on 'recruitment-' || b.project_code || '-' || b.board_name = l.legacy_base
  where b.id is null
  limit 20
`);
console.log('muestras sin match:', JSON.stringify(sinMatch.rows, null, 2));

process.exit(0);
