// Pruebas del Excel de resultados de Swipe (src/lib/swipe/excelResultados.ts) y del endpoint que trae todos los votos de una sesión (getSwipeVotosSesion): el libro se arma con datos inventados, se escribe a un
// archivo de verdad con exceljs y se vuelve a leer para comprobar hojas, encabezados, números, formatos, hora de México, ligas y filtros; y el endpoint corre contra una base en memoria (PGlite) con las tablas de
// Swipe, junto con getSwipeResultadosSesion, para comprobar que lo que sale en «Resultados» es exactamente lo que calcula el servidor. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-swipe-excel.ts
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import getSwipeResultadosSesion from '../../src/api/getSwipeResultadosSesion';
import getSwipeVotosSesion from '../../src/api/getSwipeVotosSesion';
import { armarLibroSwipe, comoHoraDeMexico, nombreArchivoSwipe, type DatosExcelSwipe } from '../../src/lib/swipe/excelResultados';

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

/** Arma el libro, lo escribe como archivo de verdad y lo vuelve a leer: lo que se comprueba es lo que abriría Excel. */
async function ida(datos: DatosExcelSwipe) {
  const wb = armarLibroSwipe(ExcelJS, datos);
  const buf = await wb.xlsx.writeBuffer();
  const leido = new ExcelJS.Workbook();
  await leido.xlsx.load(buf as ArrayBuffer);
  return leido;
}
const fila = (ws: ExcelJS.Worksheet, r: number) => (ws.getRow(r).values as unknown[]).slice(1);
/** Las primeras `n` celdas de la fila, una por una: las vacías salen como null (en `fila` se pierden las vacías del final y las del medio quedan como huecos). */
const celdas = (ws: ExcelJS.Worksheet, r: number, n: number) => Array.from({ length: n }, (_, c) => ws.getCell(r, c + 1).value ?? null);

const datos: DatosExcelSwipe = {
  sesionNombre: 'WS inventado',
  cliente: 'Cliente Uno',
  codigo: 'WS-INV-ABCD',
  participantes: 4,
  generado: new Date('2026-11-24T19:05:00.000Z'),
  capitulos: [
    {
      capituloId: 'c1', capituloNombre: 'Capítulo A', totalParticipantesVotaron: 3,
      ideas: [
        { id: 'i1', titulo: 'Idea ganadora', descripcion: 'La más querida', imagenUrl: 'https://ejemplo.test/uno.png', totalVotos: 3, potencial: 3, descarte: 0, superLikes: 2, pctPotencial: 100, score: 133, avgMsDecision: 2400, quadrante: 'consenso_rapido' },
        { id: 'i2', titulo: 'Idea dudosa', totalVotos: 3, potencial: 1, descarte: 2, superLikes: 0, pctPotencial: 33, score: 33, avgMsDecision: 6150, quadrante: 'duda_genuina' },
      ],
    },
    {
      capituloId: 'c2', capituloNombre: 'Capítulo B', totalParticipantesVotaron: 1,
      ideas: [{ id: 'i3', titulo: 'Idea sin tiempos', totalVotos: 1, potencial: 1, descarte: 0, superLikes: 0, pctPotencial: 100, score: 100 }],
    },
  ],
  votos: [
    { capituloId: 'c1', capituloNombre: 'Capítulo A', ideaId: 'i1', ideaTitulo: 'Idea ganadora', alias: 'Ana', valor: 'super', msDecision: 1800, createdAt: '2026-10-14T17:21:05.000Z' },
    { capituloId: 'c1', capituloNombre: 'Capítulo A', ideaId: 'i1', ideaTitulo: 'Idea ganadora', alias: 'Beto', valor: 'potencial', msDecision: 3000, createdAt: '2026-10-14T17:22:00.000Z' },
    { capituloId: 'c1', capituloNombre: 'Capítulo A', ideaId: 'i2', ideaTitulo: 'Idea dudosa', alias: 'Ana', valor: 'descarte', createdAt: '2026-10-14T17:23:30.000Z' },
    { capituloId: 'c2', capituloNombre: 'Capítulo B', ideaId: 'i3', ideaTitulo: 'Idea sin tiempos', alias: 'Caro', valor: 'potencial', msDecision: 900, createdAt: '2026-10-15T03:30:00.000Z' },
  ],
};

// ── El libro ────────────────────────────────────────────────────────────────

await prueba('el libro trae tres hojas: Resumen, Resultados y Votos, en ese orden', async () => {
  const wb = await ida(datos);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Resultados', 'Votos']);
});

await prueba('Resumen: título, cliente y código, fecha de exportación en hora de México y las cifras de la sesión', async () => {
  const rs = (await ida(datos)).getWorksheet('Resumen')!;
  assert.equal(rs.getCell('A1').value, 'Swipe: WS inventado');
  assert.equal(rs.getCell('A2').value, 'Cliente Uno, código WS-INV-ABCD, exportado el 24 de noviembre de 2026 a las 13:05');
  const cifras = Object.fromEntries([4, 5, 6, 7, 8].map((r) => [rs.getCell(r, 1).value, rs.getCell(r, 2).value]));
  assert.deepEqual(cifras, { 'Capítulos': 2, 'Ideas': 3, 'Participantes': 4, 'Participantes que votaron': 3, 'Votos': 4 });
});

await prueba('Resumen: explica cada columna (score, cuadrantes, qué cuenta como a favor)', async () => {
  const rs = (await ida(datos)).getWorksheet('Resumen')!;
  const texto: string[] = [];
  rs.eachRow((r) => texto.push(`${r.getCell(1).value ?? ''} ${r.getCell(2).value ?? ''}`));
  const todo = texto.join('\n');
  assert.match(todo, /Score/);
  assert.match(todo, /50 × \(super likes ÷ participantes que votaron en el capítulo\)/);
  assert.match(todo, /Consenso rápido/);
  assert.match(todo, /Duda genuina/);
  assert.match(todo, /un super like también cuenta como a favor/);
  assert.match(todo, /Queda vacío si nadie votó la idea/);
  assert.match(todo, /Capítulo \+ Lugar dice cuál es cuál/, 'explica para qué sirve el lugar en la hoja Votos');
});

await prueba('Resultados: encabezados, una fila por idea y el lugar dentro de cada capítulo', async () => {
  const ws = (await ida(datos)).getWorksheet('Resultados')!;
  assert.deepEqual(fila(ws, 1), ['Capítulo', 'Lugar', 'Idea', 'Descripción', 'Votos', 'Potencial', 'Descarte', 'Super likes', '% potencial', 'Score', 'Tiempo promedio (s)', 'Cuadrante', 'Imagen']);
  assert.equal(ws.rowCount, 4, 'encabezado + 3 ideas');
  const [capitulo, lugar, titulo] = fila(ws, 2);
  assert.deepEqual([capitulo, lugar, titulo], ['Capítulo A', 1, 'Idea ganadora']);
  assert.deepEqual(fila(ws, 3).slice(0, 3), ['Capítulo A', 2, 'Idea dudosa']);
  assert.deepEqual(fila(ws, 4).slice(0, 3), ['Capítulo B', 1, 'Idea sin tiempos'], 'el lugar empieza otra vez en cada capítulo');
});

await prueba('Resultados: los números son los de la pantalla (votos, potencial, descarte, super likes, score) y el % va como porcentaje', async () => {
  const ws = (await ida(datos)).getWorksheet('Resultados')!;
  const [, , , descripcion, votos, potencial, descarte, supers, pct, score, tiempo, cuadrante] = fila(ws, 2);
  assert.deepEqual([descripcion, votos, potencial, descarte, supers, pct, score, tiempo, cuadrante], ['La más querida', 3, 3, 0, 2, 1, 133, 2.4, 'Consenso rápido']);
  assert.equal(ws.getCell('I2').numFmt, '0%');
  assert.equal(ws.getCell('I3').value, 0.33);
  assert.equal(ws.getCell('K2').numFmt, '0.0');
  assert.equal(ws.getCell('K3').value, 6.2, 'los 6150 ms se redondean a una décima');
  assert.equal(fila(ws, 3)[11], 'Duda genuina');
});

await prueba('Resultados: una idea sin tiempos ni cuadrante deja esas celdas vacías (no «0» ni «undefined»)', async () => {
  const ws = (await ida(datos)).getWorksheet('Resultados')!;
  assert.equal(ws.getCell('K4').value, null);
  assert.equal(ws.getCell('L4').value, null);
  assert.equal(ws.getCell('M4').value, null);
  assert.equal(ws.getCell('D4').value, null, 'sin descripción');
});

await prueba('Resultados: la imagen sale como liga en la que se puede dar clic', async () => {
  const ws = (await ida(datos)).getWorksheet('Resultados')!;
  const v = ws.getCell('M2').value as { text: string; hyperlink: string };
  assert.equal(v.text, 'Ver imagen');
  assert.equal(v.hyperlink, 'https://ejemplo.test/uno.png');
});

await prueba('Votos: una fila por voto con el lugar de la idea, el nombre del voto como lo ve el facilitador y el tiempo en segundos', async () => {
  const ws = (await ida(datos)).getWorksheet('Votos')!;
  assert.deepEqual(fila(ws, 1), ['Capítulo', 'Lugar', 'Idea', 'Participante', 'Voto', 'Tiempo de decisión (s)', 'Hora']);
  assert.equal(ws.rowCount, 5);
  assert.deepEqual(fila(ws, 2).slice(0, 6), ['Capítulo A', 1, 'Idea ganadora', 'Ana', 'Super like', 1.8]);
  assert.deepEqual(fila(ws, 3).slice(0, 6), ['Capítulo A', 1, 'Idea ganadora', 'Beto', 'Potencial', 3]);
  assert.deepEqual(fila(ws, 4).slice(0, 5), ['Capítulo A', 2, 'Idea dudosa', 'Ana', 'Descarte']);
  assert.deepEqual(fila(ws, 5).slice(0, 3), ['Capítulo B', 1, 'Idea sin tiempos'], 'el lugar de la idea del capítulo B empieza en 1');
  assert.equal(ws.getCell('F4').value, null, 'un voto sin tiempo queda en blanco');
});

await prueba('Votos: la hora es la de México (no la de UTC), con formato de fecha y hora', async () => {
  const ws = (await ida(datos)).getWorksheet('Votos')!;
  const h = ws.getCell('G2').value as Date;
  assert.equal(h.toISOString(), '2026-10-14T11:21:05.000Z', '17:21 UTC son las 11:21 en México; Excel lo muestra tal cual');
  assert.equal(ws.getCell('G2').numFmt, 'dd/mm/yyyy hh:mm');
  assert.equal((ws.getCell('G5').value as Date).toISOString(), '2026-10-14T21:30:00.000Z', 'un voto de la madrugada UTC cae en el día anterior en México');
});

await prueba('Votos: si dos ideas del mismo capítulo se llaman igual, el lugar dice cuál es cuál (el mismo de «Resultados»)', async () => {
  // Dos ideas «Gemela» en el capítulo (como pasó en un taller real: el nombre era el del país y solo cambiaba la descripción).
  // La ganadora es la AZUL (lugar 1), pero en el orden de la sesión la roja va primero: el lugar sale del id de la idea, no del nombre ni del orden de aparición.
  const gemelas: DatosExcelSwipe = {
    sesionNombre: 'Gemelas', generado: new Date('2026-11-24T19:05:00.000Z'),
    capitulos: [{
      capituloId: 'c', capituloNombre: 'Cap', totalParticipantesVotaron: 2,
      ideas: [
        { id: 'azul', titulo: 'Gemela', descripcion: 'Empaque azul', totalVotos: 2, potencial: 2, descarte: 0, superLikes: 1, pctPotencial: 100, score: 125 },
        { id: 'roja', titulo: 'Gemela', descripcion: 'Empaque rojo', totalVotos: 2, potencial: 1, descarte: 1, superLikes: 0, pctPotencial: 50, score: 50 },
      ],
    }],
    votos: [
      { capituloId: 'c', capituloNombre: 'Cap', ideaId: 'roja', ideaTitulo: 'Gemela', alias: 'Ana', valor: 'potencial', msDecision: 1000, createdAt: '2026-10-14T17:21:00.000Z' },
      { capituloId: 'c', capituloNombre: 'Cap', ideaId: 'roja', ideaTitulo: 'Gemela', alias: 'Beto', valor: 'descarte', msDecision: 1000, createdAt: '2026-10-14T17:22:00.000Z' },
      { capituloId: 'c', capituloNombre: 'Cap', ideaId: 'azul', ideaTitulo: 'Gemela', alias: 'Ana', valor: 'super', msDecision: 1000, createdAt: '2026-10-14T17:23:00.000Z' },
      { capituloId: 'c', capituloNombre: 'Cap', ideaId: 'azul', ideaTitulo: 'Gemela', alias: 'Beto', valor: 'potencial', msDecision: 1000, createdAt: '2026-10-14T17:24:00.000Z' },
    ],
  };
  const wb = await ida(gemelas);
  const resultados = wb.getWorksheet('Resultados')!;
  const votos = wb.getWorksheet('Votos')!;
  assert.deepEqual([2, 3].map((r) => resultados.getCell(r, 4).value), ['Empaque azul', 'Empaque rojo']);
  assert.deepEqual([2, 3, 4, 5].map((r) => votos.getCell(r, 2).value), [2, 2, 1, 1], 'los dos primeros votos son de la roja (lugar 2) y los dos últimos de la azul (lugar 1)');
  // Cruzando Capítulo + Lugar con «Resultados» se llega a la idea correcta: los votos del lugar 2 son 1 Potencial y 1 Descarte (la roja)
  const delLugar2 = [2, 3, 4, 5].map((r) => fila(votos, r)).filter((f) => f[1] === 2).map((f) => f[4]).sort();
  assert.deepEqual(delLugar2, ['Descarte', 'Potencial']);
  assert.equal(resultados.getCell(3, 6).value, 1, 'el lugar 2 de Resultados tiene 1 potencial');
  assert.equal(resultados.getCell(3, 7).value, 1, 'y 1 descarte');
});

await prueba('Votos: un voto de una idea que ya no está en los resultados deja el lugar vacío (no un número inventado)', async () => {
  const huerfano = { ...datos, votos: [...datos.votos, { capituloId: 'c1', capituloNombre: 'Capítulo A', ideaId: 'borrada', ideaTitulo: 'Ya no existe', alias: 'Ana', valor: 'potencial', createdAt: '2026-10-14T17:30:00.000Z' }] };
  const ws = (await ida(huerfano)).getWorksheet('Votos')!;
  assert.equal(ws.getCell('B6').value, null);
  assert.equal(ws.getCell('C6').value, 'Ya no existe');
});

await prueba('Resultados: una idea que nadie votó deja vacíos el % y el score (no «0%») pero conserva su lugar y sus ceros de conteo', async () => {
  const sinVotos: DatosExcelSwipe = {
    sesionNombre: 'Sin votos', generado: new Date('2026-11-24T19:05:00.000Z'),
    capitulos: [{
      capituloId: 'c', capituloNombre: 'Cap', totalParticipantesVotaron: 2,
      ideas: [
        { id: 'a', titulo: 'Con votos', totalVotos: 2, potencial: 0, descarte: 2, superLikes: 0, pctPotencial: 0, score: 0, avgMsDecision: 3000, quadrante: 'rechazo_inmediato' },
        { id: 'b', titulo: 'Nadie la votó', totalVotos: 0, potencial: 0, descarte: 0, superLikes: 0, pctPotencial: 0, score: 0 },
      ],
    }],
    votos: [],
  };
  const ws = (await ida(sinVotos)).getWorksheet('Resultados')!;
  // Una idea con votos que todos rechazaron SÍ es 0%: eso es información, no ausencia
  assert.deepEqual([ws.getCell('E2').value, ws.getCell('I2').value, ws.getCell('J2').value], [2, 0, 0]);
  assert.deepEqual(celdas(ws, 3, 8), ['Cap', 2, 'Nadie la votó', null, 0, 0, 0, 0]);
  assert.equal(ws.getCell('I3').value, null);
  assert.equal(ws.getCell('J3').value, null);
  assert.equal(ws.getCell('K3').value, null);
  assert.equal(ws.getCell('L3').value, null);
});

await prueba('cada hoja de tabla trae el encabezado fijo y filtros en todas sus columnas', async () => {
  const wb = await ida(datos);
  for (const [nombre, columnas, filas] of [['Resultados', 13, 4], ['Votos', 7, 5]] as const) {
    const ws = wb.getWorksheet(nombre)!;
    assert.equal(ws.views[0]?.state, 'frozen');
    assert.equal(ws.views[0]?.ySplit, 1);
    // Según la versión, exceljs devuelve el filtro como rango en texto («A1:M4») o como {from, to}
    const f = ws.autoFilter as any;
    const rango = typeof f === 'string' ? f : `${ws.getCell(f.from.row, f.from.column).address}:${ws.getCell(f.to.row, f.to.column).address}`;
    const col = (n: number) => String.fromCharCode(64 + n);
    assert.equal(rango, `A1:${col(columnas)}${filas}`, nombre);
  }
});

await prueba('una sesión sin capítulos ni votos igual produce un libro válido con sus tres hojas', async () => {
  const wb = await ida({ sesionNombre: 'Vacía', capitulos: [], votos: [], generado: new Date('2026-11-24T19:05:00.000Z') });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Resultados', 'Votos']);
  assert.equal(wb.getWorksheet('Resultados')!.rowCount, 1);
  assert.equal(wb.getWorksheet('Votos')!.rowCount, 1);
  assert.equal(wb.getWorksheet('Resumen')!.getCell('B6').value, 0, 'participantes: 0');
});

await prueba('sin el dato de participantes, se cuentan los que votaron', async () => {
  const { participantes, ...sin } = datos;
  const rs = (await ida(sin)).getWorksheet('Resumen')!;
  assert.equal(rs.getCell('B6').value, 3);
  assert.equal(rs.getCell('B7').value, 3);
});

await prueba('una sesión grande (5,000 votos y 300 ideas) se arma y se vuelve a leer completa', async () => {
  const caps = [{ capituloId: 'g', capituloNombre: 'Grande', totalParticipantesVotaron: 50, ideas: Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, titulo: `Idea ${i}`, totalVotos: 10, potencial: 6, descarte: 4, superLikes: 1, pctPotencial: 60, score: 62, avgMsDecision: 3000 + i })) }];
  const votos = Array.from({ length: 5000 }, (_, i) => ({ capituloId: 'g', capituloNombre: 'Grande', ideaId: `i${i % 300}`, ideaTitulo: `Idea ${i % 300}`, alias: `P${i % 50}`, valor: ['potencial', 'descarte', 'super'][i % 3], msDecision: 1000 + i, createdAt: '2026-10-14T17:21:05.000Z' }));
  const wb = await ida({ sesionNombre: 'Grande', capitulos: caps, votos });
  assert.equal(wb.getWorksheet('Resultados')!.rowCount, 301);
  assert.equal(wb.getWorksheet('Votos')!.rowCount, 5001);
});

await prueba('el nombre del archivo lleva la sesión y el día en México, sin caracteres que un archivo no admite', () => {
  assert.equal(nombreArchivoSwipe('WS Norte', new Date('2026-11-24T18:00:00Z')), 'Swipe - WS Norte (2026-11-24).xlsx');
  assert.equal(nombreArchivoSwipe('Casa/Norte: "¿Ideas?" <v2>', new Date('2026-11-24T18:00:00Z')), 'Swipe - Casa Norte ¿Ideas v2 (2026-11-24).xlsx');
  assert.equal(nombreArchivoSwipe('Tarde', new Date('2026-11-25T03:00:00Z')), 'Swipe - Tarde (2026-11-24).xlsx', 'a las 21:00 del 24 en México todavía es 24');
  assert.equal(nombreArchivoSwipe('   ', new Date('2026-11-24T18:00:00Z')), 'Swipe - sesión (2026-11-24).xlsx');
});

await prueba('comoHoraDeMexico: una fecha que no es fecha da nada', () => {
  assert.equal(comoHoraDeMexico('no es fecha'), null);
  assert.equal(comoHoraDeMexico('2026-01-15T12:00:00Z')!.toISOString(), '2026-01-15T06:00:00.000Z');
});

// ── El endpoint y los números contra una base en memoria ────────────────────

const pg = await PGlite.create();
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(`
  create table swipe_sesiones (id uuid primary key default gen_random_uuid(), codigo text unique not null, nombre text not null, estado text not null default 'activa', max_super_likes int not null default 3);
  create table swipe_capitulos (id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id) on delete cascade, nombre text not null, descripcion text, orden int not null, estado text not null default 'abierto', aleatorio boolean not null default false);
  create table swipe_ideas (id uuid primary key default gen_random_uuid(), capitulo_id uuid not null references swipe_capitulos(id) on delete cascade, titulo text not null, descripcion text, imagen_url text, orden int not null);
  create table swipe_participantes (id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id) on delete cascade, alias text not null);
  create table swipe_votos (id uuid primary key default gen_random_uuid(), idea_id uuid not null references swipe_ideas(id) on delete cascade, participante_id uuid not null references swipe_participantes(id) on delete cascade, valor text not null, ms_decision int, created_at timestamptz not null default now(), unique (idea_id, participante_id));
`);
const id = async (sql: string, params: unknown[]) => (await pg.query<{ id: string }>(sql, params)).rows[0].id;
const sesion = await id(`insert into swipe_sesiones (codigo, nombre) values ('S1', 'Sesión uno') returning id`, []);
const otra = await id(`insert into swipe_sesiones (codigo, nombre) values ('S2', 'Sesión dos') returning id`, []);
// El capítulo B se crea primero pero su orden es 2: el orden de la sesión manda, no el de creación
const capB = await id(`insert into swipe_capitulos (sesion_id, nombre, orden) values ($1, 'Capítulo B', 2) returning id`, [sesion]);
const capA = await id(`insert into swipe_capitulos (sesion_id, nombre, orden) values ($1, 'Capítulo A', 1) returning id`, [sesion]);
const idea = async (cap: string, titulo: string, orden: number, extra: { desc?: string; img?: string } = {}) =>
  id(`insert into swipe_ideas (capitulo_id, titulo, descripcion, imagen_url, orden) values ($1, $2, $3, $4, $5) returning id`, [cap, titulo, extra.desc ?? null, extra.img ?? null, orden]);
const a1 = await idea(capA, 'A1', 1, { desc: 'Primera', img: 'https://ejemplo.test/a1.png' });
const a2 = await idea(capA, 'A2', 2);
await idea(capA, 'A3', 3); // nadie la vota
const b1 = await idea(capB, 'B1', 1);
const oi = await idea((await id(`insert into swipe_capitulos (sesion_id, nombre, orden) values ($1, 'De otra sesión', 1) returning id`, [otra])), 'Ajena', 1);
const persona = async (alias: string, ses = sesion) => id(`insert into swipe_participantes (sesion_id, alias) values ($1, $2) returning id`, [ses, alias]);
const [ana, beto, caro] = [await persona('Ana'), await persona('Beto'), await persona('Caro')];
const voto = (ideaId: string, quien: string, valor: string, ms: number | null, cuando: string) =>
  pg.query(`insert into swipe_votos (idea_id, participante_id, valor, ms_decision, created_at) values ($1, $2, $3, $4, $5)`, [ideaId, quien, valor, ms, cuando]);
// Votos metidos en desorden a propósito
await voto(a1, beto, 'potencial', 3000, '2026-10-14T17:22:00Z');
await voto(a1, ana, 'super', 1800, '2026-10-14T17:21:05Z');
await voto(a1, caro, 'potencial', 2400, '2026-10-14T17:25:00Z');
await voto(a2, ana, 'descarte', null, '2026-10-14T17:23:30Z');
await voto(a2, beto, 'descarte', 9000, '2026-10-14T17:24:00Z');
await voto(b1, caro, 'potencial', 900, '2026-10-15T03:30:00Z');
await voto(oi, await persona('Intruso', otra), 'potencial', 500, '2026-10-14T18:00:00Z');
const editor = { user: { id: 'u1', email: 'alguien@ejemplo.test' } };

let votosSesion: any[] = [];
await prueba('getSwipeVotosSesion: trae solo los votos de esa sesión, en el orden de la sesión (capítulo, idea, hora)', async () => {
  const r: any = await getSwipeVotosSesion.run({ sesionId: sesion }, editor);
  votosSesion = r.votos;
  assert.equal(r.votos.length, 6, 'el voto de la otra sesión no entra');
  assert.deepEqual(r.votos.map((v: any) => `${v.capituloNombre}/${v.ideaTitulo}/${v.alias}`), [
    'Capítulo A/A1/Ana', 'Capítulo A/A1/Beto', 'Capítulo A/A1/Caro', 'Capítulo A/A2/Ana', 'Capítulo A/A2/Beto', 'Capítulo B/B1/Caro',
  ]);
});

await prueba('getSwipeVotosSesion: cada voto trae su valor, su tiempo (o nada) y la hora en ISO', async () => {
  const [v1, , , v4] = votosSesion;
  assert.equal(v1.valor, 'super');
  assert.equal(v1.msDecision, 1800);
  assert.equal(v1.createdAt, '2026-10-14T17:21:05.000Z');
  assert.equal(v4.msDecision, undefined, 'sin tiempo: no sale el campo');
  assert.ok(votosSesion.every((v) => v.capituloId && v.ideaId));
});

await prueba('getSwipeVotosSesion: una sesión sin votos da lista vacía; sin sesión iniciada se rechaza', async () => {
  const vacia = await id(`insert into swipe_sesiones (codigo, nombre) values ('S3', 'Sin votos') returning id`, []);
  assert.deepEqual(await getSwipeVotosSesion.run({ sesionId: vacia }, editor), { votos: [] });
  await assert.rejects(() => getSwipeVotosSesion.run({ sesionId: sesion }, { user: null }), (e: unknown) => e instanceof ZiteError && e.code === 'UNAUTHORIZED');
});

await prueba('lo que sale en «Resultados» es exactamente lo que calcula el servidor (getSwipeResultadosSesion)', async () => {
  const res: any = await getSwipeResultadosSesion.run({ sesionId: sesion }, editor);
  const wb = await ida({ sesionNombre: 'Sesión uno', capitulos: res.capitulos, votos: votosSesion, generado: new Date('2026-11-24T19:05:00.000Z') });
  const ws = wb.getWorksheet('Resultados')!;
  // Una idea sin votos (A3) sale con el % y el score vacíos; las demás, tal cual los calcula el servidor
  const esperadas = res.capitulos.flatMap((c: any) => c.ideas.map((i: any, k: number) => [c.capituloNombre, k + 1, i.titulo, i.descripcion ?? null, i.totalVotos, i.potencial, i.descarte, i.superLikes, i.totalVotos > 0 ? i.pctPotencial / 100 : null, i.totalVotos > 0 ? i.score : null]));
  assert.equal(ws.rowCount, esperadas.length + 1);
  assert.equal(esperadas.length, 4, 'A1, A2, A3 y B1');
  esperadas.forEach((e: unknown[], k: number) => assert.deepEqual(celdas(ws, k + 2, 10), e, `fila ${k + 2}`));
  // A1 (3 votos a favor, 1 super like, 3 personas votaron en el capítulo) es la primera del Capítulo A; A2 (0% a favor) la segunda; A3 (sin votos) la tercera
  assert.deepEqual(fila(ws, 2).slice(0, 3), ['Capítulo A', 1, 'A1']);
  assert.deepEqual(celdas(ws, 4, 5), ['Capítulo A', 3, 'A3', null, 0]);
  assert.equal(ws.getCell('I4').value, null, 'A3 no tiene % potencial');
  assert.equal(ws.getCell('J2').value, Math.round(100 + (1 / 3) * 50), 'score = % potencial + 50 × super likes ÷ participantes que votaron en el capítulo (3 en el capítulo A)');
  assert.equal(ws.getCell('I3').value, 0, 'A2 sí tuvo votos y todos fueron descarte: es 0%, no vacío');
});

await prueba('integración: con dos ideas del mismo nombre, «Capítulo + Lugar» de la hoja Votos lleva a la fila correcta de «Resultados» (datos de la base)', async () => {
  const ses = await id(`insert into swipe_sesiones (codigo, nombre) values ('S4', 'Gemelas') returning id`, []);
  const cap = await id(`insert into swipe_capitulos (sesion_id, nombre, orden) values ($1, 'Cap D', 1) returning id`, [ses]);
  // En el orden de la sesión la roja va primero, pero la azul gana: el lugar no puede salir del orden de aparición ni del nombre
  const roja = await idea(cap, 'Gemela', 1, { desc: 'Empaque rojo' });
  const azul = await idea(cap, 'Gemela', 2, { desc: 'Empaque azul' });
  const [p1, p2] = [await persona('P1', ses), await persona('P2', ses)];
  await voto(roja, p1, 'potencial', 1000, '2026-10-14T17:21:00Z');
  await voto(roja, p2, 'descarte', 1000, '2026-10-14T17:22:00Z');
  await voto(azul, p1, 'super', 1000, '2026-10-14T17:23:00Z');
  await voto(azul, p2, 'potencial', 1000, '2026-10-14T17:24:00Z');
  const res: any = await getSwipeResultadosSesion.run({ sesionId: ses }, editor);
  const vot: any = await getSwipeVotosSesion.run({ sesionId: ses }, editor);
  const wb = await ida({ sesionNombre: 'Gemelas', capitulos: res.capitulos, votos: vot.votos, generado: new Date('2026-11-24T19:05:00.000Z') });
  const rs = wb.getWorksheet('Resultados')!;
  const vs = wb.getWorksheet('Votos')!;
  assert.deepEqual([2, 3].map((r) => rs.getCell(r, 4).value), ['Empaque azul', 'Empaque rojo']);
  assert.deepEqual([2, 3, 4, 5].map((r) => vs.getCell(r, 2).value), [2, 2, 1, 1], 'los votos de la roja (primeros) llevan lugar 2 y los de la azul lugar 1');
  assert.deepEqual([2, 3, 4, 5].map((r) => vs.getCell(r, 3).value), ['Gemela', 'Gemela', 'Gemela', 'Gemela'], 'el nombre se repite: sin el lugar no se distinguirían');
});

await prueba('el capítulo que se creó primero pero tiene orden 2 sale después en las dos hojas', async () => {
  const res: any = await getSwipeResultadosSesion.run({ sesionId: sesion }, editor);
  assert.deepEqual(res.capitulos.map((c: any) => c.capituloNombre), ['Capítulo A', 'Capítulo B']);
  assert.deepEqual(votosSesion.map((v) => v.capituloNombre).filter((x, i, a) => a.indexOf(x) === i), ['Capítulo A', 'Capítulo B']);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
