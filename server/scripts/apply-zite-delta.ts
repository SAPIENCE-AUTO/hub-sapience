// Aplica los .delta.json producidos por scripts/export-zite-delta.mjs: a
// diferencia de load-zite-to-postgres.ts (que hace `on conflict do nothing`,
// pensado para la carga inicial), esto es un UPSERT real — una fila que
// cambió en Zite debe reflejarse en Postgres.
//
// Excepción deliberada: columnas de archivos ya migrados a Supabase Storage
// (ver migración de Monday/uploads.zite.com de esta sesión). Si Zite todavía
// tiene la URL vieja en esos campos y la fila se tocó por otra razón, un
// upsert ciego la revertiría — confirmado en vivo con 3 filas de Supplier
// Invoices antes de escribir este script. Se excluyen del SET del UPDATE
// (no del INSERT: una fila nueva que no existía en Postgres no tiene nada
// que proteger).
//
// Uso (desde la raíz del repo):
//   npx tsx --env-file=.env server/scripts/apply-zite-delta.ts
//   npx tsx --env-file=.env server/scripts/apply-zite-delta.ts --only=Users,Deals
//   npx tsx --env-file=.env server/scripts/apply-zite-delta.ts --dry-run

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SCHEMA, type TableDef, type FieldDef } from '../compat/schema-map';
import { isExcludedRecord } from './zite-exclusions';
import { normalizeNumericOverflow } from './zite-normalizations';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'datos-zite');
const BATCH_SIZE = 500;

const PROTECTED_COLUMNS: Record<string, string[]> = {
  // pdfBase64 se agregó junto con pdfUrl: generatePoPdf.ts (Puppeteer, sin n8n)
  // ahora guarda el PDF en ambos campos, y sendPoEmail.ts adjunta el correo
  // usando pdfBase64, no pdfUrl — sin esto, un sync de Zite podía dejar la
  // URL apuntando al PDF nuevo pero el adjunto del correo con el viejo.
  PurchaseOrders: ['pdfUrl', 'pdfBase64'],
  SupplierInvoices: ['pdfFile', 'xmlFile', 'supportFile'],
  Payments: ['attachment'],
  PoAttachments: ['fileUrl'],
  DealDocuments: ['fileUrl'],
  Users: ['profilePhoto'],
};

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
  connectionTimeoutMillis: 15_000,
  statement_timeout: 60_000,
  query_timeout: 60_000,
});

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;
const DRY_RUN = args.includes('--dry-run');

function toCamelProp(label: string): string {
  const words = label
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

function coerce(kind: FieldDef['kind'], value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value === '') return null;
  switch (kind) {
    case 'number': return typeof value === 'number' ? value : Number(value);
    case 'boolean': return Boolean(value);
    case 'json': return JSON.stringify(value);
    case 'array': return Array.isArray(value) ? value : [value];
    default: return value;
  }
}

interface ZiteRecord { id: string; fields?: Record<string, unknown>; createdAt?: string; updatedAt?: string }
interface TableCtx { name: string; modelKey: string; def: TableDef }

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

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

interface ColSpec { prop: string; col: string }

// El upsert normal es por `id` — cubre el caso ampliamente más común: el id
// de Zite ya existe en Postgres (viene de la carga inicial o de una corrida
// previa de este mismo script) y solo hay que refrescar sus columnas.
//
// CellValues (y cualquier otra tabla con `conflictTarget` en schema-map.ts)
// tiene además el índice parcial cell_values_posicion_viva_uniq (board_id,
// row_id, column_id) where deleted_at is null: un id NUEVO de Zite puede
// aterrizar en una posición que YA tiene una fila viva bajo otro id distinto.
// `ON CONFLICT (id)` no puede atrapar ese choque (Postgres solo suprime el
// árbitro que se le indica) — truena con "duplicate key ... posicion_viva".
// Ese caso, comprobado en vivo, es RARO frente al de arriba, así que no
// conviene hacer TODO el upsert por posición: eso rompe el camino rápido y
// común (id ya existente) con "duplicate key ... cell_values_pkey", porque un
// id que ya existe en la tabla nunca se declaró como árbitro. La solución es
// intentar por id primero, y solo si eso falla, reintentar esa fila puntual
// por posición — ahí sí excluyendo `id` del SET (la fila que ya ocupaba esa
// posición debe conservar SU id, no adoptar el de Zite; ver server/test.ts,
// sección "CellValues upsert real por posición viva").
function buildUpsertSql(
  table: string,
  cols: ColSpec[],
  protectedProps: Set<string>,
  rows: Record<string, unknown>[],
  arbiter: { cols: string[]; where?: string; excludeFromSet?: string[] },
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const placeholders = rows.map((row, ri) => {
    const base = ri * cols.length;
    cols.forEach((c) => values.push(row[c.prop] ?? null));
    return `(${cols.map((_, ci) => `$${base + ci + 1}`).join(', ')})`;
  });
  const exclude = new Set(arbiter.excludeFromSet ?? []);
  const updatable = cols.filter((c) => c.prop !== 'id' && !protectedProps.has(c.prop) && !exclude.has(c.prop));
  const setClause = updatable.map((c) => `"${c.col}" = excluded."${c.col}"`).join(', ');
  const arbiterCols = arbiter.cols.map((c) => `"${c}"`).join(', ');
  const wherePart = arbiter.where ? ` where ${arbiter.where}` : '';
  const sql = `insert into "${table}" (${cols.map((c) => `"${c.col}"`).join(', ')}) values ${placeholders.join(', ')}
    on conflict (${arbiterCols})${wherePart} do update set ${setClause}`;
  return { sql, values };
}

async function upsertById(table: string, cols: ColSpec[], protectedProps: Set<string>, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const { sql, values } = buildUpsertSql(table, cols, protectedProps, rows, { cols: ['id'] });
  await pool.query(sql, values);
}

async function upsertByPosition(
  table: string,
  cols: ColSpec[],
  protectedProps: Set<string>,
  row: Record<string, unknown>,
  conflictTarget: { cols: string[]; where?: string },
): Promise<void> {
  const { sql, values } = buildUpsertSql(table, cols, protectedProps, [row], { ...conflictTarget, excludeFromSet: ['id'] });
  await pool.query(sql, values);
}

async function applyTable(t: TableCtx, deltaFile: string): Promise<{ name: string; applied: number; failed: number }> {
  const allRecords: ZiteRecord[] = JSON.parse(await readFile(deltaFile, 'utf8'));
  const records = allRecords.filter((r) => !isExcludedRecord(t.name, r.fields));
  const excludedCount = allRecords.length - records.length;
  if (excludedCount) console.log(`   ${t.name}: ${excludedCount} excluidas por zite-exclusions.ts`);
  const cols: ColSpec[] = [{ prop: 'id', col: 'id' }, ...Object.entries(t.def.fields)
    .filter(([prop, f]) => prop !== 'id' && f.kind !== 'link' && f.kind !== 'linkMany')
    .map(([prop, f]) => ({ prop, col: f.col }))];
  const protectedProps = new Set(PROTECTED_COLUMNS[t.modelKey] ?? []);

  if (DRY_RUN) {
    console.log(`[dry-run] ${t.name}: aplicaría ${records.length} filas (${protectedProps.size ? `protegiendo: ${[...protectedProps].join(', ')}` : 'sin columnas protegidas'})`);
    return { name: t.name, applied: records.length, failed: 0 };
  }

  const conflictTarget = t.def.conflictTarget;
  let applied = 0, failed = 0, byPosition = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE).map((r) => rowFromRecord(t, r));
    try {
      await upsertById(t.def.table, cols, protectedProps, batch);
      applied += batch.length;
    } catch (err) {
      for (const row of batch) {
        try { await upsertById(t.def.table, cols, protectedProps, [row]); applied++; }
        catch (idErr) {
          if (!conflictTarget) { failed++; console.error(`❌ ${t.name} id=${row.id}: ${(idErr as Error).message.split('\n')[0]}`); continue; }
          try { await upsertByPosition(t.def.table, cols, protectedProps, row, conflictTarget); applied++; byPosition++; }
          catch (posErr) { failed++; console.error(`❌ ${t.name} id=${row.id}: ${(posErr as Error).message.split('\n')[0]}`); }
        }
      }
    }
  }
  console.log(`✅ ${t.name}: ${applied} aplicadas${byPosition ? ` (${byPosition} por posición)` : ''}${failed ? `, ${failed} fallidas` : ''}${protectedProps.size ? ` (protegido: ${[...protectedProps].join(', ')})` : ''}`);
  return { name: t.name, applied, failed };
}

async function main() {
  const summaryPath = path.join(DATA_DIR, '_delta-summary.json');
  if (!(await exists(summaryPath))) throw new Error('Falta datos-zite/_delta-summary.json — corre primero export-zite-delta.mjs');
  const summary: { name: string; deltaCount: number }[] = JSON.parse(await readFile(summaryPath, 'utf8'));

  const targets = summary.filter((s) => s.deltaCount > 0 && (!ONLY || ONLY.has(s.name)));
  console.log(`${targets.length} tablas con delta para aplicar${DRY_RUN ? ' (DRY RUN, no escribe nada)' : ''}\n`);

  const results = [];
  for (const { name } of targets) {
    const modelKey = name.replace(/\s+/g, '');
    const def = (SCHEMA as Record<string, TableDef>)[modelKey];
    if (!def) { console.warn(`[aviso] sin mapeo en SCHEMA: ${name}`); continue; }
    const deltaFile = path.join(DATA_DIR, `${name.replace(/[\\/:*?"<>|]/g, '_')}.delta.json`);
    results.push(await applyTable({ name, modelKey, def }, deltaFile));
  }

  console.log('\n── Resumen ──');
  console.table(results);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
