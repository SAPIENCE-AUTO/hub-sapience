import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const other = await pool.query(`
  select board_id, count(*) as n from cell_values
  where board_id !~ '^recruitment-' and board_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  group by board_id order by n desc limit 20
`);
console.log('otros formatos (cell_values):', JSON.stringify(other.rows, null, 2));

const otherBc = await pool.query(`
  select board_id, count(*) as n from board_columns
  where board_id !~ '^recruitment-' and board_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  group by board_id order by n desc limit 20
`);
console.log('otros formatos (board_columns):', JSON.stringify(otherBc.rows, null, 2));

// ¿project_code+board_name son únicos en boards?
const dupBoards = await pool.query(`
  select project_code, board_name, count(*) as n
  from boards
  group by project_code, board_name
  having count(*) > 1
  order by n desc limit 10
`);
console.log('project_code+board_name duplicados en boards:', JSON.stringify(dupBoards.rows, null, 2));

process.exit(0);
