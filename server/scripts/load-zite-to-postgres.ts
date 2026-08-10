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

import { readFile, access, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, Client } from 'pg';
// pg-copy-streams no trae tipos; tsx no type-checkea, así que esto corre sin problema.
// @ts-ignore
import { from as copyFrom } from 'pg-copy-streams';
import { SCHEMA, type TableDef, type FieldDef } from '../compat/schema-map';
import { createModel } from '../compat/model';
import { isExcludedRecord } from './zite-exclusions';
import { normalizeNumericOverflow } from './zite-normalizations';
import { migrateLegacyBoardIds } from './migrate-legacy-board-ids.mjs';
import { migrateMondayPoPdfs } from './migrate-monday-po-pdfs.mjs';
import { migrateZiteUploads } from './migrate-zite-uploads.mjs';
import { pool as compatPool } from '../compat/index';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'datos-zite');
const BATCH_SIZE = 2000;
// Tablas por encima de esto (Cell Values: ~2GB) se cargan por COPY FROM STDIN en
// streaming en vez de con JSON.parse(readFile(...)) + INSERT por lotes: cargar el
// archivo completo a memoria para 2.8M filas es exactamente lo que tronó antes
// ("Invalid string length" al exportar; hubiera vuelto a tronar al cargar).
const COPY_THRESHOLD_BYTES = 50 * 1024 * 1024;

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
  // Vacío = sin valor, no un valor a repetir: sin esto, un UNIQUE index (ej. shared_views.token)
  // rechaza dos filas con "" aunque ambas debieran leerse como "sin token" (a diferencia de NULL,
  // que Postgres sí deja repetir). Se vio en vivo: 250 de 462 Shared Views caían por esto.
  if (value === '') return null;
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
    row[prop] = normalizeNumericOverflow(t.name, prop, coerce(f.kind, value));
  }
  if (t.def.fields.createdAt && record.createdAt) row.createdAt = record.createdAt;
  if (t.def.fields.updatedAt && record.updatedAt) row.updatedAt = record.updatedAt;
  return row;
}

// export-zite-tables.mjs escribe el .json final como `[\nrec1,\nrec2,\n...\nrecN\n]\n`
// (una línea por registro, coma al final salvo la última) para poder ensamblarlo sin
// nunca construir un string gigante. Esto lee esa misma estructura línea por línea,
// sin cargar el archivo a memoria — así es como se lee un archivo de 2GB sin tronar.
async function* streamRecords(file: string): AsyncGenerator<ZiteRecord> {
  const parseLine = (line: string): ZiteRecord | null => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[' || trimmed === ']') return null;
    return JSON.parse(trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed);
  };
  let tail = '';
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    tail += chunk;
    const lines = tail.split('\n');
    tail = lines.pop() ?? '';
    for (const line of lines) {
      const rec = parseLine(line);
      if (rec) yield rec;
    }
  }
  const last = parseLine(tail);
  if (last) yield last;
}

interface ColSpec { prop: string; col: string }

/** Escapa un valor para una fila COPY en formato CSV. NULL = campo vacío sin comillas. */
function csvField(kind: FieldDef['kind'], value: unknown): string {
  const v = coerce(kind, value);
  if (v === null || v === undefined) return '';
  if (kind === 'array' && Array.isArray(v)) {
    // Literal de arreglo de Postgres DENTRO del campo CSV: dos capas de escape distintas.
    const inner = v.map((el) => `"${String(el).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    return `"${`{${inner}}`.replace(/"/g, '""')}"`;
  }
  return `"${String(v).replace(/"/g, '""')}"`;
}

/**
 * Carga una tabla enorme con COPY FROM STDIN, leyendo su .json en streaming.
 * Quita los índices no-PK antes (COPY los reconstruiría fila por fila si no) y los
 * recrea al final con su definición real, tomada en vivo de pg_indexes — no hay
 * nombres de columna ni de índice a mano en ningún lado de esta función.
 */
async function loadViaCopy(t: TableCtx, file: string): Promise<void> {
  const cols: ColSpec[] = [{ prop: 'id', col: 'id' }, ...Object.entries(t.def.fields)
    .filter(([prop, f]) => prop !== 'id' && f.kind !== 'link' && f.kind !== 'linkMany')
    .map(([prop, f]) => ({ prop, col: f.col }))];

  // Conexión dedicada, NO del pool compartido: un COPY de millones de filas es una sola
  // sentencia larga por diseño, y el query_timeout de 60s del pool (pensado para las
  // muchas consultas cortas de loadScalars/applyLinks) la mata a medio camino — se vio
  // en vivo cortándose en 700k/2.83M con "Query read timeout". Nada de valor fijo aquí:
  // sin query_timeout en el constructor (pg no lo activa si no se pasa) y con
  // `SET statement_timeout = 0` explícito en la sesión, este COPY no tiene techo.
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  await client.query('SET statement_timeout = 0');
  try {
    // COPY no tiene ON CONFLICT: si ya hay filas, un id repetido tumba el COPY entero.
    // No hay retomar-desde-la-mitad aquí (sí lo hay en el export); si ya hay algo, se salta.
    const { rows: [{ n }] } = await client.query(`select count(*)::int as n from "${t.def.table}"`);
    if (n > 0) {
      console.log(`⏭  ${t.name}: ya tiene ${n} filas en Postgres, se salta el COPY`);
      return;
    }

    const { rows: indexDefs } = await client.query(
      `select indexname, indexdef from pg_indexes where tablename = $1 and indexname !~ '_pkey$'`,
      [t.def.table],
    );
    if (indexDefs.length) {
      console.log(`[copy] ${t.name}: quitando ${indexDefs.length} índice(s) antes del COPY`);
      for (const idx of indexDefs) await client.query(`drop index if exists "${idx.indexname}"`);
    }

    const copySql = `COPY "${t.def.table}" (${cols.map((c) => `"${c.col}"`).join(', ')}) FROM STDIN WITH (FORMAT csv)`;
    const copyStream = client.query(copyFrom(copySql));
    const finished = new Promise<void>((resolve, reject) => {
      copyStream.on('finish', resolve);
      copyStream.on('error', reject);
    });

    let count = 0;
    let excluded = 0;
    for await (const record of streamRecords(file)) {
      if (isExcludedRecord(t.name, record.fields)) { excluded++; continue; }
      const row = rowFromRecord(t, record);
      const line = cols.map((c) => csvField(t.def.fields[c.prop].kind, row[c.prop])).join(',') + '\n';
      if (!copyStream.write(line)) await new Promise((r) => copyStream.once('drain', r));
      count++;
      if (count % 100_000 === 0) console.log(`   ${t.name} (copy): ${count}`);
    }
    copyStream.end();
    await finished;
    console.log(`✅ ${t.name}: ${count} filas cargadas vía COPY${excluded ? ` (${excluded} excluidas por zite-exclusions.ts)` : ''}`);

    if (indexDefs.length) {
      console.log(`[copy] ${t.name}: recreando ${indexDefs.length} índice(s)`);
      for (const idx of indexDefs) await client.query(idx.indexdef);
    }
  } finally {
    await client.end();
  }
}

// Las 6 columnas `bigint generated by default as identity` de schema.sql —
// la carga preserva su valor de Zite tal cual, pero eso nunca mueve la
// secuencia de Postgres que asigna el SIGUIENTE id. Se corrigió a mano una
// vez con setval(); esto lo hace parte de la Fase 3 de cualquier carga
// completa. pg_get_serial_sequence en vez de un nombre de secuencia a mano,
// igual que loadViaCopy ya resuelve índices en vivo contra pg_indexes.
const AUTONUMBER_COLUMNS: [string, string][] = [
  ['messages', 'message_id'],
  ['cell_values', 'cell_id'],
  ['payments', 'payment_id'],
  ['approval_limits', 'limit_id'],
  ['expenses', 'expense_number'],
  ['document_blocks', 'block_id'],
];

async function syncAutonumberSequences(client: Client): Promise<void> {
  for (const [table, column] of AUTONUMBER_COLUMNS) {
    const seq = await client.query('select pg_get_serial_sequence($1, $2) as seq', [table, column]);
    const seqName = seq.rows[0]?.seq;
    if (!seqName) { console.warn(`[aviso] ${table}.${column}: no se encontró su secuencia, se salta`); continue; }
    const { rows: [{ mx }] } = await client.query(`select max("${column}") as mx from "${table}"`);
    const nextVal = (mx == null ? 0 : Number(mx)) + 1;
    await client.query('select setval($1, $2, false)', [seqName, nextVal]);
    console.log(`   ${table}.${column}: secuencia -> próximo id ${nextVal}`);
  }
}

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

async function loadScalars(t: TableCtx, allRecords: ZiteRecord[]): Promise<void> {
  const records = allRecords.filter((r) => !isExcludedRecord(t.name, r.fields));
  const excluded = allRecords.length - records.length;
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
  console.log(`✅ ${t.name}: ${inserted} insertadas${failed ? `, ${failed} fallidas` : ''}${excluded ? `, ${excluded} excluidas por zite-exclusions.ts` : ''}`);
}

// El pool ya trae query_timeout, pero se ha visto en vivo que tras un error de
// conexión ("Connection terminated unexpectedly") una conexión del pool queda en un
// estado zombie que ni siquiera dispara ese timeout — pool.query() se queda esperando
// para siempre. Este timeout es del LADO DE NODE, no depende de que pg reaccione bien.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout de ${ms}ms esperando ${label}`)), ms)),
  ]);
}

async function applyLinks(t: TableCtx, records: ZiteRecord[]): Promise<void> {
  const model = createModel(pool, t.modelKey as keyof typeof SCHEMA);
  let updated = 0;
  let failed = 0;
  let processed = 0;
  for (const r of records) {
    if (isExcludedRecord(t.name, r.fields)) continue;
    const patch: Record<string, unknown> = {};
    for (const [label, value] of Object.entries(r.fields ?? {})) {
      const resolved = resolveField(t, label);
      if (resolved && (resolved[1].kind === 'link' || resolved[1].kind === 'linkMany')) patch[resolved[0]] = value;
    }
    processed++;
    if (records.length > 500 && processed % 500 === 0) console.log(`   ${t.name} (links): ${processed}/${records.length}`);
    if (!Object.keys(patch).length) continue;
    try {
      await withTimeout(model.update({ id: r.id, record: patch }), 20_000, `update de ${t.name} id=${r.id}`);
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
    const { size } = await stat(file);
    if (size > COPY_THRESHOLD_BYTES) {
      console.log(`   ${t.name}: ${(size / 1024 / 1024).toFixed(0)}MB, va por COPY en streaming`);
      await loadViaCopy(t, file);
      continue;
    }
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

  // Fases 3 y 4 solo tienen sentido en una carga completa: dependen de que
  // TODAS las tablas (boards, cell_values, board_columns, y las 6 de
  // autonumber) ya estén cargadas, no de un subconjunto elegido con --only.
  if (!ONLY) {
    console.log(`\n── Fase 3: sincronizar secuencias de los 6 campos autonumber ──`);
    // La carga preserva los ids de Zite tal cual (incluye los autonumber),
    // pero nunca mueve la secuencia de Postgres que asigna el SIGUIENTE id —
    // sin esto, el primer INSERT nuevo después de una carga completa arranca
    // en 1 y choca con datos reales (se vio en vivo: payments.payment_id).
    const seqClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
    await seqClient.connect();
    try {
      await syncAutonumberSequences(seqClient);
    } finally {
      await seqClient.end();
    }

    console.log(`\n── Fase 4: migrar board_id legacy a UUID real (cell_values, board_columns) ──`);
    const boardIdClient = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
    await boardIdClient.connect();
    try {
      await migrateLegacyBoardIds(boardIdClient, { dryRun: false });
    } finally {
      await boardIdClient.end();
    }

    // Fases 5 y 6: los adjuntos que Zite exporta apuntan a hosts externos
    // (monday.com, uploads.zite.com) que se están dejando de usar — se migran
    // a Supabase Storage. Idempotentes: cada una solo toca lo que todavía
    // apunta al host viejo, así que corren seguido sin re-subir nada.
    console.log(`\n── Fase 5: PDFs de Órdenes de Compra en monday.com -> Supabase Storage ──`);
    await migrateMondayPoPdfs();

    console.log(`\n── Fase 6: archivos en uploads.zite.com -> Supabase Storage ──`);
    await migrateZiteUploads();

    await compatPool.end();
  } else {
    console.log(`\n⏭  Fases 3-6 (secuencias autonumber, board_id legacy, migración de adjuntos) se saltan con --only: dependen de una carga completa`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
