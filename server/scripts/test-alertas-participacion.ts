// Pruebas de las alertas de elegibilidad del tablero de reclutamiento (getBoardDuplicateBadges): dos motivos por separado — ya participó con el mismo cliente y participó en los
// últimos 6 meses (con cualquier cliente) — para que el tablero pinte un ícono por motivo, y que las señales de siempre (`signals`, `primaryBadge`, `hasHighRisk`) no cambien.
// Contra una base en memoria (PGlite) con el esquema real; todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-alertas-participacion.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

process.env.STRICT_OUTPUT = 'true';

const badges = (await import('../../src/api/getBoardDuplicateBadges')).default;
const { getGlobalIdentityData } = await import('../../src/lib/globalIdentityCache');

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).stack : (e as Error).message.split('\n')[0]}`);
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
const ctx = { user: { id: 'u-prueba', email: 'prueba@ejemplo.test', role: 'Líder' } } as any;
const id = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params as any)).rows[0].id;

// Proyectos: el actual (Cliente Alfa, empezó el 20 de octubre de 2026, así que «6 meses antes» es el 20 de abril) y otros del mismo cliente y de otro, viejos y recientes.
const proyecto = (codigo: string, cliente: string, inicio: string) => pg.query(`insert into projects (project_code, client, start_date) values ($1, $2, $3)`, [codigo, cliente, inicio]);
await proyecto('ALF-ACTUAL', 'Cliente Alfa', '2026-10-20');
await proyecto('ALF-ENE', 'Cliente Alfa', '2026-01-15');      // mismo cliente, hace más de 6 meses
await proyecto('ALF-AGO', 'Cliente Alfa', '2026-08-10');      // mismo cliente, hace menos de 6 meses
await proyecto('ALF-VIEJO', 'Cliente Alfa', '2025-03-01');    // mismo cliente, hace más de un año
await proyecto('BET-SEP', 'Cliente Beta', '2026-09-01');      // otro cliente, hace menos de 6 meses
await proyecto('BET-VIEJO', 'Cliente Beta', '2025-02-01');    // otro cliente, hace más de un año
await proyecto('ALF-FUTURO', 'Cliente Alfa', '2026-12-01');   // empieza después del actual: no cuenta

let k = 0;
const personas: Record<string, { email: string; telefono: string; nombre: string }> = {};
const persona = (clave: string, nombre: string) => { k++; personas[clave] = { email: `${clave}@ejemplo.test`, telefono: `55000000${String(k).padStart(2, '0')}`, nombre }; };
for (const [c, nom] of [['p1', 'Persona Uno'], ['p2', 'Persona Dos'], ['p3', 'Persona Tres'], ['p4', 'Persona Cuatro'], ['p5', 'Persona Cinco'], ['p6', 'Persona Seis'], ['p7', 'Persona Siete'], ['p8', 'Persona Ocho']]) persona(c, nom);

const fila = (clave: string, proyectoCodigo: string, estatus: string, grupo: string | null = null) =>
  id(`insert into recruitment_rows (project_code, board_name, participant_name, email, phone, status, "group") values ($1, 'Tablero', $2, $3, $4, $5, $6) returning id`,
    [proyectoCodigo, personas[clave].nombre, personas[clave].email, personas[clave].telefono, estatus, grupo]);

// p1: mismo cliente hace más de 6 meses Y otro cliente hace menos de 6 meses → los dos motivos, de proyectos distintos.
await fila('p1', 'ALF-ENE', 'Asistió');
await fila('p1', 'BET-SEP', 'Asistió');
// p2: solo otro cliente, hace menos de 6 meses.
await fila('p2', 'BET-SEP', 'Asistió');
// p3: solo mismo cliente, hace más de un año.
await fila('p3', 'ALF-VIEJO', 'Asistió');
// p4: solo otro cliente, hace más de un año → ningún motivo (sale el reloj gris de «otros formularios», no esta alerta).
await fila('p4', 'BET-VIEJO', 'Asistió');
// p5: mismo cliente hace menos de 6 meses → cuenta como mismo cliente y también como reciente.
await fila('p5', 'ALF-AGO', 'Asistió');
// p6: solo registrado en un proyecto reciente (no participó) → ningún motivo.
await fila('p6', 'BET-SEP', 'Pendiente');
// p7: en un proyecto reciente pero con un estatus que no cuenta como participación (No show en grupo) → ningún motivo.
await fila('p7', 'BET-SEP', 'No show', 'Grupo 1');
// p8: participó en un proyecto del mismo cliente que empieza DESPUÉS del actual → no cuenta.
await fila('p8', 'ALF-FUTURO', 'Asistió');
// Y todas están ahora en el tablero del proyecto actual.
const enTablero: Record<string, string> = {};
for (const c of Object.keys(personas)) enTablero[c] = await fila(c, 'ALF-ACTUAL', 'Pendiente');
// p9: persona sin historia.
persona('p9', 'Persona Nueve');
enTablero.p9 = await fila('p9', 'ALF-ACTUAL', 'Pendiente');

await getGlobalIdentityData({ fresco: true });
const r = (await badges.run({ projectCode: 'ALF-ACTUAL', boardName: 'Tablero' }, ctx)) as any;
const de = (c: string) => r.badges[enTablero[c]];

await prueba('quien participó con el mismo cliente hace más de 6 meses y con otro cliente hace menos de 6 meses sale con los dos motivos', () => {
  assert.equal(de('p1').participatedSameClient, true);
  assert.equal(de('p1').participatedLast6Months, true);
  assert.equal(de('p1').hasHighRisk, true);
});
await prueba('quien solo participó con otro cliente hace menos de 6 meses sale solo con «últimos 6 meses»', () => {
  assert.equal(de('p2').participatedSameClient, false);
  assert.equal(de('p2').participatedLast6Months, true);
  assert.equal(de('p2').primaryBadge, 'recent');
});
await prueba('quien solo participó con el mismo cliente hace más de un año sale solo con «mismo cliente»', () => {
  assert.equal(de('p3').participatedSameClient, true);
  assert.equal(de('p3').participatedLast6Months, false);
  assert.equal(de('p3').primaryBadge, 'same_client');
});
await prueba('quien participó con el mismo cliente hace menos de 6 meses cuenta en los dos motivos (aunque la señal de siempre solo diga «mismo cliente»)', () => {
  assert.equal(de('p5').participatedSameClient, true);
  assert.equal(de('p5').participatedLast6Months, true);
  assert.deepEqual(de('p5').signals, ['same_client'], 'las señales de siempre no cambian');
  assert.equal(de('p5').primaryBadge, 'same_client');
});
await prueba('sin alerta: participó con otro cliente hace más de un año, solo estuvo registrado, no cuenta como participación, el proyecto empieza después, o no tiene historia', () => {
  for (const c of ['p4', 'p6', 'p7', 'p8', 'p9']) {
    assert.equal(de(c).participatedSameClient, false, `${c}: mismo cliente`);
    assert.equal(de(c).participatedLast6Months, false, `${c}: últimos 6 meses`);
    assert.equal(de(c).hasHighRisk, false, `${c}: alerta`);
  }
  assert.equal(de('p4').primaryBadge, 'old');
  assert.equal(de('p6').primaryBadge, 'registered_only');
  assert.equal(de('p9').primaryBadge, null);
});
await prueba('toda persona con alerta tiene al menos uno de los dos motivos, y viceversa (la alerta de siempre y los íconos nunca se contradicen)', () => {
  for (const c of Object.keys(enTablero)) {
    const b = de(c);
    assert.equal(b.hasHighRisk, b.participatedSameClient || b.participatedLast6Months, c);
  }
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
