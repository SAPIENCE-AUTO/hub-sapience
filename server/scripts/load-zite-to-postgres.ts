// Carga los JSON de datos-zite/ (producidos por export-zite-tables.mjs) a Postgres,
// usando el mismo mapeo de columnas que server/compat/schema-map.ts.
//
// Dos fases, porque hay referencias circulares entre tablas (Users <-> Deals <->
// Projects, etc.) y las FK de schema.sql no son deferrable:
//   Fase 1 — inserta cada fila con sus columnas escalares y el id ORIGINAL de Zite
//            (preservarlo es lo que permite que los links de la fase 2 resuelvan).
//            Los campos link/linkMany se omiten aquí.
//   Fase 2 — ahora que todas las filas de todas las tablas ya existen, aplica los
//            link (FK simple) y linkMany (tablas puente) reusando
//            createModel(...).update(), que ya sabe traducirlos (ver compat/model.ts).
//
// Reanudable/re-ejecutable: fase 1 usa `on conflict (id) do nothing`, así que
// correrlo de nuevo no duplica filas; fase 2 simplemente vuelve a aplicar los
// mismos links (idempotente).
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env server/scripts/load-zite-to-postgres.ts
//   npx tsx --env-file=.env server/scripts/load-zite-to-postgres.ts --only=Users,Deals,Projects

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SCHEMA, type TableDef, type FieldDef } from '../compat/schema-map';
import { createModel } from '../compat/model';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'datos-zite');
const BATCH_SIZE = 2000;

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. Corre con:\n  npx tsx --env-file=.env server/scripts/load-zite-to-postgres.ts');
  process.exit(1);
}

// query_timeout/statement_timeout: sin esto, una conexión del pooler que muere en
// silencio (visto en vivo: 20+ min colgado sin avanzar) deja el await esperando para
// siempre. Con el timeout, se convierte en un error que el catch de cada función ya
// maneja (reintentable al volver a correr el script, gracias a on-conflict-do-nothing).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
  keepAlive: true,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
  query_timeout: 60_000,
});

const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;

// El nombre de columna NUNCA se adivina: se toma tal cual de SCHEMA (server/compat/schema-map.ts),
// la misma fuente que generó schema.sql. Lo único que hay que resolver es a qué `prop` de SCHEMA
// corresponde el label humano que trae el export de Zite ("First Name", "Líder", ...) — y eso es
// exactamente camelCase(label), porque generate.py generó los props del mapa a partir de esos
// mismos labels. Se verifica contra `def.fields` real, no se asume.
function toCamelProp(label: string): string {
  const words = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // Líder -> Lider
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

function coerce(kind: FieldDef['kind'], value: unknown): unknown {
  if (value === undefined || value === null) return null;
  switch (kind) {
    case 'number': return typeof value === 'number' ? value : Number(value);
    case 'boolean': return Boolean(value);
    case 'json': return JSON.stringify(value);
    case 'array': return Array.isArray(value) ? value : [value];
    default: return value; // text/date/datetime pasan tal cual; Postgres castea el texto ISO
  }
}

interface ZiteRecord { id: string; fields?: Record<string, unknown>; createdAt?: string; updatedAt?: string }
interface TableCtx { name: string; modelKey: string; def: TableDef }

async function loadTableList(): Promise<string[]> {
  const metaPath = path.join(DATA_DIR, '_meta.json');
  if (!(await exists(metaPath))) {
    throw new Error('Falta datos-zite/_meta.json — corre primero scripts/export-zite-tables.mjs');
  }
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  return meta.tables.map((t: { name: string }) => t.name);
}

/** Resuelve un label humano de Zite ("First Name", "Líder", ...) al FieldDef real de SCHEMA. */
function resolveField(t: TableCtx, label: string): [string, FieldDef] | null {
  const prop = toCamelProp(label);
  const f = t.def.fields[prop];
  return f ? [prop, f] : null;
}

function rowFromRecord(t: TableCtx, record: ZiteRecord): Record<string, unknown> {
  const row: Record<string, unknown> = { id: record.id };
  for (const [label, value] of Object.entries(record.fields ?? {})) {
    const resolved = resolveField(t, label);
    if (!resolved) continue;
    const [prop, f] = resolved;
    if (f.kind === 'link' || f.kind === 'linkMany') continue;
    row[prop] = coerce(f.kind, value);
  }
  if (t.def.fields.createdAt && record.createdAt) row.createdAt = record.createdAt;
  if (t.def.fields.updatedAt && record.updatedAt) row.updatedAt = record.updatedAt;
  return row;
}

interface ColSpec { prop: string; col: string }

async function insertBatch(table: string, cols: ColSpec[], rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const values: unknown[] = [];
  const placeholders = rows.map((row, ri) => {
    const base = ri * cols.length;
    cols.forEach((c) => values.push(row[c.prop] ?? null));
    return `(${cols.map((_, ci) => `$${base + ci + 1}`).join(', ')})`;
  });
  const sql = `insert into "${table}" (${cols.map((c) => `"${c.col}"`).join(', ')}) values ${placeholders.join(', ')} on conflict (id) do nothing`;
  await pool.query(sql, values);
}

async function loadScalars(t: TableCtx, records: ZiteRecord[]): Promise<void> {
  const cols: ColSpec[] = [{ prop: 'id', col: 'id' }, ...Object.entries(t.def.fields)
    .filter(([prop, f]) => prop !== 'id' && f.kind !== 'link' && f.kind !== 'linkMany')
    .map(([prop, f]) => ({ prop, col: f.col }))];

  let inserted = 0;
  let failed = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((r) => rowFromRecord(t, r));
    try {
      await insertBatch(t.def.table, cols, batch);
      inserted += batch.length;
    } catch (err) {
      // Aísla el lote fallido insertando fila por fila, para no perder el resto por un solo registro malo.
      for (const row of batch) {
        try { await insertBatch(t.def.table, cols, [row]); inserted++; }
        catch (rowErr) { failed++; console.error(`❌ ${t.name} id=${row.id}: ${(rowErr as Error).message.split('\n')[0]}`); }
      }
      console.error(`[aviso] ${t.name}: lote ${i}-${i + batch.length} falló junto, se insertó fila por fila (${(err as Error).message.split('\n')[0]})`);
    }
    console.log(`   ${t.name}: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
  }
  console.log(`✅ ${t.name}: ${inserted} insertadas${failed ? `, ${failed} fallidas` : ''}`);
}

async function applyLinks(t: TableCtx, records: ZiteRecord[]): Promise<void> {
  const model = createModel(pool, t.modelKey as keyof typeof SCHEMA);
  let updated = 0;
  let failed = 0;
  for (const r of records) {
    const patch: Record<string, unknown> = {};
    for (const [label, value] of Object.entries(r.fields ?? {})) {
      const resolved = resolveField(t, label);
      if (resolved && (resolved[1].kind === 'link' || resolved[1].kind === 'linkMany')) patch[resolved[0]] = value;
    }
    if (!Object.keys(patch).length) continue;
    try {
      await model.update({ id: r.id, record: patch });
      updated++;
    } catch (err) {
      failed++;
      console.error(`❌ ${t.name} id=${r.id}: ${(err as Error).message.split('\n')[0]}`);
    }
  }
  console.log(`✅ ${t.name}: ${updated} filas con links aplicados${failed ? `, ${failed} fallidas` : ''}`);
}

async function main() {
  const tableNames = await loadTableList();
  const tables: TableCtx[] = [];
  for (const name of tableNames) {
    const modelKey = name.replace(/\s+/g, '');
    const def = (SCHEMA as Record<string, TableDef>)[modelKey];
    if (!def) { console.warn(`[aviso] sin mapeo en SCHEMA: ${name} (${modelKey})`); continue; }
    tables.push({ name, modelKey, def });
  }

  const targets = ONLY ? tables.filter((t) => ONLY.has(t.name)) : tables;
  if (ONLY) {
    const missing = [...ONLY].filter((n) => !tables.some((t) => t.name === n));
    if (missing.length) console.warn(`[aviso] no encontradas: ${missing.join(', ')}`);
  }

  console.log(`── Fase 1: columnas escalares (${targets.length} tablas) ──`);
  for (const t of targets) {
    const file = path.join(DATA_DIR, `${t.name}.json`);
    if (!(await exists(file))) { console.log(`⏭  ${t.name}: no exportada aún, se salta`); continue; }
    const records: ZiteRecord[] = JSON.parse(await readFile(file, 'utf8'));
    await loadScalars(t, records);
  }

  console.log(`\n── Fase 2: links y relaciones N-N ──`);
  for (const t of targets) {
    const hasLinks = Object.values(t.def.fields).some((f) => f.kind === 'link' || f.kind === 'linkMany');
    if (!hasLinks) continue;
    const file = path.join(DATA_DIR, `${t.name}.json`);
    if (!(await exists(file))) continue;
    const records: ZiteRecord[] = JSON.parse(await readFile(file, 'utf8'));
    await applyLinks(t, records);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
