// Pruebas del código de proyecto sin espacios de más (caso del proyecto que quedó guardado con un espacio al final: el navegador se lo quita a la dirección, el Hub
// ya no lo encontraba y sus tableros y tareas quedaban partidos entre las dos escrituras) contra una base en memoria (PGlite) con el esquema real: crear un
// proyecto, aprobar un deal, renombrar desde un código sucio y guardar un campo suelto de un proyecto que ya estaba sucio. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-codigo-proyecto.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import saveProject from '../../src/api/saveProject';
import approveDeal from '../../src/api/approveDeal';

/** Los endpoints escriben bitácora con console.log: en las pruebas se calla para que se lea el resultado. */
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
const q = async (sql: string, params?: unknown[]) => {
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

const ctx = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
const crear = (input: Record<string, unknown>): Promise<any> => sinBitacora(() => saveProject.run(input as any, ctx));
const guardar = (input: Record<string, unknown>): Promise<any> => sinBitacora(() => saveProject.run(input as any, ctx));
const proyecto = async (codigo: string) => (await pg.query<any>(`select id, project_code, client from projects where project_code = $1`, [codigo])).rows[0];
const cuenta = async (tabla: string, codigo: string) => Number((await pg.query<any>(`select count(*) as n from ${tabla} where project_code = $1`, [codigo])).rows[0].n);

await prueba('crear un proyecto con espacios al inicio y al final: se guarda sin ellos, y sus 2 tableros y 7 tareas también', async () => {
  const r = await crear({ projectCode: '  PRUEBA UNO  ', client: 'Cliente X' });
  assert.equal(r.success, true);
  const p = await proyecto('PRUEBA UNO');
  assert.ok(p, 'el proyecto no está con el código limpio');
  assert.equal(p.client, 'Cliente X');
  assert.equal(await cuenta('boards', 'PRUEBA UNO'), 2);
  assert.equal(await cuenta('tasks', 'PRUEBA UNO'), 7);
  // y nada quedó con el código sucio
  const sucias = (await pg.query<any>(`select project_code from tasks where project_code like '% ' or project_code like ' %' union all select project_code from boards where project_code like '% ' or project_code like ' %' union all select project_code from projects where project_code like '% ' or project_code like ' %'`)).rows;
  assert.deepEqual(sucias, []);
});

await prueba('un código que ya existe se rechaza aunque venga con otros espacios o en minúsculas', async () => {
  await assert.rejects(() => crear({ projectCode: 'prueba uno ' }), /Ya existe un proyecto/);
});

await prueba('aprobar un deal cuyo nombre trae espacios al final: el proyecto, sus tableros y sus tareas quedan con el código limpio', async () => {
  const dealId = (await pg.query<{ id: string }>(`insert into deals (deal_name, client, phase) values ('Deal de prueba  ', 'Cliente Y', 'Negociación') returning id`)).rows[0].id;
  const r: any = await sinBitacora(() => approveDeal.run({ dealId } as any, ctx));
  assert.equal(r.projectCode, 'Deal de prueba');
  assert.ok(await proyecto('Deal de prueba'));
  assert.equal(await cuenta('boards', 'Deal de prueba'), 2);
  assert.equal(await cuenta('tasks', 'Deal de prueba'), 7);
});

// Un proyecto que ya estaba sucio desde antes (como el que se corrigió a mano): código con espacio, un tablero, dos tareas y un evento con el mismo código.
const sucio = async (codigo: string) => {
  const id = (await pg.query<{ id: string }>(`insert into projects (project_code, client) values ($1, 'Cliente Z') returning id`, [codigo])).rows[0].id;
  await pg.query(`insert into boards (board_name, project_code, board_type) values ('Timeline', $1, 'pm')`, [codigo]);
  await pg.query(`insert into tasks (task_name, project_code, board_name) values ('Una', $1, 'Timeline'), ('Otra', $1, 'Timeline')`, [codigo]);
  await pg.query(`insert into calendar_events (event_name, project_code) values ('Evento', $1)`, [codigo]);
  return id;
};

await prueba('guardar un campo suelto de un proyecto que ya estaba sucio (como al editar una celda en la lista) lo corrige solo, con todos sus datos', async () => {
  const id = await sucio('SUCIO ');
  const r = await guardar({ id, projectCode: 'SUCIO ', client: 'Cliente nuevo' });
  assert.equal(r.cascaded, true);
  assert.equal((await proyecto('SUCIO'))?.client, 'Cliente nuevo');
  assert.equal(await cuenta('projects', 'SUCIO '), 0);
  for (const tabla of ['boards', 'tasks', 'calendar_events']) {
    assert.equal(await cuenta(tabla, 'SUCIO '), 0, `${tabla} sigue con el código sucio`);
  }
  assert.equal(await cuenta('boards', 'SUCIO'), 1);
  assert.equal(await cuenta('tasks', 'SUCIO'), 2);
  assert.equal(await cuenta('calendar_events', 'SUCIO'), 1);
});

await prueba('renombrar desde un código sucio con oldProjectCode (el formulario del proyecto) pasa todos sus datos al código nuevo', async () => {
  const id = await sucio('VIEJO ');
  const r = await guardar({ id, projectCode: 'NUEVO', oldProjectCode: 'VIEJO ' });
  assert.equal(r.cascaded, true);
  assert.equal(await cuenta('projects', 'VIEJO '), 0);
  assert.ok(await proyecto('NUEVO'));
  assert.equal(await cuenta('tasks', 'NUEVO'), 2);
  assert.equal(await cuenta('boards', 'NUEVO'), 1);
  assert.equal(await cuenta('calendar_events', 'NUEVO'), 1);
});

await prueba('guardar un campo suelto de un proyecto limpio no mueve nada', async () => {
  const p = await proyecto('PRUEBA UNO');
  const r = await guardar({ id: p.id, projectCode: 'PRUEBA UNO', client: 'Cliente cambiado' });
  assert.equal(r.cascaded, undefined);
  assert.equal((await proyecto('PRUEBA UNO')).client, 'Cliente cambiado');
  assert.equal(await cuenta('tasks', 'PRUEBA UNO'), 7);
});

await prueba('renombrar un proyecto limpio de verdad (código distinto) sí pasa sus datos al código nuevo, sin espacios', async () => {
  const p = await proyecto('PRUEBA UNO');
  const r = await guardar({ id: p.id, projectCode: ' PRUEBA DOS ', oldProjectCode: 'PRUEBA UNO' });
  assert.equal(r.cascaded, true);
  assert.equal(await cuenta('projects', 'PRUEBA UNO'), 0);
  assert.ok(await proyecto('PRUEBA DOS'));
  assert.equal(await cuenta('tasks', 'PRUEBA DOS'), 7);
  assert.equal(await cuenta('boards', 'PRUEBA DOS'), 2);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
