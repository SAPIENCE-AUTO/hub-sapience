// Exporta (solo lectura) los tableros de reclutamiento históricos de Monday.com
// listados en monday-recruitment-boards-confirmed.json — columnas, ítems,
// column_values, grupo y fecha de creación — a datos-monday/{boardId}.json.
// No toca Postgres. Ver plan: migrar tableros de reclutamiento de Monday al Hub.
//
// Uso: node --env-file=.env server/scripts/export-monday-recruitment.mjs [--force] [--only=<boardId>]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', '..', 'datos-monday');
const CONFIRMED_PATH = path.join(__dirname, 'monday-recruitment-boards-confirmed.json');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1];

const token = process.env.MONDAY_API_TOKEN;
if (!token) throw new Error('Falta MONDAY_API_TOKEN en el entorno');

async function gql(query, attempt = 1) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2024-10' },
    body: JSON.stringify({ query }),
  });
  if (res.status === 429 && attempt <= 5) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return gql(query, attempt + 1);
  }
  const json = await res.json();
  if (json.errors) throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function fetchColumns(boardId) {
  const data = await gql(`{
    boards (ids: [${boardId}]) {
      columns { id title type settings_str }
    }
  }`);
  return data.boards[0]?.columns ?? [];
}

async function fetchAllItems(boardId) {
  const items = [];
  let cursor = null;
  while (true) {
    const cursorClause = cursor ? `, cursor: "${cursor}"` : '';
    const data = await gql(`{
      boards (ids: [${boardId}]) {
        items_page (limit: 100${cursorClause}) {
          cursor
          items {
            id
            name
            created_at
            group { id title }
            column_values { id type text value }
          }
        }
      }
    }`);
    const page = data.boards[0]?.items_page;
    if (!page) break;
    items.push(...page.items);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return items;
}

async function fetchFileAssets(itemIds) {
  // Resuelve assets reales (archivos subidos directo a Monday, no links de
  // Fillout) para las columnas tipo `file`. Se piden por lotes de 25 items
  // usando `assets` en el mismo item (evita una query por item).
  const assetByItemId = new Map();
  const BATCH = 25;
  for (let i = 0; i < itemIds.length; i += BATCH) {
    const batch = itemIds.slice(i, i + BATCH);
    if (batch.length === 0) continue;
    const data = await gql(`{
      items (ids: [${batch.join(',')}]) {
        id
        assets { id name public_url file_extension }
      }
    }`);
    for (const it of data.items ?? []) {
      if (it.assets?.length) assetByItemId.set(it.id, it.assets);
    }
  }
  return assetByItemId;
}

async function exportBoard(entry) {
  const outPath = path.join(OUT_DIR, `${entry.boardId}.json`);
  if (fs.existsSync(outPath) && !FORCE) {
    console.log(`   ⏭️  ${entry.boardName} (${entry.boardId}) — ya existe, se salta`);
    return;
  }

  const columns = await fetchColumns(entry.boardId);
  const items = await fetchAllItems(entry.boardId);

  const hasFileColumn = columns.some((c) => c.type === 'file');
  let assetsByItemId = new Map();
  if (hasFileColumn) {
    assetsByItemId = await fetchFileAssets(items.map((i) => i.id));
  }

  const enrichedItems = items.map((it) => ({
    ...it,
    assets: assetsByItemId.get(it.id) ?? [],
  }));

  fs.writeFileSync(
    outPath,
    JSON.stringify({ ...entry, columns, items: enrichedItems }, null, 2)
  );
  console.log(`   ✅ ${entry.boardName} (${entry.boardId}) — ${items.length} items, ${columns.length} columnas`);
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const confirmed = JSON.parse(fs.readFileSync(CONFIRMED_PATH, 'utf-8'));
  const toExport = ONLY ? confirmed.filter((e) => e.boardId === ONLY) : confirmed;
  console.log(`Exportando ${toExport.length} tablero(s) de Monday...`);

  for (const entry of toExport) {
    try {
      await exportBoard(entry);
    } catch (e) {
      console.log(`   ❌ ${entry.boardName} (${entry.boardId}): ${e.message}`);
    }
  }
  console.log('\nExportación completa.');
}

await main();
