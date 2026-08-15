// Carga a Postgres los tableros de reclutamiento de Monday ya exportados por
// export-monday-recruitment.mjs (datos-monday/{boardId}.json). Crea un Board
// nuevo por tablero (boardType: 'recruitment', mismo camino que saveBoard.ts
// forceCreate), sus columnas, y RecruitmentRows/Participants/CellValues por
// ítem — replicando el patrón real de filloutNativeWebhook.ts/
// checkNewSubmissions.ts. Ver plan: migrar tableros de reclutamiento de
// Monday al Hub.
//
// Uso:
//   node --env-file=.env server/scripts/load-monday-recruitment-to-postgres.mjs --dry-run
//   node --env-file=.env server/scripts/load-monday-recruitment-to-postgres.mjs --only=<boardId>
//   node --env-file=.env server/scripts/load-monday-recruitment-to-postgres.mjs   (batch completo)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Boards, BoardColumns, RecruitmentRows, Participants, CellValues } from '../compat/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'datos-monday');
const CONFIRMED_PATH = path.join(__dirname, 'monday-recruitment-boards-confirmed.json');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1];

const BATCH_SIZE = 20; // mismo tamaño que checkNewSubmissions.ts
const CELL_CHUNK = 300; // mismo tamaño que checkNewSubmissions.ts

// Los "grupos" visuales (Kanban) del tablero de reclutamiento NO usan el
// campo recruitment_rows.group (ese es otro campo, usado para detectar
// participación real — ver checkNewSubmissions.ts/getBoardDuplicateBadges.ts).
// Los grupos visuales viven como BoardColumns bajo un boardId sintético
// "{boardId}::groups" (uno por grupo) + una CellValues con textValue:'1' por
// fila que pertenece a ese grupo — mismo patrón que importExcelData.ts:274-285.
const GROUP_COLOR_IDS = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'primary', 'destructive', 'muted'];

// ── Helpers de texto (copiados de filloutNativeWebhook.ts) ───────────────────
const normalize = (str) => (str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const CORE_NAME_EXACT = new Set(['nombre', 'name', 'nombre completo', 'full name', 'nombre del participante', 'nombre participante']);
const CORE_EMAIL_EXACT = new Set(['email', 'e-mail', 'correo', 'correo electronico', 'mail']);
const CORE_PHONE_EXACT = new Set(['telefono', 'phone', 'celular', 'numero de telefono', 'numero de celular', 'tel']);
const CORE_ID_EXACT = new Set(['documento', 'cedula', 'id doc', 'numero de documento', 'identificacion', 'num documento']);

function matchCore(name) {
  const n = normalize(name);
  if (CORE_NAME_EXACT.has(n)) return 'participantName';
  if (CORE_EMAIL_EXACT.has(n)) return 'email';
  if (CORE_PHONE_EXACT.has(n)) return 'phone';
  if (CORE_ID_EXACT.has(n)) return 'idNumber';
  const words = n.split(/\s+/);
  if (words[0] === 'nombre' && words.length <= 3) return 'participantName';
  if ((words[0] === 'telefono' || words[0] === 'celular') && words.length <= 3) return 'phone';
  return null;
}

// ── Mapeo de tipo de columna Monday → tipo de columna del Hub ────────────────
const SKIP_MONDAY_TYPES = new Set(['button', 'people', 'board_relation', 'subtasks', 'timeline']);

function toHubColumnType(mondayType) {
  switch (mondayType) {
    case 'numbers': return 'Número';
    case 'date': return 'Fecha';
    case 'email': return 'Email';
    case 'phone': return 'Teléfono';
    case 'link': return 'Archivo';
    case 'file': return 'Archivo';
    default: return 'Texto';
  }
}

function safeJsonParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// Dado un column_value crudo de Monday + el tipo de columna del Hub ya
// resuelto, arma el objeto tipado que espera CellValues (igual que
// toTypedValue en filloutNativeWebhook.ts:31-49).
function toCellFields(cv, hubColType) {
  const text = (cv.text ?? '').trim();
  switch (hubColType) {
    case 'Número': {
      if (!text) return null;
      const cleaned = text.replace(/,/g, '.').replace(/[^0-9.\-]/g, '');
      const n = parseFloat(cleaned);
      return isNaN(n) ? { textValue: text } : { numberValue: n };
    }
    case 'Fecha':
      return text ? { dateValue: text } : null;
    case 'Email': {
      const parsed = safeJsonParse(cv.value);
      const email = parsed?.email ?? text;
      return email ? { textValue: email } : null;
    }
    case 'Teléfono': {
      const parsed = safeJsonParse(cv.value);
      const phone = parsed?.phone ?? text;
      return phone ? { textValue: phone } : null;
    }
    case 'Archivo': {
      const parsed = safeJsonParse(cv.value);
      const url = parsed?.url ?? null;
      return url ? { fileUrl: url } : null;
    }
    default:
      return text ? { textValue: text } : null;
  }
}

// Extrae el valor "núcleo" (email/phone/idNumber) de un column_value, usando
// el campo estructurado cuando existe en vez del `.text` genérico.
function coreValueFromColumnValue(cv, coreKey) {
  const parsed = safeJsonParse(cv.value);
  if (coreKey === 'email') return parsed?.email ?? cv.text ?? '';
  if (coreKey === 'phone') return parsed?.phone ?? cv.text ?? '';
  return cv.text ?? '';
}

async function getOrCreateBoard(entry, boardOrderByProject) {
  const existing = await Boards.findAll({
    filters: { projectCode: entry.projectCode, boardName: entry.boardName },
    limit: 5,
  });
  const live = existing.records.find((b) => !b.deletedAt);
  if (live) return { id: live.id, created: false };

  const order = boardOrderByProject.get(entry.projectCode) ?? 0;
  boardOrderByProject.set(entry.projectCode, order + 1);

  if (DRY_RUN) return { id: `dry-run-board-${entry.boardId}`, created: true };

  const created = await Boards.create({
    record: {
      boardName: entry.boardName,
      projectCode: entry.projectCode,
      boardOrder: order,
      boardType: 'recruitment',
    },
  });
  return { id: created.id, created: true };
}

async function getOrCreateColumns(hubBoardId, mondayColumns) {
  // colId -> { hubColumnId, hubColumnType } para columnas NO-núcleo.
  // coreColumnIds: set de column ids de Monday que son núcleo (nombre/email/
  // teléfono/identificación) y por lo tanto no se convierten en columna.
  const colMap = new Map();
  const coreColumnIds = new Set();

  const existingCols = DRY_RUN
    ? { records: [] }
    : await BoardColumns.findAll({ filters: { boardId: hubBoardId }, limit: 500 });
  const existingByName = new Map(existingCols.records.map((c) => [normalize(c.columnName), c]));

  let nextOrder = existingCols.records.length;
  const toCreate = [];

  for (const col of mondayColumns) {
    if (col.type === 'name') { coreColumnIds.add(col.id); continue; }
    if (SKIP_MONDAY_TYPES.has(col.type)) continue;
    const core = matchCore(col.title);
    if (core) { coreColumnIds.add(col.id); continue; }

    const already = existingByName.get(normalize(col.title));
    if (already) {
      colMap.set(col.id, { hubColumnId: already.id, hubColumnType: already.columnType ?? 'Texto' });
      continue;
    }
    const hubColumnType = toHubColumnType(col.type);
    toCreate.push({ mondayColId: col.id, columnName: col.title, columnType: hubColumnType, columnOrder: nextOrder++ });
  }

  if (toCreate.length > 0 && !DRY_RUN) {
    const { records: created } = await BoardColumns.bulkCreate({
      records: toCreate.map((c) => ({
        boardId: hubBoardId,
        columnName: c.columnName,
        columnType: c.columnType,
        columnOrder: c.columnOrder,
      })),
    });
    for (let i = 0; i < toCreate.length; i++) {
      colMap.set(toCreate[i].mondayColId, { hubColumnId: created[i].id, hubColumnType: toCreate[i].columnType });
    }
  } else if (toCreate.length > 0 && DRY_RUN) {
    for (const c of toCreate) colMap.set(c.mondayColId, { hubColumnId: `dry-run-col-${c.mondayColId}`, hubColumnType: c.columnType });
  }

  return { colMap, coreColumnIds, columnsCreated: toCreate.length };
}

async function getOrCreateGroupColumns(hubBoardId, groupNamesInOrder) {
  const groupsBoardId = `${hubBoardId}::groups`;
  const groupColMap = new Map();
  if (groupNamesInOrder.length === 0) return { groupsBoardId, groupColMap, groupsCreated: 0 };

  const existing = DRY_RUN
    ? { records: [] }
    : await BoardColumns.findAll({ filters: { boardId: groupsBoardId }, limit: 200 });
  const existingByName = new Map(existing.records.map((c) => [normalize(c.columnName), c]));

  let nextOrder = existing.records.length;
  const toCreate = [];
  for (const name of groupNamesInOrder) {
    const already = existingByName.get(normalize(name));
    if (already) { groupColMap.set(name, already.id); continue; }
    toCreate.push({ name, columnOrder: nextOrder++ });
  }

  if (toCreate.length > 0 && !DRY_RUN) {
    const { records: created } = await BoardColumns.bulkCreate({
      records: toCreate.map((g, i) => ({
        boardId: groupsBoardId,
        columnName: g.name,
        columnType: GROUP_COLOR_IDS[g.columnOrder % GROUP_COLOR_IDS.length],
        columnOrder: g.columnOrder,
      })),
    });
    for (let i = 0; i < toCreate.length; i++) groupColMap.set(toCreate[i].name, created[i].id);
  } else if (toCreate.length > 0 && DRY_RUN) {
    for (const g of toCreate) groupColMap.set(g.name, `dry-run-group-${g.name}`);
  }

  return { groupsBoardId, groupColMap, groupsCreated: toCreate.length };
}

function itemToCore(item, coreColumnIds) {
  const coreFields = { participantName: item.name };
  for (const cv of item.column_values) {
    if (!coreColumnIds.has(cv.id)) continue;
    const col = item.__colById?.get(cv.id);
    const key = col ? matchCore(col.title) : null;
    if (key && key !== 'participantName') {
      const val = coreValueFromColumnValue(cv, key);
      if (val) coreFields[key] = val;
    }
  }
  return coreFields;
}

async function loadBoard(entry, boardOrderByProject, stats) {
  const dataPath = path.join(DATA_DIR, `${entry.boardId}.json`);
  if (!fs.existsSync(dataPath)) {
    console.log(`   ⚠️  ${entry.boardName} (${entry.boardId}) — no exportado todavía, se salta`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const colById = new Map(data.columns.map((c) => [c.id, c]));

  const { id: hubBoardId, created: boardCreated } = await getOrCreateBoard(entry, boardOrderByProject);
  const { colMap, coreColumnIds, columnsCreated } = await getOrCreateColumns(hubBoardId, data.columns);

  const groupNamesInOrder = [];
  const seenGroupNames = new Set();
  for (const item of data.items) {
    const name = item.group?.title;
    if (name && !seenGroupNames.has(name)) { seenGroupNames.add(name); groupNamesInOrder.push(name); }
  }
  const { groupsBoardId, groupColMap, groupsCreated } = await getOrCreateGroupColumns(hubBoardId, groupNamesInOrder);

  // ── de-dup para reruns: qué sourceForm ya existe para este tablero ────────
  const sourceFormPrefix = `monday|${entry.boardId}|`;
  const existingSourceForms = DRY_RUN
    ? new Set()
    : new Set(
        (
          await RecruitmentRows.findAll({
            filters: { boardId: hubBoardId },
            limit: 5000,
            fields: ['sourceForm'],
          })
        ).records
          .map((r) => r.sourceForm)
          .filter((sf) => sf && sf.startsWith(sourceFormPrefix))
      );

  let rowsCreated = 0;
  let rowsSkipped = 0;
  let cellsCreated = 0;

  for (let bi = 0; bi < data.items.length; bi += BATCH_SIZE) {
    const batch = data.items.slice(bi, bi + BATCH_SIZE);
    const toImport = batch.filter((it) => !existingSourceForms.has(`${sourceFormPrefix}${it.id}`));
    rowsSkipped += batch.length - toImport.length;
    if (toImport.length === 0) continue;

    const prepared = toImport.map((item) => {
      item.__colById = colById;
      const coreFields = itemToCore(item, coreColumnIds);
      const cellsToWrite = [];
      for (const cv of item.column_values) {
        if (coreColumnIds.has(cv.id)) continue;
        const mapped = colMap.get(cv.id);
        if (!mapped) continue;
        const typed = toCellFields(cv, mapped.hubColumnType);
        if (typed) cellsToWrite.push({ columnId: mapped.hubColumnId, ...typed });
      }
      const rowOrder = item.created_at ? Math.floor(new Date(item.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000);
      return {
        sourceForm: `${sourceFormPrefix}${item.id}`,
        coreFields,
        group: item.group?.title ?? null,
        rowOrder,
        cellsToWrite,
      };
    });

    if (DRY_RUN) {
      rowsCreated += prepared.length;
      cellsCreated += prepared.reduce((n, p) => n + p.cellsToWrite.length + (p.group ? 1 : 0), 0);
      continue;
    }

    await Participants.bulkCreate({
      records: prepared.map((p) => ({
        fullName: p.coreFields.participantName,
        email: p.coreFields.email,
        phone: p.coreFields.phone,
        idNumber: p.coreFields.idNumber,
      })),
      matchOn: ['email'],
    });

    const { records: createdRows } = await RecruitmentRows.bulkCreate({
      records: prepared.map((p) => ({
        rowName: p.coreFields.participantName || p.coreFields.email || 'Sin nombre',
        projectCode: entry.projectCode,
        boardName: entry.boardName,
        boardId: hubBoardId,
        participantName: p.coreFields.participantName,
        email: p.coreFields.email,
        phone: p.coreFields.phone,
        idNumber: p.coreFields.idNumber,
        group: p.group,
        level: 0,
        rowOrder: p.rowOrder,
        sourceForm: p.sourceForm,
      })),
    });

    const cellRecords = [];
    const cellDataUpdates = [];
    for (let i = 0; i < prepared.length; i++) {
      const p = prepared[i];
      const row = createdRows[i];
      if (!row) continue;
      const cellData = {};
      for (const c of p.cellsToWrite) {
        const { columnId, ...typed } = c;
        cellRecords.push({ boardId: hubBoardId, rowId: row.id, columnId, ...typed });
        cellData[columnId] = typed;
      }
      if (p.group && groupColMap.has(p.group)) {
        cellRecords.push({ boardId: groupsBoardId, rowId: row.id, columnId: groupColMap.get(p.group), textValue: '1' });
      }
      if (Object.keys(cellData).length) cellDataUpdates.push({ id: row.id, cellData: JSON.stringify(cellData) });
    }
    for (let ci = 0; ci < cellRecords.length; ci += CELL_CHUNK) {
      await CellValues.bulkCreate({ records: cellRecords.slice(ci, ci + CELL_CHUNK) });
    }
    if (cellDataUpdates.length) await RecruitmentRows.bulkUpdate(cellDataUpdates);

    rowsCreated += prepared.length;
    cellsCreated += cellRecords.length;
  }

  const verb = DRY_RUN ? '(dry-run)' : boardCreated ? 'creado' : 'ya existía';
  console.log(
    `   ✅ ${entry.boardName} (${entry.boardId}) ${verb} — board ${columnsCreated} col. nuevas, ${groupsCreated} grupos, ${rowsCreated} filas (${rowsSkipped} ya migradas), ${cellsCreated} celdas`
  );

  if (!DRY_RUN && rowsCreated + rowsSkipped !== data.items.length) {
    throw new Error(
      `${entry.boardName}: esperaba cubrir ${data.items.length} items, cubrió ${rowsCreated + rowsSkipped} (creadas+ya migradas)`
    );
  }

  stats.boards += 1;
  stats.columns += columnsCreated;
  stats.rows += rowsCreated;
  stats.rowsSkipped += rowsSkipped;
  stats.cells += cellsCreated;
}

async function main() {
  const confirmed = JSON.parse(fs.readFileSync(CONFIRMED_PATH, 'utf-8'));
  const toLoad = ONLY ? confirmed.filter((e) => e.boardId === ONLY) : confirmed;
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Cargando ${toLoad.length} tablero(s)...`);

  const boardOrderByProject = new Map();
  const stats = { boards: 0, columns: 0, rows: 0, rowsSkipped: 0, cells: 0 };

  for (const entry of toLoad) {
    try {
      await loadBoard(entry, boardOrderByProject, stats);
    } catch (e) {
      console.log(`   ❌ ${entry.boardName} (${entry.boardId}): ${e.message}`);
    }
  }

  console.log(
    `\nResumen: ${stats.boards} tableros, ${stats.columns} columnas nuevas, ${stats.rows} filas nuevas (${stats.rowsSkipped} ya migradas), ${stats.cells} celdas.`
  );
}

await main();
process.exit(0);
