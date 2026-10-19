// Pruebas del endpoint del Timeline General (getTasksForGantt) contra una base en memoria (PGlite) con el esquema real: de dónde salen el color y el grupo
// de cada tarea, que gane el color más reciente, que lo borrado y lo de otros tableros no cuente, y que las consultas pesadas pidan solo lo necesario
// (las columnas de los tableros que se usan y las celdas de color y de grupo): sin eso Postgres lee la tabla de celdas completa. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-gantt.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getTasksForGantt from '../../src/api/getTasksForGantt';

/** El endpoint escribe bitácora con console.log: en las pruebas se calla para que se lea el resultado. */
const sinBitacora = async <T>(f: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try { return await f(); } finally { console.log = original; }
};

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}

const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const consultas: string[] = [];
const q = async (sql: string, params?: unknown[]) => {
  consultas.push(sql.replace(/\s+/g, ' '));
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);

const id = async (sql: string, params: unknown[]) => (await pg.query<{ id: string }>(`${sql} returning id`, params as any)).rows[0].id;
const tablero = (nombre: string, tipo: string | null, borrado = false) =>
  id(`insert into boards (board_name, project_code, board_type, deleted_at) values ($1, 'P-UNO', $2, ${borrado ? 'now()' : 'null'})`, [nombre, tipo]);
const columna = (boardId: string, nombre: string, tipo: string, orden: number) =>
  id(`insert into board_columns (column_name, board_id, column_type, column_order) values ($1, $2, $3, $4)`, [nombre, boardId, tipo, orden]);
const tarea = (nombre: string, boardId: string, tablero_: string, inicio: string, fin: string) =>
  id(`insert into tasks (task_name, project_code, board_name, board_id, status, start_date, end_date) values ($1, 'P-UNO', $2, $3, 'En progreso', $4, $5)`, [nombre, tablero_, boardId, inicio, fin]);
const celda = (boardId: string, rowId: string, columnId: string, texto: string, actualizada: string, borrada = '') =>
  pg.query(`insert into cell_values (board_id, row_id, column_id, text_value, deleted_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $6)`, [boardId, rowId, columnId, texto, borrada, actualizada]);

await pg.query(`insert into projects (project_code, status) values ('P-UNO', 'En curso')`);

// Tablero de tareas con su grupo: dos columnas de fecha, una de color, una de texto que no se usa, y un tablero «::groups» con dos columnas de grupo.
const b1 = await tablero('Timeline', 'pm');
const cInicio = await columna(b1, 'Inicio', 'Fecha', 1);
const cFin = await columna(b1, 'Fin', 'Fecha', 2);
const cColor = await columna(b1, 'Color', 'Color', 3);
const cNotas = await columna(b1, 'Notas', 'Texto', 4);
const gA = await columna(`${b1}::groups`, 'Fase A', 'azul', 1);
const gB = await columna(`${b1}::groups`, 'Fase B', 'verde', 2);
// Otros tableros que no cuentan: uno de calendario, uno borrado y uno de reclutamiento (sin tareas), cada uno con su color y celdas.
const bCal = await tablero('Calendario', 'calendar');
const bBorrado = await tablero('Viejo', 'pm', true);
const bReclutamiento = `reclutamiento-sin-tareas`;
const cColorCal = await columna(bCal, 'Color', 'Color', 1);
const cColorReclu = await columna(bReclutamiento, 'Color', 'Color', 1);

const t1 = await tarea('Primera', b1, 'Timeline', '2026-10-01', '2026-10-05');
const t2 = await tarea('Segunda', b1, 'Timeline', '2026-10-06', '2026-10-09');
const t3 = await tarea('Tercera', b1, 'Timeline', '2026-10-10', '2026-10-12');
await tarea('De un tablero borrado', bBorrado, 'Viejo', '2026-09-01', '2026-09-02');
await tarea('De calendario', bCal, 'Calendario', '2026-09-03', '2026-09-04');

// Color: la primera tiene dos guardados (gana el más reciente); la segunda solo uno borrado y uno vacío (no cuentan); la tercera, uno.
await celda(b1, t1, cColor, '#111111', '2026-10-01T10:00:00Z');
await celda(b1, t1, cColor, '#222222', '2026-10-02T10:00:00Z');
await celda(b1, t2, cColor, '#333333', '2026-10-03T10:00:00Z', '2026-10-04T00:00:00Z'); // borrada
await celda(b1, t2, cColor, '', '2026-10-05T10:00:00Z'); // vacía
await celda(b1, t3, cColor, 'green-3', '2026-10-06T10:00:00Z');
// Lo que no se usa: una columna de texto del mismo tablero, y celdas de color de otros tableros con los mismos ids de fila.
await celda(b1, t1, cNotas, '#999999', '2026-10-07T10:00:00Z');
await celda(bCal, t1, cColorCal, '#aaaaaa', '2026-10-07T10:00:00Z');
await celda(bReclutamiento, t1, cColorReclu, '#bbbbbb', '2026-10-07T10:00:00Z');
// Grupo: la primera en «Fase A»; la segunda tiene un 0 (no está en el grupo); la tercera en «Fase B».
await celda(`${b1}::groups`, t1, gA, '1', '2026-10-01T10:00:00Z');
await celda(`${b1}::groups`, t2, gA, '0', '2026-10-01T10:00:00Z');
await celda(`${b1}::groups`, t3, gB, '1', '2026-10-01T10:00:00Z');

const ctx = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
consultas.length = 0;
const r: any = await sinBitacora(() => getTasksForGantt.run({}, ctx));
const consultasDelEndpoint = [...consultas];
const tarea_ = (nombre: string) => r.tasks.find((t: any) => t.taskName === nombre);

await prueba('salen las tareas de tableros de tareas vivos (no las de un tablero borrado ni de calendario), con sus fechas, tablero y las columnas de fecha y color', () => {
  assert.deepEqual(r.tasks.map((t: any) => t.taskName).sort(), ['Primera', 'Segunda', 'Tercera']);
  const p = tarea_('Primera');
  assert.deepEqual([p.startDate, p.endDate, p.boardId, p.boardName, p.projectCode, p.status], ['2026-10-01', '2026-10-05', b1, 'Timeline', 'P-UNO', 'En progreso']);
  assert.deepEqual([p.startColumnId, p.endColumnId, p.colorColumnId], [cInicio, cFin, cColor]);
  assert.deepEqual(r.projectStatuses, { 'P-UNO': 'En curso' });
});
await prueba('el color es el de la columna Color del tablero: gana el más reciente; una celda borrada, una vacía, otra columna u otro tablero no cuentan', () => {
  assert.equal(tarea_('Primera').taskColor, '#222222');
  assert.equal(tarea_('Segunda').taskColor, undefined);
  assert.equal(tarea_('Tercera').taskColor, 'green-3');
});
await prueba('el grupo sale de las celdas «1» del tablero ::groups, con el nombre y el color de la columna; un «0» no es del grupo', () => {
  assert.deepEqual([tarea_('Primera').groupName, tarea_('Primera').groupColorId], ['Fase A', 'azul']);
  assert.equal(tarea_('Segunda').groupName, undefined);
  assert.deepEqual([tarea_('Tercera').groupName, tarea_('Tercera').groupColorId], ['Fase B', 'verde']);
});
await prueba('es estable: dos corridas dan exactamente lo mismo', async () => {
  const otra: any = await sinBitacora(() => getTasksForGantt.run({}, ctx));
  assert.equal(JSON.stringify(otra.tasks), JSON.stringify(r.tasks));
});
await prueba('las consultas pesadas piden solo lo necesario: columnas de los tableros que se usan y celdas de color y de grupo (si no, Postgres lee toda la tabla de celdas)', () => {
  const columnas = consultasDelEndpoint.filter((s) => /from "board_columns"/i.test(s));
  const celdas = consultasDelEndpoint.filter((s) => /from "cell_values"/i.test(s));
  assert.equal(columnas.length, 1);
  assert.match(columnas[0], /"board_id" = any\(\$1\)/);
  assert.equal(celdas.length, 1);
  assert.match(celdas[0], /"board_id" = any\(\$1\)/);
  assert.match(celdas[0], /"column_id" = any\(\$2\)/);
  // Y solo pide los campos que usa, no las trece columnas de cada celda.
  assert.ok(!/number_value|file_url|boolean_value/.test(celdas[0]), celdas[0]);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
