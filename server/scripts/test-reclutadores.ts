// Pruebas de la estadística por reclutador: cómo se juntan las formas de escribir un nombre (src/lib/indicadores/reclutadores.ts), cómo se cuentan las
// respuestas nuevas y repetidas sobre casos inventados donde se conoce cada número (src/serverUtils/indicadores/reclutadores.ts), cómo se lee el
// nombre de cada fila, y los endpoints de punta a punta contra una base en memoria (PGlite) con el esquema real: acceso solo para Sergio, juntar
// nombres, y qué pasa si todavía no existen las tablas. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-reclutadores.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { buildIdentityClusters, type IdentityRow } from '../../src/lib/duplicateIdentity';
import {
  conteoCero, esSinNombre, normalizarNombre, podrianSerLaMisma, reclutadorParecido, repartir, resumenDe, sugerirGrupos,
  type Asignacion, type Conteo, type DatosReclutadores, type Periodo,
} from '../../src/lib/indicadores/reclutadores';
import { calcularReclutadores, leerNombresReclutador } from '../../src/serverUtils/indicadores/reclutadores';
import { SQL_TABLAS_RECLUTADORES } from '../../src/serverUtils/indicadores/reclutadoresAlmacen';

process.env.STRICT_OUTPUT = 'true';

const getReclutadoresEstadistica = (await import('../../src/api/getReclutadoresEstadistica')).default;
const calcularReclutadoresEstadistica = (await import('../../src/api/calcularReclutadoresEstadistica')).default;
const saveReclutadorAsignacion = (await import('../../src/api/saveReclutadorAsignacion')).default;
const saveReclutador = (await import('../../src/api/saveReclutador')).default;
const deleteReclutador = (await import('../../src/api/deleteReclutador')).default;

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
const falla = async (fn: () => Promise<unknown>, texto: RegExp) => {
  let error: unknown;
  try { await fn(); } catch (e) { error = e; }
  assert.ok(error, 'debía fallar');
  assert.match((error as Error).message, texto);
  return error as Error & { code?: string };
};

// ── nombres ──────────────────────────────────────────────────────────────────
await prueba('normalizarNombre: junta mayúsculas, acentos, signos y espacios', () => {
  assert.equal(normalizarNombre('  Ana   GÓMEZ. '), 'ana gomez');
  assert.equal(normalizarNombre('Peña-Nieto'), 'pena nieto');
  assert.equal(normalizarNombre('MATEO (LM)'), 'mateo lm');
  assert.equal(normalizarNombre(''), '');
});
await prueba('esSinNombre: vacío, una letra, «nadie», «no sé» o un canal no son un reclutador', () => {
  for (const k of ['', 'x', 'nadie', 'no se', 'ninguno', 'instagram', 'por mi cuenta']) assert.equal(esSinNombre(k), true, k);
  for (const k of ['ana', 'mateo medina', 'xavier']) assert.equal(esSinNombre(k), false, k);
});

// ── a quién se parece cada forma ─────────────────────────────────────────────
await prueba('podrianSerLaMisma: junta lo que se parece y no junta lo que no', () => {
  assert.ok(podrianSerLaMisma('mate', 'mateo medina'));
  assert.ok(podrianSerLaMisma('matio', 'mateo'));
  assert.ok(podrianSerLaMisma('ale ramos', 'alejandra ramos'));
  assert.ok(podrianSerLaMisma('j salgado', 'julia salgado'), 'una inicial vale con el mismo apellido');
  assert.ok(podrianSerLaMisma('marcel soto', 'margel soto'));
  assert.ok(podrianSerLaMisma('osbaldo', 'osvaldo'));
  assert.ok(podrianSerLaMisma('laro prieto', 'lalo prieto'), 'una letra de diferencia en un nombre corto vale si el apellido es idéntico');
  assert.ok(podrianSerLaMisma('lili vega', 'lily vega'));
  assert.ok(!podrianSerLaMisma('mate', 'lalo'), 'dos nombres cortos sin apellido no se juntan por una letra');
  assert.ok(!podrianSerLaMisma('adriana rojas', 'mariana leal soto'), 'adriana y mariana son otras personas');
  assert.ok(!podrianSerLaMisma('mateo medina', 'mateo merino'), 'dos apellidos que difieren en dos letras no se juntan solos');
  assert.ok(!podrianSerLaMisma('j', 'julia'), 'una inicial sola no basta');
  assert.ok(!podrianSerLaMisma('lalo prieto', 'lucia prieto'));
  assert.ok(!podrianSerLaMisma('ramiro g', 'ramiro r'));
});

const forma = (clave: string, n: number) => ({ clave, n });
await prueba('sugerirGrupos: junta las variantes bajo la forma más usada, marca ambiguas las que caben en dos grupos y deja sueltas las que no caben', () => {
  const grupos = sugerirGrupos([
    forma('mateo medina', 12758), forma('mateo merino', 285), forma('mateo', 278), forma('mate', 40), forma('matio', 12),
    forma('lalo prieto', 12413), forma('lalo', 253), forma('lalo prieto reclutador', 192), forma('laro prieto', 55),
    forma('ramiro g', 468), forma('ramiro', 450), forma('ramiro r', 329),
    forma('jsalgado', 871), forma('julia salgado', 845), forma('j salgado', 266), forma('mariana leal soto', 9),
  ]);
  const de = (ancla: string) => grupos.find((g) => g.ancla === ancla)!;
  assert.deepEqual(grupos.map((g) => g.ancla).sort(), ['jsalgado', 'julia salgado', 'lalo prieto', 'mateo medina', 'mateo merino', 'ramiro g', 'ramiro r']);
  const totales = grupos.map((g) => g.total);
  assert.deepEqual([...totales].sort((a, b) => b - a), totales, 'ordenados de más a menos respuestas');
  assert.deepEqual(de('lalo prieto').miembros.map((m) => m.clave).sort(), ['lalo', 'lalo prieto', 'lalo prieto reclutador', 'laro prieto']);
  assert.equal(de('lalo prieto').miembros.some((m) => m.ambiguo), false, '«lalo» solo cabe con ella');
  assert.deepEqual(de('julia salgado').miembros.map((m) => m.clave).sort(), ['j salgado', 'julia salgado']);
  assert.deepEqual(de('jsalgado').miembros.map((m) => m.clave), ['jsalgado'], 'sin letras en común no se junta solo');
  // Con dos «mateo» («medina» y «merino»), «mateo» a secas, «mate» y «matio» no se sabe de cuál son.
  const mateo = de('mateo medina');
  for (const k of ['mateo', 'mate', 'matio']) assert.equal(mateo.miembros.find((m) => m.clave === k)?.ambiguo, true, k);
  assert.equal(de('ramiro g').miembros.find((m) => m.clave === 'ramiro')?.ambiguo, true);
  assert.equal(grupos.some((g) => g.miembros.some((m) => m.clave === 'mariana leal soto')), false, 'la suelta queda fuera');
  assert.equal(de('mateo medina').total, 12758 + 278 + 40 + 12);
});
await prueba('sugerirGrupos: una forma con pocas respuestas no da nombre a un grupo nuevo, solo se suma a uno', () => {
  const grupos = sugerirGrupos([forma('ana lopez', 100), forma('ana', 3), forma('zoe', 9)]);
  assert.deepEqual(grupos.map((g) => g.ancla), ['ana lopez']);
  assert.deepEqual(grupos[0].miembros.map((m) => m.clave).sort(), ['ana', 'ana lopez']);
});
await prueba('reclutadorParecido: sugiere un reclutador solo si hay uno que encaje, no si hay dos', () => {
  const rec = [{ id: 'r1', claves: ['mateo medina'] }, { id: 'r2', claves: ['lalo prieto'] }];
  assert.equal(reclutadorParecido('mate', rec), 'r1');
  assert.equal(reclutadorParecido('lorena', rec), null);
  assert.equal(reclutadorParecido('mate', [...rec, { id: 'r3', claves: ['mateo merino'] }]), null);
});

// ── sumar por reclutador ─────────────────────────────────────────────────────
const c = (...v: number[]): Conteo => [v[0], v[1], v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0, v[6] ?? 0];
const periodos = (todo: Conteo): Record<Periodo, Conteo> => ({ '12m': [...todo] as Conteo, '6m': conteoCero(), anio: [...todo] as Conteo, todo });
const datosA: DatosReclutadores = {
  version: 1, hoy: '2026-10-20', sinFecha: 0, contactosCompartidos: 0,
  sinNombre: periodos(c(4, 3, 1)),
  escrituras: [
    { clave: 'ana', nombre: 'Ana', formas: [['Ana', 10]], c: periodos(c(10, 6, 2, 1, 1, 0, 0)) },
    { clave: 'anita', nombre: 'Anita', formas: [['Anita', 4]], c: periodos(c(4, 1, 3, 0, 0, 0, 0)) },
    { clave: 'beto', nombre: 'Beto', formas: [['Beto', 5]], c: periodos(c(6, 2, 0, 0, 0, 3, 1)) },
    { clave: 'contacto', nombre: 'Contacto', formas: [['Contacto', 3]], c: periodos(c(3, 3)) },
    { clave: 'zeta', nombre: 'Zeta', formas: [['Zeta', 2]], c: periodos(c(2, 2)) },
  ],
};
await prueba('resumenDe: los porcentajes salen de nuevas más repetidas; el contacto compartido queda fuera', () => {
  const r = resumenDe(c(6, 2, 0, 0, 0, 3, 1));
  assert.equal(r.total, 6);
  assert.equal(r.nuevas, 2);
  assert.equal(r.repetidas, 3);
  assert.deepEqual(r.repetidasPorTramo, [0, 0, 0, 3]);
  assert.equal(r.compartido, 1);
  assert.equal(r.clasificadas, 5);
  assert.equal(r.pctNuevas, 40);
  assert.equal(r.pctRepetidas, 60);
  assert.equal(resumenDe(conteoCero()).pctNuevas, null, 'sin respuestas no hay porcentaje');
});
await prueba('repartir: suma las formas de cada reclutador, aparta las ignoradas y deja ver lo que falta por asignar', () => {
  const asig = new Map<string, Asignacion>([
    ['ana', { reclutadorId: 'R1', ignorar: false }], ['anita', { reclutadorId: 'R1', ignorar: false }],
    ['beto', { reclutadorId: 'R2', ignorar: false }], ['contacto', { reclutadorId: null, ignorar: true }],
  ]);
  const r = repartir(datosA, 'todo', asig);
  assert.deepEqual(r.porReclutador.get('R1')!.conteo, c(14, 7, 5, 1, 1, 0, 0));
  assert.deepEqual(r.porReclutador.get('R1')!.claves.sort(), ['ana', 'anita']);
  assert.deepEqual(r.porReclutador.get('R2')!.conteo, c(6, 2, 0, 0, 0, 3, 1));
  assert.deepEqual(r.ignoradas.conteo, c(3, 3));
  assert.deepEqual(r.sinAsignar.claves, ['zeta']);
  assert.deepEqual(r.sinAsignar.conteo, c(2, 2));
  assert.deepEqual(r.sinNombre, c(4, 3, 1));
  const suma = (x: Conteo) => x[0];
  assert.equal([...r.porReclutador.values()].reduce((s, v) => s + suma(v.conteo), 0) + suma(r.ignoradas.conteo) + suma(r.sinAsignar.conteo), 10 + 4 + 6 + 3 + 2, 'no se pierde ninguna respuesta');
  assert.deepEqual(repartir(datosA, '6m', asig).porReclutador.get('R1')!.conteo, conteoCero(), 'cada periodo suma el suyo');
  const sinNada = repartir(datosA, 'todo', new Map());
  assert.equal(sinNada.porReclutador.size, 0);
  assert.equal(sinNada.sinAsignar.claves.length, 5);
});

// ── contar nuevas y repetidas ────────────────────────────────────────────────
// Proyectos (fecha de inicio) y «hoy»: los periodos se arman contra esta fecha.
const HOY = '2026-10-20';
const PROYECTOS: Record<string, string | undefined> = { P1: '2025-01-10', P2: '2025-06-10', P3: '2026-03-10', P4: '2026-09-10', P5: '2027-01-01', 'SIN-FECHA': undefined };
const projectMap = new Map(Object.entries(PROYECTOS).map(([k, v]) => [k, { client: 'Cliente Alfa', ...(v ? { startDate: v } : {}) }]));
let k = 0;
const persona = (letra: string) => { k++; return { email: `${letra}@ejemplo.test`, phone: `55000010${String(k).padStart(2, '0')}`, participantName: `Persona ${letra.toUpperCase()}` }; };
const filas: IdentityRow[] = [];
const nombres = new Map<string, string>();
const fila = (id: string, p: ReturnType<typeof persona>, proyecto: string, respuesta: string | null, nombre?: string, extra: Partial<IdentityRow> = {}) => {
  filas.push({ id, ...p, projectCode: proyecto, boardName: 'Tablero', sourceForm: respuesta ? `Filtro|${respuesta}` : undefined, ...extra });
  if (nombre !== undefined) nombres.set(id, nombre);
};
// A: tres respuestas en P1, P3 y P4 (la 2.ª la firmó «mateo»): nueva, repetida con 1 proyecto antes, repetida con 2.
const A = persona('a');
fila('a1', A, 'P1', 'r-a1', 'Mateo Medina'); fila('a2', A, 'P3', 'r-a2', 'mateo'); fila('a3', A, 'P4', 'r-a3', 'Mateo Medina');
// B: la MISMA respuesta copiada a dos tableros de dos proyectos: una sola respuesta, nueva; el nombre es el de la copia más antigua que lo trae.
const B = persona('b');
fila('b1', B, 'P3', 'r-b', 'Lalo'); fila('b2', B, 'P4', 'r-b');
// C: dos respuestas en el MISMO proyecto (P1) y una en P2: las dos primeras son nuevas (pasos del mismo reclutamiento), la tercera repetida con 1 proyecto antes.
const C = persona('c');
fila('c1', C, 'P1', 'r-c1', 'ANA Ríos'); fila('c2', C, 'P1', 'r-c2', 'Ana  Ríos'); fila('c3', C, 'P2', 'r-c3', 'ana rios.');
// D: un correo y teléfono compartidos (quien recluta en campo llena por el participante): 5 respuestas con 3 nombres distintos → contacto compartido.
const D = persona('d');
const nombresD = ['Uno Uno', 'Dos Dos', 'Tres Tres', 'Uno Uno', 'Dos Dos'];
['P1', 'P2', 'P3', 'P4', 'P1'].forEach((proyecto, i) => fila(`d${i + 1}`, { ...D, participantName: nombresD[i] }, proyecto, `r-d${i + 1}`, 'Rosa'));
// E: su proyecto no tiene fecha: no se puede ubicar. F: su proyecto empieza después de hoy: no cuenta todavía.
fila('e1', persona('e'), 'SIN-FECHA', 'r-e', 'Rosa');
fila('f1', persona('f'), 'P5', 'r-f', 'Rosa');
// G: escribió «Nadie». H: no escribió nada (no hay nombre para su fila).
fila('g1', persona('g'), 'P4', 'r-g', 'Nadie');
fila('h1', persona('h'), 'P4', 'r-h');
// I: una fila capturada a mano (sin id de respuesta) en P2, con nombre.
fila('i1', persona('i'), 'P2', null, 'Rosa Quiroz');

const globalClusters = buildIdentityClusters(filas, { mode: 'strict' });
const rowToGlobalCluster = new Map<string, string>();
for (const [cid, cl] of globalClusters) for (const id of cl.rowIds) rowToGlobalCluster.set(id, cid);
const datosId = { activeRows: filas, projectMap, globalClusters, rowToGlobalCluster };
const calculo = calcularReclutadores(datosId, nombres, HOY);
const esc = (clave: string) => calculo.escrituras.find((e) => e.clave === clave)!;

await prueba('contar: la primera respuesta es nueva y las siguientes repetidas, con cuántos proyectos anteriores ya tenía', () => {
  assert.deepEqual(esc('mateo medina').c.todo, c(2, 1, 0, 1, 0, 0, 0), 'a1 nueva, a3 repetida con 2 proyectos antes');
  assert.deepEqual(esc('mateo').c.todo, c(1, 0, 1, 0, 0, 0, 0), 'a2 repetida con 1 proyecto antes');
});
await prueba('contar: la misma respuesta copiada a dos proyectos cuenta una vez, con el nombre de la copia más antigua', () => {
  assert.deepEqual(esc('lalo').c.todo, c(1, 1, 0, 0, 0, 0, 0));
  assert.equal(calculo.escrituras.some((e) => e.clave === ''), false);
});
await prueba('contar: las respuestas del mismo proyecto que la primera son nuevas; solo un proyecto anterior distinto vuelve repetida', () => {
  assert.deepEqual(esc('ana rios').c.todo, c(3, 2, 1, 0, 0, 0, 0));
  assert.deepEqual(esc('ana rios').formas.map(([f, cuantas]) => cuantas), [1, 1, 1], 'tres formas de escribirlo, una vez cada una');
  assert.equal(esc('ana rios').formas.length, 3);
});
await prueba('contar: un correo y teléfono compartidos no se cuentan como nuevos ni repetidos, y quedan en su propia columna', () => {
  assert.deepEqual(esc('rosa').c.todo, c(5, 0, 0, 0, 0, 0, 5));
  assert.equal(calculo.contactosCompartidos, 1);
});
await prueba('contar: sin fecha de proyecto se anota aparte, y un proyecto que aún no empieza no cuenta', () => {
  assert.equal(calculo.sinFecha, 1);
  const total = calculo.escrituras.reduce((s, e) => s + e.c.todo[0], 0) + calculo.sinNombre.todo[0];
  assert.equal(total, 3 + 1 + 3 + 5 + 2 + 1, 'A 3, B 1, C 3, D 5, G y H 2, I 1: E y F no cuentan');
});
await prueba('contar: «Nadie» y la fila sin nombre van a «sin nombre»', () => {
  assert.deepEqual(calculo.sinNombre.todo, c(2, 2));
  assert.equal(calculo.escrituras.some((e) => e.clave === 'nadie'), false);
});
await prueba('contar: una fila capturada a mano (sin id de respuesta) es una respuesta aparte', () => {
  assert.deepEqual(esc('rosa quiroz').c.todo, c(1, 1));
});
await prueba('contar: los periodos suman solo lo que cae en ellos (12 meses, 6 meses, este año)', () => {
  const m = esc('mateo medina'), solo = esc('mateo'), ana = esc('ana rios'), lalo = esc('lalo');
  assert.deepEqual(m.c['12m'], c(1, 0, 0, 1, 0, 0, 0), 'solo a3 (sep 2026): a1 es de enero de 2025');
  assert.deepEqual(m.c['6m'], c(1, 0, 0, 1, 0, 0, 0));
  assert.deepEqual(m.c.anio, c(1, 0, 0, 1, 0, 0, 0));
  assert.deepEqual(solo.c['12m'], c(1, 0, 1, 0, 0, 0, 0));
  assert.deepEqual(solo.c['6m'], conteoCero(), 'marzo de 2026 queda fuera de los últimos 6 meses (desde el 20 de abril)');
  assert.deepEqual(solo.c.anio, c(1, 0, 1, 0, 0, 0, 0));
  assert.deepEqual(ana.c['12m'], conteoCero(), 'todas sus respuestas son anteriores a octubre de 2025');
  assert.deepEqual(lalo.c['6m'], conteoCero());
  assert.deepEqual(lalo.c.anio, c(1, 1, 0, 0, 0, 0, 0));
});
await prueba('contar: en cada forma y periodo el total es la suma de sus partes', () => {
  for (const e of calculo.escrituras) for (const p of ['12m', '6m', 'anio', 'todo'] as Periodo[]) assert.equal(e.c[p][0], e.c[p].slice(1).reduce((s, v) => s + v, 0), `${e.clave} ${p}`);
  for (const p of ['12m', '6m', 'anio', 'todo'] as Periodo[]) assert.equal(calculo.sinNombre[p][0], calculo.sinNombre[p].slice(1).reduce((s, v) => s + v, 0), `sin nombre ${p}`);
});
await prueba('contar: ordena de más a menos respuestas y guarda la forma más común tal como la escribieron', () => {
  const totales = calculo.escrituras.map((e) => e.c.todo[0]);
  assert.deepEqual([...totales].sort((a, b) => b - a), totales);
  assert.equal(esc('mateo medina').nombre, 'Mateo Medina');
});
await prueba('contar: sin filas no hay nada que contar', () => {
  const vacio = calcularReclutadores({ activeRows: [], projectMap, globalClusters: new Map() }, new Map(), HOY);
  assert.deepEqual(vacio.escrituras, []);
  assert.deepEqual(vacio.sinNombre.todo, conteoCero());
});

// ── contra una base en memoria con el esquema real ───────────────────────────
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
const id = async (sql: string, params: unknown[] = []) => (await pg.query<{ id: string }>(sql, params as any)).rows[0].id;

const tablero = (nombre: string, borrado = false) =>
  id(`insert into boards (board_name, project_code, board_type, deleted_at) values ($1, 'P1', 'recruitment', $2) returning id::text as id`, [nombre, borrado ? new Date().toISOString() : null]);
const columna = (tableroId: string, nombre: string, borrada = false) =>
  id(`insert into board_columns (column_name, board_id, column_type, deleted_at) values ($1, $2, 'Texto', $3) returning id::text as id`, [nombre, tableroId, borrada ? new Date().toISOString() : null]);
const filaDb = (tableroId: string, celdas: string | null, borrada = false) =>
  id(`insert into recruitment_rows (board_id, project_code, board_name, participant_name, cell_data, deleted_at) values ($1, 'P1', 'Tablero', 'Persona X', $2, $3) returning id::text as id`, [tableroId, celdas, borrada ? new Date().toISOString() : null]);
const texto = (col: string, t: string) => JSON.stringify({ [col]: { textValue: t } });

await prueba('leerNombresReclutador: lee la columna NR, Reclutador, Nombre Reclutador o «Quién lo invitó» de cada fila viva, y nada más', async () => {
  const b1 = await tablero('B1'); const c1 = await columna(b1, 'NR'); const otra = await columna(b1, 'Edad');
  const f1 = await filaDb(b1, texto(c1, 'Ana'));
  const f2 = await filaDb(b1, texto(c1, '   '));
  const f3 = await filaDb(b1, texto(c1, 'Borrada'), true);
  const f4 = await filaDb(b1, null);
  const f5 = await filaDb(b1, texto(otra, 'No es el reclutador'));
  const b2 = await tablero('B2'); const c2 = await columna(b2, 'Reclutador'); const c3 = await columna(b2, 'Nombre Reclutador');
  const f6 = await filaDb(b2, texto(c3, 'Beto'));
  const f7 = await filaDb(b2, JSON.stringify({ [c2]: { textValue: 'Carla' }, [c3]: { textValue: 'Carla' } }));
  const b3 = await tablero('B3'); const c4 = await columna(b3, 'Quién lo invitó');
  const f8 = await filaDb(b3, texto(c4, 'Dani'));
  const b4 = await tablero('B4', true); const c5 = await columna(b4, 'NR');
  const f9 = await filaDb(b4, texto(c5, 'Tablero borrado'));
  const b5 = await tablero('B5'); const c6 = await columna(b5, 'nr');
  const f10 = await filaDb(b5, texto(c6, 'Luis'));
  const f11 = await filaDb(b5, 'esto no es json');
  const b6 = await tablero('B6'); await columna(b6, 'NR - comentarios'); await columna(b6, 'NR', true);
  const f12 = await filaDb(b6, texto('cualquiera', 'Sin columna del reclutador'));
  const avances: number[] = [];
  const nombres = await leerNombresReclutador({ query: q }, { alAvanzar: (hechos, total) => { avances.push(hechos); assert.equal(total, 4); } });
  assert.equal(nombres.get(f1), 'Ana');
  assert.equal(nombres.get(f6), 'Beto');
  assert.equal(nombres.get(f7), 'Carla');
  assert.equal(nombres.get(f8), 'Dani');
  assert.equal(nombres.get(f10), 'Luis', 'el JSON malo de otra fila no se lleva a las demás');
  for (const f of [f2, f3, f4, f5, f9, f11, f12]) assert.equal(nombres.has(f), false, f);
  assert.equal(nombres.size, 5);
  assert.deepEqual(avances.sort((a, b) => a - b), [1, 2, 3, 4], 'avisa tablero por tablero (B1, B2, B3 y B5: el B4 está borrado y el B6 no trae la columna)');
});

const SERGIO = { user: { id: 'u-sergio', email: 'sergio@sapience.com.mx', role: 'Owner' } } as any;
const OTRA = { user: { id: 'u-otra', email: 'otra@ejemplo.test', role: 'Líder' } } as any;

await prueba('acceso: solo Sergio puede ver, calcular y juntar nombres', async () => {
  const nuevo = { asignaciones: [{ claves: ['ana'], destino: { tipo: 'nuevo', nombre: 'Ana' } }] };
  await falla(() => getReclutadoresEstadistica.run({}, OTRA) as Promise<unknown>, /no están habilitados/);
  await falla(() => calcularReclutadoresEstadistica.run({}, OTRA) as Promise<unknown>, /no están habilitados/);
  await falla(() => saveReclutadorAsignacion.run(nuevo, OTRA) as Promise<unknown>, /no están habilitados/);
  await falla(() => saveReclutador.run({ id: '00000000-0000-4000-8000-000000000000', nombre: 'X' }, OTRA) as Promise<unknown>, /no están habilitados/);
  await falla(() => deleteReclutador.run({ id: '00000000-0000-4000-8000-000000000000' }, OTRA) as Promise<unknown>, /no están habilitados/);
});

await prueba('sin las tablas: la pantalla abre vacía y avisa, y juntar o calcular explican qué falta', async () => {
  const r = (await getReclutadoresEstadistica.run({}, SERGIO)) as any;
  assert.deepEqual(r, { reclutadores: [], alias: [], sinTablas: true });
  const nuevo = { asignaciones: [{ claves: ['ana'], destino: { tipo: 'nuevo', nombre: 'Ana' } }] };
  await falla(() => saveReclutadorAsignacion.run(nuevo, SERGIO) as Promise<unknown>, /Faltan tablas en la base de datos/);
  await falla(() => calcularReclutadoresEstadistica.run({}, SERGIO) as Promise<unknown>, /Faltan tablas en la base de datos/);
});

// Con las tablas: el cálculo guardado vive en indicadores_calculos (la crea add-indicadores-tables.ts) y los reclutadores en las dos tablas nuevas.
await pg.exec(`create table if not exists indicadores_calculos (area text primary key, calculado_en timestamptz not null default now(), calculado_por text, datos jsonb not null);`);
await pg.exec(SQL_TABLAS_RECLUTADORES);
await pg.exec(SQL_TABLAS_RECLUTADORES); // idempotente

const estado = async () => (await getReclutadoresEstadistica.run({}, SERGIO)) as any;
const asignar = async (asignaciones: unknown[]) => (await saveReclutadorAsignacion.run({ asignaciones }, SERGIO)) as any;

await prueba('juntar: un reclutador nuevo recibe varias formas del nombre, y repetir el nombre (aunque cambien mayúsculas y espacios) usa el mismo', async () => {
  const r1 = await asignar([{ claves: ['mateo medina', 'mateo', 'mate'], destino: { tipo: 'nuevo', nombre: '  Mateo   Medina ' } }]);
  assert.equal(r1.reclutadores.length, 1);
  assert.equal(r1.reclutadores[0].nombre, 'Mateo Medina');
  assert.deepEqual(r1.cambios.map((a: any) => a.clave).sort(), ['mate', 'mateo', 'mateo medina']);
  const idMateo = r1.reclutadores[0].id;
  const r2 = await asignar([{ claves: ['matio'], destino: { tipo: 'nuevo', nombre: 'MATEO MEDINA' } }]);
  assert.equal(r2.reclutadores.length, 1, 'no se crea otro');
  assert.equal(r2.cambios[0].reclutadorId, idMateo);
  const s = await estado();
  assert.equal(s.sinTablas, false);
  assert.equal(s.alias.filter((a: any) => a.reclutadorId === idMateo).length, 4);
});
await prueba('juntar: a un reclutador que ya existe, «no es reclutador», y volver a dejar sin asignar', async () => {
  const idMateo = (await estado()).reclutadores[0].id;
  await asignar([{ claves: ['mateo lm'], destino: { tipo: 'reclutador', id: idMateo } }, { claves: ['contacto externo'], destino: { tipo: 'ignorar' } }]);
  let s = await estado();
  const por = (clave: string) => s.alias.find((a: any) => a.clave === clave);
  assert.equal(por('mateo lm').reclutadorId, idMateo);
  assert.deepEqual([por('contacto externo').reclutadorId, por('contacto externo').ignorar], [null, true]);
  await asignar([{ claves: ['mateo lm', 'contacto externo'], destino: { tipo: 'quitar' } }]);
  s = await estado();
  assert.equal(por('mateo lm'), undefined);
  assert.equal(por('contacto externo'), undefined);
  await falla(() => saveReclutadorAsignacion.run({ asignaciones: [{ claves: ['x'], destino: { tipo: 'reclutador', id: '00000000-0000-4000-8000-000000000000' } }] }, SERGIO) as Promise<unknown>, /ya no existe/);
  await falla(() => saveReclutadorAsignacion.run({ asignaciones: [{ claves: ['x'], destino: { tipo: 'nuevo', nombre: '   ' } }] }, SERGIO) as Promise<unknown>, /Escribe el nombre/);
  await falla(() => saveReclutadorAsignacion.run({ asignaciones: [{ claves: ['x'], destino: { tipo: 'nuevo', nombre: 'a'.repeat(61) } }] }, SERGIO) as Promise<unknown>, /no puede pasar de 60/);
});
await prueba('juntar: pasar una forma a otro reclutador la mueve, no la repite', async () => {
  const r = await asignar([{ claves: ['lalo prieto', 'lalo'], destino: { tipo: 'nuevo', nombre: 'Lalo Prieto' } }]);
  const idLalo = r.reclutadores.find((x: any) => x.nombre === 'Lalo Prieto').id;
  const idMateo = r.reclutadores.find((x: any) => x.nombre === 'Mateo Medina').id;
  await asignar([{ claves: ['mate'], destino: { tipo: 'reclutador', id: idLalo } }]);
  const s = await estado();
  assert.equal(s.alias.filter((a: any) => a.clave === 'mate').length, 1);
  assert.equal(s.alias.find((a: any) => a.clave === 'mate').reclutadorId, idLalo);
  await asignar([{ claves: ['mate'], destino: { tipo: 'reclutador', id: idMateo } }]);
});
await prueba('renombrar: no admite el nombre de otro reclutador (sin importar mayúsculas) y sí uno libre', async () => {
  const s = await estado();
  const idLalo = s.reclutadores.find((x: any) => x.nombre === 'Lalo Prieto').id;
  const err = await falla(() => saveReclutador.run({ id: idLalo, nombre: 'mateo medina' }, SERGIO) as Promise<unknown>, /Ya hay un reclutador llamado/);
  assert.equal(err.code, 'CONFLICT');
  const ok = (await saveReclutador.run({ id: idLalo, nombre: ' Luisa Prieto Rivas ' }, SERGIO)) as any;
  assert.equal(ok.reclutador.nombre, 'Luisa Prieto Rivas');
  await falla(() => saveReclutador.run({ id: '00000000-0000-4000-8000-000000000000', nombre: 'Nadie' }, SERGIO) as Promise<unknown>, /ya no existe/);
});
await prueba('borrar: sus formas de escribir el nombre quedan sin asignar y las de los demás siguen', async () => {
  const s = await estado();
  const idLalo = s.reclutadores.find((x: any) => x.nombre === 'Luisa Prieto Rivas').id;
  const claves = ((await deleteReclutador.run({ id: idLalo }, SERGIO)) as any).claves;
  assert.deepEqual(claves.sort(), ['lalo', 'lalo prieto']);
  const despues = await estado();
  assert.equal(despues.reclutadores.some((x: any) => x.id === idLalo), false);
  assert.equal(despues.alias.some((a: any) => claves.includes(a.clave)), false);
  assert.ok(despues.alias.some((a: any) => a.clave === 'mateo medina'), 'las de Mateo siguen');
  await falla(() => deleteReclutador.run({ id: idLalo }, SERGIO) as Promise<unknown>, /ya no existe/);
});

await prueba('calcular de punta a punta: lee el nombre de las filas, cuenta, guarda y avisa el avance; la pantalla lo recibe junto con los reclutadores', async () => {
  await pg.exec(`insert into projects (project_code, client, start_date) values ('Q1', 'Cliente Alfa', '2025-02-01'), ('Q2', 'Cliente Alfa', '2025-08-01')`);
  const tb = await tablero('Tablero de prueba'); const col = await columna(tb, 'NR');
  const insertar = (proyecto: string, nombre: string, correo: string, tel: string, respuesta: string, nr: string) =>
    pg.query(
      `insert into recruitment_rows (board_id, project_code, board_name, participant_name, email, phone, source_form, cell_data) values ($1, $2, 'Tablero de prueba', $3, $4, $5, $6, $7)`,
      [tb, proyecto, nombre, correo, tel, `Filtro|${respuesta}`, texto(col, nr)],
    );
  await insertar('Q1', 'Ana Prueba', 'ana@ejemplo.test', '5500002001', 'resp-1', 'Mateo');
  await insertar('Q2', 'Ana Prueba', 'ana@ejemplo.test', '5500002001', 'resp-2', 'mateo medina');
  await insertar('Q2', 'Beto Prueba', 'beto@ejemplo.test', '5500002002', 'resp-3', 'Lalo');
  const chunks: any[] = [];
  const r = (await calcularReclutadoresEstadistica.run({}, SERGIO, (ch) => chunks.push(ch))) as any;
  assert.ok(chunks.length >= 2, 'transmite el avance');
  assert.ok(chunks.some((ch) => /Leyendo/.test(ch.paso)) && chunks.some((ch) => /Contando/.test(ch.paso)));
  const e = (clave: string) => r.datos.escrituras.find((x: any) => x.clave === clave);
  assert.deepEqual(e('mateo').c.todo, [1, 1, 0, 0, 0, 0, 0], 'la primera respuesta de Ana: nueva');
  assert.deepEqual(e('mateo medina').c.todo, [1, 0, 1, 0, 0, 0, 0], 'la segunda: repetida con 1 proyecto antes');
  assert.deepEqual(e('lalo').c.todo, [1, 1, 0, 0, 0, 0, 0]);
  assert.ok(r.calculadoEn);
  assert.ok(r.reclutadores.some((x: any) => x.nombre === 'Mateo Medina'), 'trae los reclutadores ya juntados');
  assert.ok(r.alias.length > 0);
  const leido = await estado();
  assert.equal(leido.calculadoEn, r.calculadoEn);
  assert.deepEqual(leido.datos.escrituras.map((x: any) => x.clave), r.datos.escrituras.map((x: any) => x.clave));
});

await prueba('calcular dos veces a la vez: la segunda se cuelga de la primera', async () => {
  const [a, b] = (await Promise.all([calcularReclutadoresEstadistica.run({}, SERGIO), calcularReclutadoresEstadistica.run({}, SERGIO)])) as any[];
  assert.equal(a.calculadoEn, b.calculadoEn);
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
