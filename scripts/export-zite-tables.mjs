#!/usr/bin/env node
// Exporta las 41 tablas de la base Zite (Operations Hub, 512a1c4ecafe1e31) vía su
// API REST a datos-zite/<Tabla>.json. No asume la forma de las rutas: las
// descubre probando candidatos contra la API real, pagina de 500 en 500,
// respeta 30 peticiones/segundo (límite global, aunque exporte varias tablas
// en paralelo) y es reanudable — una tabla ya completa (datos-zite/<Tabla>.json)
// se salta, y una interrumpida a medias retoma desde su último offset guardado
// en datos-zite/.progress/.
//
// Uso:
//   node --env-file=.env scripts/export-zite-tables.mjs
//   node --env-file=.env scripts/export-zite-tables.mjs --only=Users,Deals
//   node --env-file=.env scripts/export-zite-tables.mjs --force   (ignora lo ya exportado)

import { readFile, writeFile, appendFile, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://tables.zite.com/api/v1';
const DATABASE_ID = '512a1c4ecafe1e31';
const OUT_DIR = path.join(ROOT, 'datos-zite');
const PROGRESS_DIR = path.join(OUT_DIR, '.progress');
const PAGE_SIZE = 500;
const MAX_REQ_PER_SEC = 30;
const CONCURRENCY = 6;

const API_KEY = process.env.ZITE_API_KEY;
if (!API_KEY) {
  console.error('Falta ZITE_API_KEY en el entorno. Corre con:\n  node --env-file=.env scripts/export-zite-tables.mjs');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const onlyArg = [...args].find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;
const FORCE = args.has('--force');

// ── Límite global de tasa: nunca más de MAX_REQ_PER_SEC peticiones en cualquier ventana de 1s. ──
const requestTimestamps = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestTimestamps.length && now - requestTimestamps[0] >= 1000) requestTimestamps.shift();
    if (requestTimestamps.length < MAX_REQ_PER_SEC) {
      requestTimestamps.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000 - (now - requestTimestamps[0]) + 1));
  }
}

async function zfetch(pathAndQuery) {
  await throttle();
  const res = await fetch(`${BASE_URL}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, json, raw: text };
}

// ── Extracción genérica: la respuesta puede envolver el arreglo en distintas claves. ──
function extractArray(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  for (const key of ['tables', 'records', 'data', 'rows', 'items', 'results']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return null;
}

// ── Paso 1: descubrir cómo listar las tablas de la base (y sus IDs reales). ──
// ESQUEMA-BD.md solo tiene nombres; el ID real (ej. "te6Fapo3s3Z") solo se
// consigue en vivo, así que se prueban candidatos hasta encontrar uno que
// devuelva un arreglo de tablas con {id, name}.
async function discoverTables() {
  const candidates = [
    `/bases/${DATABASE_ID}`,
    `/databases/${DATABASE_ID}`,
    `/bases/${DATABASE_ID}/tables`,
    `/databases/${DATABASE_ID}/tables`,
  ];
  for (const p of candidates) {
    const res = await zfetch(p);
    if (!res.ok) continue;
    const arr = extractArray(res.json);
    if (arr?.length && arr.every((t) => t?.id && t?.name)) {
      console.log(`[descubrimiento] listado de tablas: GET ${p}`);
      return arr;
    }
  }
  throw new Error('No se encontró una ruta que liste las tablas de la base (candidatos agotados).');
}

// ── Paso 2: descubrir la ruta de "list records" contra una tabla real. ──
function shouldContinue(body, offsetAfterPage, pageLen, limit) {
  if (typeof body?.total === 'number') return offsetAfterPage < body.total;
  if (typeof body?.hasMore === 'boolean') return body.hasMore;
  if (typeof body?.has_more === 'boolean') return body.has_more;
  return pageLen === limit && pageLen > 0;
}

async function discoverRecordsRoute(referenceTableId) {
  const candidates = [
    (id) => `/bases/${DATABASE_ID}/tables/${id}/records?limit=1&offset=0`,
    (id) => `/databases/${DATABASE_ID}/tables/${id}/records?limit=1&offset=0`,
    (id) => `/bases/${DATABASE_ID}/tables/${id}/rows?limit=1&offset=0`,
    (id) => `/${DATABASE_ID}/tables/${id}/records?limit=1&offset=0`,
    (id) => `/tables/${id}/records?database=${DATABASE_ID}&limit=1&offset=0`,
    (id) => `/bases/${DATABASE_ID}/tables/${id}?limit=1&offset=0`,
  ];
  for (const build of candidates) {
    const probePath = build(referenceTableId);
    const res = await zfetch(probePath);
    if (!res.ok) continue;
    const arr = extractArray(res.json);
    if (arr !== null) {
      const template = probePath.replace(referenceTableId, '{tableId}').replace(/limit=1&offset=0/, 'limit={limit}&offset={offset}');
      console.log(`[descubrimiento] list records: GET ${template}`);
      return template;
    }
  }
  throw new Error('No se encontró una ruta de "list records" para las tablas (candidatos agotados).');
}

function buildRecordsPath(template, tableId, limit, offset) {
  return template.replace('{tableId}', tableId).replace('{limit}', String(limit)).replace('{offset}', String(offset));
}

// ── Reanudación por tabla ──
function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadJsonl(file) {
  if (!(await exists(file))) return [];
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function exportTable(table, recordsTemplate) {
  const fileName = safeFileName(table.name);
  const finalPath = path.join(OUT_DIR, `${fileName}.json`);
  const jsonlPath = path.join(PROGRESS_DIR, `${fileName}.jsonl`);
  const statePath = path.join(PROGRESS_DIR, `${fileName}.state.json`);

  if (!FORCE && (await exists(finalPath))) {
    console.log(`⏭  ${table.name}: ya exportada, se salta`);
    return { name: table.name, skipped: true };
  }

  let records = await loadJsonl(jsonlPath);
  let offset = records.length;
  if (await exists(statePath)) {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    offset = state.offset ?? offset;
  }
  if (offset > 0) console.log(`↻  ${table.name}: retomando desde offset ${offset} (${records.length} registros ya guardados)`);

  for (;;) {
    const res = await zfetch(buildRecordsPath(recordsTemplate, table.id, PAGE_SIZE, offset));
    if (!res.ok) throw new Error(`${res.status} en offset ${offset}: ${res.raw.slice(0, 300)}`);
    const pageRecords = extractArray(res.json) ?? [];
    if (pageRecords.length) {
      await appendFile(jsonlPath, pageRecords.map((r) => JSON.stringify(r)).join('\n') + '\n');
      records = records.concat(pageRecords);
    }
    offset += pageRecords.length;
    await writeFile(statePath, JSON.stringify({ offset, total: res.json?.total }));
    console.log(`   ${table.name}: ${offset}${res.json?.total != null ? `/${res.json.total}` : ''}`);
    if (!shouldContinue(res.json, offset, pageRecords.length, PAGE_SIZE)) break;
  }

  await writeFile(finalPath, JSON.stringify(records, null, 2));
  await rm(jsonlPath, { force: true });
  await rm(statePath, { force: true });
  console.log(`✅ ${table.name}: ${records.length} registros → datos-zite/${fileName}.json`);
  return { name: table.name, count: records.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(PROGRESS_DIR, { recursive: true });

  console.log('Descubriendo tablas de la base...');
  const allTables = await discoverTables();
  console.log(`${allTables.length} tablas en la base "${DATABASE_ID}"`);

  // Metadata de campos (field id -> nombre/tipo), subproducto del descubrimiento;
  // útil para traducir data.<fieldId> a nombres legibles más adelante.
  await writeFile(
    path.join(OUT_DIR, '_meta.json'),
    JSON.stringify(
      {
        databaseId: DATABASE_ID,
        tables: allTables.map((t) => ({
          id: t.id,
          name: t.name,
          fields: (t.fields ?? []).map((f) => ({ id: f.id, name: f.name, type: f.type })),
        })),
      },
      null,
      2,
    ),
  );

  let tables = allTables;
  if (ONLY) {
    tables = allTables.filter((t) => ONLY.has(t.name));
    const missing = [...ONLY].filter((n) => !allTables.some((t) => t.name === n));
    if (missing.length) console.warn(`[aviso] no existen en la base: ${missing.join(', ')}`);
  }

  const recordsTemplate = await discoverRecordsRoute(tables[0]?.id ?? allTables[0].id);

  const queue = [...tables];
  const results = [];
  const errors = [];

  async function worker() {
    for (;;) {
      const table = queue.shift();
      if (!table) return;
      try {
        results.push(await exportTable(table, recordsTemplate));
      } catch (err) {
        console.error(`❌ ${table.name}: ${err.message}`);
        errors.push({ name: table.name, error: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  console.log('\n── Resumen ──');
  console.log(`Exportadas ahora: ${results.filter((r) => !r.skipped).length}`);
  console.log(`Ya estaban: ${results.filter((r) => r.skipped).length}`);
  if (errors.length) {
    console.log(`Con error (${errors.length}): ${errors.map((e) => e.name).join(', ')}`);
    console.log('Vuelve a correr el script para reintentar solo esas; las demás ya quedaron guardadas.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
