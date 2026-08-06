// 250 de 462 Shared Views fallaron el UNIQUE de `token` porque Zite representa
// "sin token" como string vacío (""), y a diferencia de NULL, Postgres SÍ exige que
// los strings vacíos sean únicos entre sí. Reinserta las faltantes con token
// convertido a NULL cuando venía vacío — la semántica correcta para "sin token".
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
  if (value === '' ) return null; // el fix: vacío = sin valor, no un valor a repetir
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
  const def = SCHEMA.SharedViews;
  const records: ZiteRecord[] = JSON.parse(await readFile(path.join(ROOT, 'datos-zite', 'Shared Views.json'), 'utf8'));
  const { rows: existing } = await pool.query('select id from shared_views');
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
    const sql = `insert into "shared_views" (${cols.map((c) => `"${c.col}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (id) do nothing`;
    try {
      await pool.query(sql, values);
      inserted++;
    } catch (err) {
      failed++;
      console.error(`❌ ${record.id}: ${(err as Error).message}`);
    }
  }
  console.log(`insertadas: ${inserted}, fallidas: ${failed}`);
  const final = await pool.query('select count(*)::int as n from shared_views');
  console.log('total final en shared_views:', final.rows[0].n);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
