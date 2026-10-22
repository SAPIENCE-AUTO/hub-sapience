// Pruebas del orden manual de los eventos (lista de eventos del proyecto) contra una base en memoria (PGlite) con el esquema real: que reorderCalendarEvents
// guarde el número de cada evento sin tocar nada más (sobre todo, sin marcar la invitación como «Por actualizar»), que getTasks lo devuelva en las dos rutas de
// eventos y que, con la regla del componente (src/lib/ordenFilas.ts), un evento nuevo caiga al final y uno acomodado a mano salga donde se dejó. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-orden-eventos.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getTasks from '../../src/api/getTasks';
import reorderCalendarEvents from '../../src/api/reorderCalendarEvents';
import { ordenarFilas } from '../../src/lib/ordenFilas';

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

// getTasks pregunta por el estado de Zoom de cada evento; esa tabla no sale del esquema generado (la crea add-observation-room-tables.ts), así que aquí va solo con lo que se lee.
await pg.exec(`create table observation_sessions (calendar_event_id uuid, zoom_meeting_id text, zoom_needs_update boolean)`);
await pg.query(`insert into projects (project_code, status) values ('P-UNO', 'En curso'), ('P-DOS', 'En curso')`);
// Cuatro eventos del proyecto, creados en este orden (el orden «de siempre» de la lista), con una invitación ya enviada en el primero; y uno de otro proyecto.
const evento = async (nombre: string, proyecto: string, creado: string, invitacion: string | null = null) =>
  (await pg.query<{ id: string }>(
    `insert into calendar_events (event_name, project_code, calendar_name, invite_status, created_at) values ($1, $2, 'Cal', $3, $4) returning id`,
    [nombre, proyecto, invitacion, creado],
  )).rows[0].id;
const e1 = await evento('Primero', 'P-UNO', '2026-10-01T10:00:00Z', 'Enviado');
const e2 = await evento('Segundo', 'P-UNO', '2026-10-02T10:00:00Z');
const e3 = await evento('Tercero', 'P-UNO', '2026-10-03T10:00:00Z');
const e4 = await evento('Cuarto', 'P-UNO', '2026-10-04T10:00:00Z');
const otro = await evento('De otro proyecto', 'P-DOS', '2026-10-05T10:00:00Z');

const ctx = { user: { id: 'u1', email: 'alguien@ejemplo.test' } } as any;
const eventos = async (extra: Record<string, unknown> = { only: 'events' }): Promise<any[]> =>
  ((await sinBitacora(() => getTasks.run({ projectCode: 'P-UNO', ...extra } as any, ctx))) as any).calendarEvents;
const nombres = (lista: any[]) => lista.map((e) => e.eventName);

await prueba('antes de acomodar nada: salen por fecha de creación y sin número', async () => {
  const lista = await eventos();
  assert.deepEqual(nombres(lista), ['Primero', 'Segundo', 'Tercero', 'Cuarto']);
  assert.ok(lista.every((e) => e.rowOrder === undefined));
  assert.deepEqual(nombres(ordenarFilas(lista)), ['Primero', 'Segundo', 'Tercero', 'Cuarto']);
});

await prueba('reorderCalendarEvents guarda el número de cada evento y devuelve success', async () => {
  const r: any = await sinBitacora(() => reorderCalendarEvents.run({ updates: [{ id: e4, rowOrder: 1000 }, { id: e2, rowOrder: 2000 }, { id: e1, rowOrder: 3000 }, { id: e3, rowOrder: 4000 }] }, ctx));
  assert.deepEqual(r, { success: true });
  const { rows } = await pg.query<{ id: string; row_order: number }>(`select id, row_order from calendar_events where project_code = 'P-UNO' order by row_order`);
  assert.deepEqual(rows.map((x) => [x.id, Number(x.row_order)]), [[e4, 1000], [e2, 2000], [e1, 3000], [e3, 4000]]);
});

await prueba('getTasks devuelve el número en la ruta de solo eventos y en la completa, y el componente los acomoda con él', async () => {
  for (const extra of [{ only: 'events' }, {}]) {
    const lista = await eventos(extra);
    assert.deepEqual(lista.map((e) => e.rowOrder).sort((a, b) => a - b), [1000, 2000, 3000, 4000]);
    assert.deepEqual(nombres(ordenarFilas(lista)), ['Cuarto', 'Segundo', 'Primero', 'Tercero']);
  }
});

await prueba('mover de lugar un evento no toca nada más: la invitación sigue «Enviado» y nombre, proyecto y fecha quedan igual', async () => {
  const { rows } = await pg.query<any>(`select event_name, project_code, invite_status from calendar_events where id = $1`, [e1]);
  assert.deepEqual(rows[0], { event_name: 'Primero', project_code: 'P-UNO', invite_status: 'Enviado' });
});

await prueba('los eventos de otro proyecto no se ven afectados ni salen en esta lista', async () => {
  const { rows } = await pg.query<any>(`select row_order from calendar_events where id = $1`, [otro]);
  assert.equal(rows[0].row_order, null);
  assert.ok(!nombres(await eventos()).includes('De otro proyecto'));
});

await prueba('un evento creado después de acomodar va al final, no hasta arriba', async () => {
  await evento('Quinto', 'P-UNO', '2026-10-06T10:00:00Z');
  assert.deepEqual(nombres(ordenarFilas(await eventos())), ['Cuarto', 'Segundo', 'Primero', 'Tercero', 'Quinto']);
});

await prueba('es estable: pedir la lista dos veces da lo mismo', async () => {
  assert.equal(JSON.stringify(await eventos()), JSON.stringify(await eventos()));
});

await prueba('una lista vacía de cambios no falla; un número que no es número se rechaza', async () => {
  assert.deepEqual(await sinBitacora(() => reorderCalendarEvents.run({ updates: [] }, ctx)), { success: true });
  await assert.rejects(() => sinBitacora(() => reorderCalendarEvents.run({ updates: [{ id: e1, rowOrder: 'uno' as any }] }, ctx)));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
