// Inserta las filas que se excluyeron por un CHECK que ya no existe (o que se
// amplió), y les aplica sus links si el modelo tiene. Uso:
//   npx tsx --env-file=.env server/scripts/recover-missing-rows.ts "Projects,Tasks,Board Columns"
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SCHEMA, type TableDef, type FieldDef } from '../compat/schema-map';
import { createModel } from '../compat/model';

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
  if (value === undefined || value === null || value === '') return null;
  switch (kind) {
    case 'number': return typeof value === 'number' ? value : Number(value);
    case 'boolean': return Boolean(value);
    case 'json': return JSON.stringify(value);
    case 'array': return Array.isArray(value) ? value : [value];
    default: return value;
  }
}

interface ZiteRecord { id: string; fields?: Record<string, unknown>; createdAt?: string; updatedAt?: string }

async function recoverTable(displayName: string): Promise<void> {
  const modelKey = displayName.replace(/\s+/g, '');
  const def = (SCHEMA as Record<string, TableDef>)[modelKey];
  if (!def) { console.error(`sin mapeo en SCHEMA: ${displayName}`); return; }

  const records: ZiteRecord[] = JSON.parse(await readFile(path.join(ROOT, 'datos-zite', `${displayName}.json`), 'utf8'));
  const { rows: existing } = await pool.query(`select id from "${def.table}"`);
  const existingIds = new Set(existing.map((r) => r.id));
  const missing = records.filter((r) => !existingIds.has(r.id));
  console.log(`${displayName}: ${missing.length} filas faltantes de ${records.length} exportadas`);
  if (!missing.length) return;

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
    const sql = `insert into "${def.table}" (${cols.map((c) => `"${c.col}"`).join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) on conflict (id) do nothing`;
    try { await pool.query(sql, values); inserted++; }
    catch (err) { failed++; console.error(`❌ ${displayName} id=${record.id}: ${(err as Error).message}`); }
  }
  console.log(`${displayName}: ${inserted} insertadas, ${failed} fallidas`);

  const hasLinks = Object.values(def.fields).some((f) => f.kind === 'link' || f.kind === 'linkMany');
  if (!hasLinks) return;
  const model = createModel(pool, modelKey as keyof typeof SCHEMA);
  let linked = 0;
  for (const record of missing) {
    const patch: Record<string, unknown> = {};
    for (const [label, value] of Object.entries(record.fields ?? {})) {
      const prop = toCamelProp(label);
      const f = def.fields[prop];
      if (f && (f.kind === 'link' || f.kind === 'linkMany')) patch[prop] = value;
    }
    if (!Object.keys(patch).length) continue;
    try { await model.update({ id: record.id, record: patch }); linked++; }
    catch (err) { console.error(`❌ ${displayName} links id=${record.id}: ${(err as Error).message}`); }
  }
  console.log(`${displayName}: ${linked} filas con links aplicados`);
}

async function main() {
  const names = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!names.length) { console.error('uso: recover-missing-rows.ts "Tabla1,Tabla2"'); process.exit(1); }
  for (const name of names) await recoverTable(name);
  await pool.end();
}

main().catch(async (err) => { console.error(err); await pool.end().catch(() => {}); process.exit(1); });
