// Inserta al usuario que se cayó por overflow numérico (max_approval_amount =
// 99999999999999, un placeholder de "sin límite" que excede numeric(14,2)), con ese
// campo en NULL — confirmado con el negocio: ese usuario debe tener aprobación sin
// límite, así que NULL es la representación correcta, no un parche.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SCHEMA, type FieldDef } from '../compat/schema-map';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TARGET_ID = '26dac591-83a9-4f51-9b74-55e8cdf2e4f0';

function toCamelProp(label: string): string {
  const words = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

function coerce(kind: FieldDef['kind'], value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (kind) {
    case 'number': return typeof value === 'number' ? value : Number(value);
    case 'boolean': return Boolean(value);
    case 'json': return JSON.stringify(value);
    case 'array': return Array.isArray(value) ? value : [value];
    default: return value;
  }
}

interface ZiteRecord { id: string; fields?: Record<string, unknown>; createdAt?: string; updatedAt?: string }

async function main() {
  const def = SCHEMA.Users;
  const records: ZiteRecord[] = JSON.parse(await readFile(path.join(ROOT, 'datos-zite', 'Users.json'), 'utf8'));
  const record = records.find((r) => r.id === TARGET_ID);
  if (!record) throw new Error('No se encontró el registro en Users.json');

  const row: Record<string, unknown> = { id: record.id };
  for (const [label, value] of Object.entries(record.fields ?? {})) {
    const prop = toCamelProp(label);
    const f = def.fields[prop];
    if (!f || f.kind === 'link' || f.kind === 'linkMany') continue;
    row[prop] = coerce(f.kind, value);
  }
  if (def.fields.createdAt && record.createdAt) row.createdAt = record.createdAt;
  if (def.fields.updatedAt && record.updatedAt) row.updatedAt = record.updatedAt;

  row.maxApprovalAmount = null; // el fix: NULL en vez del placeholder que desborda numeric(14,2)

  const cols = [{ prop: 'id', col: 'id' }, ...Object.entries(def.fields)
    .filter(([prop, f]) => prop !== 'id' && f.kind !== 'link' && f.kind !== 'linkMany')
    .map(([prop, f]) => ({ prop, col: f.col }))];

  const values = cols.map((c) => row[c.prop] ?? null);
  const sql = `insert into "users" (${cols.map((c) => `"${c.col}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (id) do nothing`;
  await pool.query(sql, values);

  const check = await pool.query('select email, max_approval_amount from users where id = $1', [TARGET_ID]);
  console.log(check.rows[0]);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
