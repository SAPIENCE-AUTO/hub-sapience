// Pruebas de la columna «NDA» en las vistas externas (la liga de solo lectura que se comparte fuera del equipo): se muestra solo si la vista la trae, con el estado de cada
// persona y nada más (ni la liga de firma, ni la IP, ni el dispositivo, ni la firma). Contra una base en memoria (PGlite) con el esquema real. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-vista-externa-nda.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import getSharedViewData from '../../src/api/getSharedViewData';

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

// Quien abre la liga no tiene cuenta.
const anonimo = { user: null, ip: '198.51.100.20', userAgent: 'Mozilla/5.0 (Prueba)' } as any;
const ver = async (token: string): Promise<any> => getSharedViewData.run({ token } as any, anonimo);

// ── Datos inventados: un proyecto con seis personas ───────────────────────────────────────────────
const PROYECTO = 'PRY-001';
const TABLERO = 'TABLERO A';
const persona = async (nombre: string, extra: { ndaSent?: boolean; ndaSentDate?: string } = {}) =>
  (await pg.query<{ id: string }>(
    `insert into recruitment_rows (participant_name, email, phone, status, project_code, board_name, nda_sent, nda_sent_date)
     values ($1, $2, '5500000000', 'Confirmado', $3, $4, $5, $6) returning id`,
    [nombre, `${nombre.toLowerCase()}@ejemplo.test`, PROYECTO, TABLERO, extra.ndaSent ?? false, extra.ndaSentDate ?? null],
  )).rows[0].id;

const ana = await persona('Ana');
const beto = await persona('Beto');
const carla = await persona('Carla');
const dani = await persona('Dani');
const eli = await persona('Eli', { ndaSent: true, ndaSentDate: '2026-10-01T15:00:00Z' }); // marcada a mano, sin envío con liga
const fer = await persona('Fer');

// Un envío del NDA. Los datos sensibles llevan nombres reconocibles para comprobar que nunca salen.
const envio = async (fila: string, estado: string, o: { enviado?: string; abierto?: string; firmado?: string; rechazado?: string; token: string }) =>
  (await pg.query<{ id: string }>(
    `insert into nda_envios (token, recruitment_row_id, project_code, nombre, correo, estado, enviado_at, abierto_at, firmado_at, rechazado_at, firma_png, ip, user_agent, sesion_texto, enviado_por)
     values ($1, $2, $3, 'Nombre Secreto', $4, $5, $6, $7, $8, $9, 'FIRMA-SECRETA', '203.0.113.7', 'DISPOSITIVO-SECRETO', 'Sesión secreta', 'equipo@ejemplo.test') returning id`,
    [o.token, fila, PROYECTO, `${o.token.toLowerCase()}@nda.ejemplo.test`, estado, o.enviado ?? '2026-11-01T10:00:00Z', o.abierto ?? null, o.firmado ?? null, o.rechazado ?? null],
  )).rows[0].id;

const envios: string[] = [];
envios.push(await envio(ana, 'firmado', { token: 'TOKEN-SECRETO-ANA', abierto: '2026-11-01T11:00:00Z', firmado: '2026-11-01T11:05:00Z' }));
envios.push(await envio(beto, 'abierto', { token: 'TOKEN-SECRETO-BETO', abierto: '2026-11-02T09:30:00Z' }));
envios.push(await envio(carla, 'rechazado', { token: 'TOKEN-SECRETO-CARLA-1', abierto: '2026-11-01T12:00:00Z', rechazado: '2026-11-01T12:10:00Z' }));
envios.push(await envio(carla, 'enviado', { token: 'TOKEN-SECRETO-CARLA-2', enviado: '2026-11-03T08:00:00Z' })); // se lo mandaron de nuevo: este es el último
envios.push(await envio(dani, 'enviado', { token: 'TOKEN-SECRETO-DANI', enviado: '2026-11-02T16:00:00Z' }));

// Vistas: una externa ligada a una vista interna (lee sus columnas en vivo), con y sin la columna NDA; y dos «solas» con sus propias columnas guardadas.
const externa = (token: string, o: { visibles?: string[]; interna?: { ocultas: string[] } }) => pg.query(
  `insert into shared_views (view_name, project_code, board_name, token, visible_columns_json, active, type, filters_json) values ($1, $2, $3, $4, $5, true, 'External', '{}')`,
  [`🔗 Vista ${token}`, PROYECTO, TABLERO, token, o.visibles ? JSON.stringify(o.visibles) : null],
).then(() => o.interna && pg.query(
  `insert into shared_views (view_name, project_code, board_name, shared_token, filters_json, active, type) values ($1, $2, $3, $4, $5, true, 'Internal')`,
  [`Vista interna ${token}`, PROYECTO, TABLERO, token, JSON.stringify({ hiddenColumns: o.interna.ocultas })],
));
await externa('LIGADA-CON-NDA', { interna: { ocultas: ['idNumber'] } });
await externa('LIGADA-SIN-NDA', { interna: { ocultas: ['idNumber', 'nda'] } });
await externa('SOLA-CON-NDA', { visibles: ['participantName', 'status', 'nda'] });
await externa('SOLA-SIN-NDA', { visibles: ['participantName', 'email', 'phone', 'status'] });

const estadosPorNombre = (salida: any) => Object.fromEntries(salida.rows.map((r: any) => [r.participantName, r.ndaEstado ?? null]));
const instantanea = async () => JSON.stringify((await pg.query(`select id, estado, abierto_at, firmado_at, rechazado_at, envios from nda_envios order by n`)).rows);

await prueba('una vista externa ligada a una vista interna que muestra «NDA» trae la columna, después del estado', async () => {
  const v = await ver('LIGADA-CON-NDA');
  assert.equal(v.found, true);
  assert.deepEqual(v.visibleColumns, ['participantName', 'email', 'phone', 'status', 'nda']);
});

await prueba('cada persona sale con el estado de su NDA: Firmó, Abrió, Rechazó o Enviado; sin NDA, vacío', async () => {
  const v = await ver('LIGADA-CON-NDA');
  assert.deepEqual(estadosPorNombre(v), { Ana: 'firmado', Beto: 'abierto', Carla: 'enviado', Dani: 'enviado', Eli: 'enviado', Fer: null });
});

await prueba('si le mandaron el NDA otra vez, cuenta el último envío (no el que rechazó antes)', async () => {
  const carlaFila = (await ver('LIGADA-CON-NDA')).rows.find((r: any) => r.participantName === 'Carla');
  assert.equal(carlaFila.ndaEstado, 'enviado');
  assert.equal(carlaFila.ndaFecha, '2026-11-03T08:00:00.000Z');
});

await prueba('la fecha que sale es la del último paso: firmó, abrió o lo enviaron', async () => {
  const filas = Object.fromEntries((await ver('LIGADA-CON-NDA')).rows.map((r: any) => [r.participantName, r.ndaFecha]));
  assert.equal(filas.Ana, '2026-11-01T11:05:00.000Z');
  assert.equal(filas.Beto, '2026-11-02T09:30:00.000Z');
  assert.equal(filas.Dani, '2026-11-02T16:00:00.000Z');
  assert.equal(filas.Fer, undefined);
});

await prueba('quien lo marcaron a mano como enviado (sin liga) sale «enviado» con la fecha de la marca', async () => {
  const eliFila = (await ver('LIGADA-CON-NDA')).rows.find((r: any) => r.participantName === 'Eli');
  assert.equal(eliFila.ndaEstado, 'enviado');
  assert.equal(eliFila.ndaFecha, '2026-10-01T15:00:00.000Z');
});

await prueba('si la vista interna oculta «NDA», la externa no trae la columna ni los estados', async () => {
  const v = await ver('LIGADA-SIN-NDA');
  assert.ok(!v.visibleColumns.includes('nda'));
  assert.ok(v.rows.every((r: any) => r.ndaEstado === undefined && r.ndaFecha === undefined));
  assert.ok(!JSON.stringify(v).includes('ndaEstado'));
});

await prueba('una vista externa «sola» muestra el NDA solo si lo eligieron entre sus columnas', async () => {
  const con = await ver('SOLA-CON-NDA');
  assert.deepEqual(con.visibleColumns, ['participantName', 'status', 'nda']);
  assert.equal(estadosPorNombre(con).Ana, 'firmado');
  const sin = await ver('SOLA-SIN-NDA');
  assert.ok(!sin.visibleColumns.includes('nda'));
  assert.ok(sin.rows.every((r: any) => r.ndaEstado === undefined));
});

await prueba('solo sale el estado y su fecha: nada de la liga, el correo del envío, la IP, el dispositivo, la firma ni el id del envío', async () => {
  for (const token of ['LIGADA-CON-NDA', 'SOLA-CON-NDA']) {
    const texto = JSON.stringify(await ver(token));
    for (const secreto of ['TOKEN-SECRETO', 'nda.ejemplo.test', '203.0.113.7', 'DISPOSITIVO-SECRETO', 'FIRMA-SECRETA', 'Nombre Secreto', 'Sesión secreta', 'equipo@ejemplo.test', ...envios]) {
      assert.ok(!texto.includes(secreto), `salió «${secreto}» en la vista ${token}`);
    }
  }
  const permitidas = new Set(['id', 'participantName', 'email', 'phone', 'idNumber', 'status', 'dynamicValues', 'groupId', 'ndaEstado', 'ndaFecha']);
  for (const r of (await ver('LIGADA-CON-NDA')).rows) for (const k of Object.keys(r)) assert.ok(permitidas.has(k), `campo inesperado en la fila: ${k}`);
});

await prueba('mirar la vista no cambia nada del NDA (es de solo lectura: no marca «abrió» ni toca los envíos)', async () => {
  const antes = await instantanea();
  await ver('LIGADA-CON-NDA');
  await ver('SOLA-CON-NDA');
  assert.equal(await instantanea(), antes);
});

await prueba('una liga desactivada o que no existe sigue sin mostrar nada', async () => {
  await pg.query(`update shared_views set active = false where token = 'SOLA-SIN-NDA'`);
  assert.equal((await ver('SOLA-SIN-NDA')).found, false);
  assert.equal((await ver('NO-EXISTE')).found, false);
});

await prueba('si las tablas del NDA todavía no existen, la vista sigue funcionando (solo con lo marcado a mano)', async () => {
  await pg.exec(`drop table if exists nda_eventos cascade; drop table if exists nda_envios cascade;`);
  const v = await ver('LIGADA-CON-NDA');
  assert.equal(v.found, true);
  assert.deepEqual(estadosPorNombre(v), { Ana: null, Beto: null, Carla: null, Dani: null, Eli: 'enviado', Fer: null });
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
