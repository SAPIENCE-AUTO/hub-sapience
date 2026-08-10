#!/usr/bin/env node
// Modo incremental de export-zite-tables.mjs: en vez de traer la tabla completa,
// trae solo lo que cambió en Zite desde el snapshot actual (datos-zite/<Tabla>.json).
//
// La API de Zite (tables.zite.com/api/v1) NO documenta un filtro por fecha, y
// el parámetro `filter` existe pero su DSL exacto no se pudo adivinar (rechaza
// todas las formas probadas con "Validation error"). Sí se confirmó en vivo que
// `sort=[{"field":"updatedAt","direction":"desc"}]` funciona y pagina de forma
// consistente. Este script explota eso: pide cada tabla ordenada por updatedAt
// descendente y para de paginar en cuanto encuentra un registro <= al watermark
// (todo lo que sigue, por estar ordenado desc, es igual de viejo o más).
//
// Esto SOLO detecta altas y modificaciones. No detecta borrados duros — ver
// el análisis de riesgo en CLAUDE.md / el mensaje de salida de este script.
//
// Uso:
//   node --env-file=.env scripts/export-zite-delta.mjs
//   node --env-file=.env scripts/export-zite-delta.mjs --only=Users,Deals

import { readFile, writeFile, mkdir, access, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://tables.zite.com/api/v1';
const DATABASE_ID = '512a1c4ecafe1e31';
const DATA_DIR = path.join(ROOT, 'datos-zite');
const PAGE_SIZE = 500;
const MAX_REQ_PER_SEC = 30;

const API_KEY = process.env.ZITE_API_KEY;
if (!API_KEY) {
  console.error('Falta ZITE_API_KEY. Corre con: node --env-file=.env scripts/export-zite-delta.mjs');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const onlyArg = [...args].find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null;

const requestTimestamps = [];
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (requestTimestamps.length && now - requestTimestamps[0] >= 1000) requestTimestamps.shift();
    if (requestTimestamps.length < MAX_REQ_PER_SEC) { requestTimestamps.push(now); return; }
    await new Promise((r) => setTimeout(r, 1000 - (now - requestTimestamps[0]) + 1));
  }
}

async function zfetch(pathAndQuery) {
  await throttle();
  const res = await fetch(`${BASE_URL}${pathAndQuery}`, { headers: { Authorization: `Bearer ${API_KEY}` } });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, json, raw: text };
}

async function exists(p) { try { await access(p); return true; } catch { return false; } }
function safeFileName(name) { return name.replace(/[\\/:*?"<>|]/g, '_'); }

// Confirmadas en vivo (ver historial): /bases/{id} lista tablas con {id,name,fields},
// /bases/{id}/tables/{tid}/records pagina con limit/offset y soporta sort=[{field,direction}].
const SORT_DESC_UPDATED = encodeURIComponent(JSON.stringify([{ field: 'updatedAt', direction: 'desc' }]));

// Los archivos de tablas grandes (Cell Values: 2.17GB) superan el límite de
// 2GiB de fs.readFile — hay que barrerlos en streaming. Como solo hace falta
// el máximo de "updatedAt" y un conteo, ni siquiera hace falta parsear JSON
// completo: basta con extraer el patrón por texto según se va leyendo.
const UPDATED_AT_RE = /"updatedAt"\s*:\s*"([^"]+)"/g;
const RECORD_START_RE = /"id"\s*:\s*"/g;

async function watermarkFor(tableName) {
  const file = path.join(DATA_DIR, `${safeFileName(tableName)}.json`);
  if (!(await exists(file))) return null; // sin snapshot base, no se puede calcular delta

  const { size } = await stat(file);
  if (size < 500 * 1024 * 1024) {
    const records = JSON.parse(await readFile(file, 'utf8'));
    let max = null;
    for (const r of records) if (r.updatedAt && (!max || r.updatedAt > max)) max = r.updatedAt;
    return { max, baseCount: records.length };
  }

  let max = null;
  let count = 0;
  let tail = '';
  for await (const chunk of createReadStream(file, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 })) {
    const combined = tail + chunk;
    for (const m of combined.matchAll(UPDATED_AT_RE)) if (!max || m[1] > max) max = m[1];
    count += (combined.match(RECORD_START_RE) ?? []).length;
    tail = combined.slice(-100); // por si un match queda cortado en la frontera del chunk
  }
  // el conteo por regex de "id": puede sumar de más si un campo se llama distinto pero contiene "id":
  // literal en su valor; se usa solo para reportar en consola, no para lógica de corte.
  return { max, baseCount: count };
}

async function fetchDelta(tableId, watermark) {
  const delta = [];
  let offset = 0;
  for (;;) {
    const res = await zfetch(`/bases/${DATABASE_ID}/tables/${tableId}/records?sort=${SORT_DESC_UPDATED}&limit=${PAGE_SIZE}&offset=${offset}`);
    if (!res.ok) throw new Error(`${res.status}: ${res.raw.slice(0, 200)}`);
    const page = res.json.records ?? [];
    if (page.length === 0) break;

    let boundaryHit = false;
    for (const r of page) {
      if (watermark && r.updatedAt <= watermark) { boundaryHit = true; break; }
      delta.push(r);
    }
    if (boundaryHit) break;
    offset += page.length;
    const hasMore = typeof res.json.hasMore === 'boolean' ? res.json.hasMore : page.length === PAGE_SIZE;
    if (!hasMore) break;
  }
  return delta;
}

async function main() {
  const meta = JSON.parse(await readFile(path.join(DATA_DIR, '_meta.json'), 'utf8'));
  let tables = meta.tables;
  if (ONLY) {
    tables = tables.filter((t) => ONLY.has(t.name));
    const missing = [...ONLY].filter((n) => !meta.tables.some((t) => t.name === n));
    if (missing.length) console.warn(`[aviso] no existen: ${missing.join(', ')}`);
  }

  const summary = [];
  for (const table of tables) {
    const wm = await watermarkFor(table.name);
    if (!wm) { console.log(`⏭  ${table.name}: sin snapshot base, se salta`); continue; }

    const delta = await fetchDelta(table.id, wm.max);
    const fileName = safeFileName(table.name);
    if (delta.length > 0) {
      await writeFile(path.join(DATA_DIR, `${fileName}.delta.json`), JSON.stringify(delta, null, 2));
    }
    console.log(`${delta.length > 0 ? '🔸' : '✅'} ${table.name}: ${delta.length} cambiados desde ${wm.max} (snapshot base: ${wm.baseCount})`);
    summary.push({ name: table.name, watermark: wm.max, baseCount: wm.baseCount, deltaCount: delta.length });
  }

  await writeFile(path.join(DATA_DIR, '_delta-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n── Resumen: ${summary.filter((s) => s.deltaCount > 0).length}/${summary.length} tablas con cambios ──`);
}

main().catch((err) => { console.error(err); process.exit(1); });
