// Repara el hueco de 51 Purchase Orders: fallaron por la caída temporal de la base
// (disco lleno), no por datos malos — confirmado en el log original ("Query read
// timeout", "econnrefused", "database system is not accepting connections"), no
// por ningún constraint. Inserta solo las que faltan, con ON CONFLICT DO NOTHING.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SCHEMA, type FieldDef } from '../compat/schema-map';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

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
  const def = SCHEMA.PurchaseOrders;
  const records: ZiteRecord[] = JSON.parse(await readFile(path.join(ROOT, 'datos-zite', 'Purchase Orders.json'), 'utf8'));
  const { rows: existing } = await pool.query('select id from purchase_orders');
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = records.filter((r) => !existingIds.has(r.id));
  console.log(`${missing.length} filas faltantes de ${records.length} exportadas`);

  const cols = [{ prop: 'id', col: 'id' }, ...Object.entries(def.fields)
    .filter(([prop, f]) => prop !== 'id' && f.kind !== 'link' && f.kind !== 'linkMany')
    .map(([prop, f]) => ({ prop, col: f.col }))];

  let inserted = 0;
  let failed = 0;
  for (const record of missing) {
    const row: Record<string, unknown> = { id: record.id };
    for (const [label, value] of Object.entries(record.fields ?? {})) {
      const prop = toCamelProp(label);
      const f = def.fields[prop];
      if (!f || f.kind === 'link' || f.kind === 'linkMany') continue;
      row[prop] = coerce(f.kind, value);
    }
    if (def.fields.createdAt && record.createdAt) row.createdAt = record.createdAt;
    if (def.fields.updatedAt && record.updatedAt) row.updatedAt = record.updatedAt;

    const values = cols.map((c) => row[c.prop] ?? null);
    const sql = `insert into "purchase_orders" (${cols.map((c) => `"${c.col}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (id) do nothing`;
    try {
      await pool.query(sql, values);
      inserted++;
    } catch (err) {
      failed++;
      console.error(`❌ ${record.id}: ${(err as Error).message}`);
    }
  }
  console.log(`insertadas: ${inserted}, fallidas: ${failed}`);
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1); });
