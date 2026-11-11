// Pruebas del buscador de gente: el texto (normalizar, partir listas, tapar el término, columnas personales), el agrupado de lo hallado, y el catálogo y la búsqueda de punta a punta contra una base
// en memoria (PGlite) con el esquema real y tableros inventados: matriz de marcas («Levité (Priorización marcas)»), ranking en lista, opciones con coma, columnas personales que no se leen, filas borradas,
// respuestas que dieron muy pocas filas (no se guardan), tableros que no son de reclutamiento, un tablero con datos rotos, y la actualización de solo lo que cambió. Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-busqueda.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import {
  MAX_VALORES_DISTINTOS, MIN_FILAS_POR_PIEZA, capitalizar, entraAlCatalogo, esColumnaPersonal, esPiezaPersonal, esTerminoValido, limpiarEtiqueta, limpiarPieza, modoDeColumna, normalizarTexto, partirPiezas, plantillaDe,
} from '../../src/lib/busqueda/texto';
import { agruparHallazgos, esPrimeraOpcion, filasQueCumplen, MAX_ITEMS_POR_GRUPO, type ColumnaHallada, type PiezaHallada } from '../../src/lib/busqueda/agrupar';
import { SQL_TABLAS_BUSQUEDA, traducirFaltaTablasBusqueda } from '../../src/serverUtils/busqueda/almacen';
import { actualizarCatalogo } from '../../src/serverUtils/busqueda/catalogo';
import { buscarEnCatalogo, escaparLike, estadoDelCatalogo } from '../../src/serverUtils/busqueda/buscar';

process.env.STRICT_OUTPUT = 'true';
const buscarGente = (await import('../../src/api/buscarGente')).default;
const getCatalogoBusqueda = (await import('../../src/api/getCatalogoBusqueda')).default;

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

// ── el texto (sin base) ─────────────────────────────────────────────────────
await prueba('normalizarTexto: sin acentos ni mayúsculas, con espacios sencillos', () => {
  assert.equal(normalizarTexto('  Levité '), 'levite');
  assert.equal(normalizarTexto('CAFÉ   con  leche'), 'cafe con leche');
  assert.equal(normalizarTexto(null), '');
  assert.equal(normalizarTexto('Niño'), 'nino');
});

await prueba('limpiarPieza: quita viñetas y «1.» del principio y signos de los bordes, pero no un número que es parte de la respuesta', () => {
  assert.equal(limpiarPieza('1) Corona '), 'corona');
  assert.equal(limpiarPieza('- Bohemia'), 'bohemia');
  assert.equal(limpiarPieza('2. Modelo'), 'modelo');
  assert.equal(limpiarPieza('• Victoria.'), 'victoria');
  assert.equal(limpiarPieza('3 veces por semana'), '3 veces por semana');
  assert.equal(limpiarPieza('Heineken 0.0'), 'heineken 0.0');
});

await prueba('limpiarEtiqueta conserva los acentos (es lo que se muestra) y capitalizar pone la primera en mayúscula', () => {
  assert.equal(limpiarEtiqueta('  La DEJÉ de consumir… '), 'la dejé de consumir');
  assert.equal(limpiarEtiqueta('1) Plátano'), 'plátano');
  assert.equal(capitalizar('es mi top / favorita'), 'Es mi top / favorita');
  assert.equal(capitalizar(''), '');
});

await prueba('partirPiezas: separa por coma, punto y coma, salto de línea y barra; respeta paréntesis; no repite y conserva el orden', () => {
  assert.deepEqual(partirPiezas('Corona, Modelo\nVictoria'), ['corona', 'modelo', 'victoria']);
  assert.deepEqual(partirPiezas('Bohemia (Vienna, Weizen), Corona'), ['bohemia (vienna, weizen)', 'corona']);
  assert.deepEqual(partirPiezas('Corona; corona | CORONA'), ['corona']);
  assert.deepEqual(partirPiezas('1 corona A\n2 dos X b'), ['1 corona a', '2 dos x b']);
  assert.deepEqual(partirPiezas(''), []);
  assert.deepEqual(partirPiezas('x'.repeat(200)), [], 'una oración larga no es una opción');
});

await prueba('esTerminoValido, plantillaDe y escaparLike', () => {
  assert.equal(esTerminoValido('a'), false);
  assert.equal(esTerminoValido('!!'), false);
  assert.equal(esTerminoValido('co'), true);
  assert.equal(plantillaDe('levite (priorizacion marcas)', 'levite'), '«…» (priorizacion marcas)');
  assert.equal(plantillaDe('ranking de marcas', 'levite'), 'ranking de marcas');
  assert.equal(escaparLike('50%_x\\'), '50\\%\\_x\\\\');
});

await prueba('columnas personales: nombre, teléfono, correo, dirección o identificación no se leen; una pregunta que menciona «nombre» sí', () => {
  for (const nombre of ['Teléfono', 'Nombre completo', 'Nombre', 'Correo electrónico', 'Dirección', 'identificación 1', 'Aviso de privacidad', 'celular', 'CURP', 'Código postal', 'WhatsApp',
    'NR', 'Reclutador', 'Nombre reclutador', 'Quién lo invitó', '¿Quién te invitó?', 'Por favor escribe tu dirección', 'Tu domicilio', '¿Cómo te llamas?']) {
    assert.equal(esColumnaPersonal(nombre), true, nombre);
  }
  for (const nombre of ['¿Cuál es el nombre de la marca que más compras?', 'género', 'Levité (Priorización marcas)', 'edad', 'Ranking marcas de cerveza', 'Marcas preferidas CERVEZA', 'Marca preferida', 'Referencia de precio', '¿Recomendarías esta marca?', 'Horario preferido']) {
    assert.equal(esColumnaPersonal(nombre), false, nombre);
  }
  assert.equal(entraAlCatalogo('Texto', 'Levité (Priorización marcas)'), true);
  assert.equal(entraAlCatalogo('Archivo', 'Levité'), false);
  assert.equal(entraAlCatalogo('Texto', 'Teléfono'), false);
  assert.equal(entraAlCatalogo(null, 'algo'), false);
  assert.equal(entraAlCatalogo('Texto', null), false);
});

await prueba('esPiezaPersonal: correos, teléfonos y números largos, ligas, usuarios de red y claves CURP o RFC no se guardan; una lista se revisa pieza por pieza y las respuestas normales sí pasan', () => {
  for (const personal of ['ana.lopez@ejemplo.test', 'ANA@Ejemplo.COM', '5512345678', '55 1234 5678', '(55) 1234-5678', '+52 55 1234 5678', 'https://instagram.com/alguien', 'www.sitio.test', '@usuario_ejemplo', 'XXXX800101XXX', 'ABCD800101HDFRRN09', 'Corona, 5512345678']) {
    assert.equal(esPiezaPersonal(personal), true, personal);
  }
  for (const normal of ['Heineken 0.0', 'botella de 1.4 l', 'hij@s', '2 a 3 veces por semana', 'Corona, Modelo, Victoria', '355 ml, 600 ml, 1 l', 'Es mi top / favorita', '', 'más de 5 años', '12 meses', 'coca-cola 600 ml']) {
    assert.equal(esPiezaPersonal(normal), false, normal);
  }
});

await prueba('modoDeColumna: opciones que se repiten son «de valores»; si cada quien escribió lo suyo, «de lista»', () => {
  assert.equal(modoDeColumna(100, 5), 'valores');
  assert.equal(modoDeColumna(100, MAX_VALORES_DISTINTOS), 'valores');
  assert.equal(modoDeColumna(100, MAX_VALORES_DISTINTOS + 1), 'lista');
  assert.equal(modoDeColumna(20, 15), 'lista');
  assert.equal(modoDeColumna(10, 4), 'valores');
});

// ── el agrupado (sin base) ──────────────────────────────────────────────────
const tablero = (id: string, extra: Partial<ColumnaHallada> = {}): ColumnaHallada => ({
  tableroId: `t${id}`, proyecto: `P${id}`, tablero: `Tablero ${id}`, cliente: 'Cliente', fechaInicio: `2026-0${id}-10`, columnaId: `c${id}`, nombre: 'Levité (Priorización marcas)',
  nombreNorm: 'levite (priorizacion marcas)', respondieron: 40, modo: 'valores', ...extra,
});
await prueba('agruparHallazgos: la misma pregunta de varios tableros es un grupo, con las respuestas sumadas; otra forma de preguntar es otro grupo; y mencionarlo en una lista es otro', () => {
  const columnas = [
    tablero('1'), tablero('2', { respondieron: 15 }),
    tablero('3', { nombre: '¿Cuándo fue la última vez que compraste Levité?', nombreNorm: '¿cuando fue la ultima vez que compraste levite?', respondieron: 8 }),
  ];
  const piezas: PiezaHallada[] = [
    { columnaId: 'c1', pieza: 'no me gusta / no la compro', etiqueta: 'no me gusta / no la compro', filas: 9, primero: null }, { columnaId: 'c1', pieza: 'es mi top / favorita', etiqueta: 'es mi top / favorita', filas: 12, primero: null },
    { columnaId: 'c2', pieza: 'no me gusta / no la compro', etiqueta: 'no me gusta / no la compro', filas: 7, primero: null },
  ];
  const menciones = [{ ...tablero('4', { nombre: 'Ranking marcas de agua', nombreNorm: 'ranking marcas de agua', modo: 'lista' as const, respondieron: 60 }), pieza: 'levite', etiqueta: 'levité', filas: 20, primero: 6 }];
  const grupos = agruparHallazgos('levite', columnas, piezas, menciones);
  assert.equal(grupos.length, 3);
  const matriz = grupos.find((g) => g.clave === '«…» (priorizacion marcas)')!;
  assert.deepEqual([matriz.donde, matriz.tableros, matriz.filas, matriz.ejemplo], ['columna', 2, 55, 'Levité (Priorización marcas)']);
  assert.deepEqual(matriz.valores.map((v) => [v.valor, v.etiqueta, v.filas, v.tableros]), [['no me gusta / no la compro', 'no me gusta / no la compro', 16, 2], ['es mi top / favorita', 'es mi top / favorita', 12, 1]]);
  assert.deepEqual(matriz.items.map((i) => i.tableroId), ['t1', 't2'], 'primero el tablero con más filas');
  const lista = grupos.find((g) => g.donde === 'respuesta')!;
  assert.deepEqual([lista.clave, lista.filas, lista.items[0].valores[0].primero], ['ranking marcas de agua', 20, 6]);
  assert.deepEqual(grupos.map((g) => g.donde), ['columna', 'respuesta', 'columna'], 'ordenados por filas: 55, 20 y 8');
});

await prueba('agruparHallazgos: muestra hasta MAX_ITEMS_POR_GRUPO tableros pero los totales cuentan todos', () => {
  const columnas = Array.from({ length: MAX_ITEMS_POR_GRUPO + 30 }, (_, i) => tablero(String(i + 1), { tableroId: `t${i}`, columnaId: `c${i}`, fechaInicio: null }));
  const g = agruparHallazgos('levite', columnas, [], [])[0];
  assert.equal(g.items.length, MAX_ITEMS_POR_GRUPO);
  assert.equal(g.tableros, MAX_ITEMS_POR_GRUPO + 30);
  assert.equal(g.filas, (MAX_ITEMS_POR_GRUPO + 30) * 40);
});

await prueba('filasQueCumplen en un grupo «columna»: todas las que respondieron si no se elige nada; si se eligen respuestas, solo las que dieron esas', () => {
  const item = { respondieron: 40, valores: [{ valor: 'es mi top / favorita', etiqueta: 'es mi top / favorita', filas: 12, primero: null }, { valor: 'no me gusta / no la compro', etiqueta: 'no me gusta / no la compro', filas: 9, primero: null }, { valor: 'la consumo a veces', etiqueta: 'la consumo a veces', filas: 15, primero: null }] };
  assert.equal(filasQueCumplen('columna', item, new Set(), false, 'levite'), 40);
  assert.equal(filasQueCumplen('columna', item, new Set(['no me gusta / no la compro']), false, 'levite'), 9);
  assert.equal(filasQueCumplen('columna', item, new Set(['no me gusta / no la compro', 'es mi top / favorita']), false, 'levite'), 21);
  assert.equal(filasQueCumplen('columna', item, new Set(['otra']), false, 'levite'), 0);
});

await prueba('filasQueCumplen en un grupo «respuesta»: las que mencionan el término, o solo las que lo ponen primero (en listas partidas y en textos enteros)', () => {
  const partidas = { respondieron: 60, valores: [{ valor: 'corona', etiqueta: 'corona', filas: 30, primero: 12 }, { valor: 'corona cero', etiqueta: 'corona cero', filas: 5, primero: 1 }] };
  assert.equal(filasQueCumplen('respuesta', partidas, new Set(), false, 'corona'), 35);
  assert.equal(filasQueCumplen('respuesta', partidas, new Set(), true, 'corona'), 13);
  const enteras = { respondieron: 100, valores: [{ valor: 'corona cero, modelo cero', etiqueta: 'corona cero, modelo cero', filas: 10, primero: null }, { valor: 'modelo, corona', etiqueta: 'modelo, corona', filas: 6, primero: null }] };
  assert.equal(filasQueCumplen('respuesta', enteras, new Set(), false, 'corona'), 16);
  assert.equal(filasQueCumplen('respuesta', enteras, new Set(), true, 'corona'), 10, 'solo la primera lista empieza con corona');
  assert.equal(esPrimeraOpcion({ valor: 'a', etiqueta: 'a', filas: 4, primero: 3 }, 'a'), 3);
});

// ── el catálogo y la búsqueda, contra PGlite ────────────────────────────────
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

await prueba('sin las tablas del buscador: el estado lo dice sin fallar y buscar explica qué falta', async () => {
  assert.deepEqual(await estadoDelCatalogo(pool as any), { existe: false, tableros: 0, preguntas: 0, respuestas: 0, actualizado: null });
  const e = (await getCatalogoBusqueda.run({}, ctx())) as any;
  assert.equal(e.existe, false);
  await assert.rejects(buscarGente.run({ termino: 'corona' }, ctx()), /Todavía no existen las tablas del buscador/);
  assert.throws(() => traducirFaltaTablasBusqueda(new Error('otra cosa')), /otra cosa/);
});
function ctx() { return { user: { id: '00000000-0000-0000-0000-000000000001', email: 'analista@ejemplo.test' } } as any; }
await pg.exec(SQL_TABLAS_BUSQUEDA);

const proyecto = async (codigo: string, cliente: string, inicio: string) => pg.query(`insert into projects (project_code, full_name, client, start_date) values ($1, $2, $3, $4::date)`, [codigo, `Proyecto ${codigo}`, cliente, inicio]);
await proyecto('PRY-UNO', 'Cliente Uno', '2026-01-15');
await proyecto('PRY-DOS', 'Cliente Dos', '2026-06-01');
const nuevoTablero = async (nombre: string, codigo: string, tipo = 'recruitment') => (await pg.query<{ id: string }>(`insert into boards (board_name, project_code, board_type) values ($1, $2, $3) returning id::text as id`, [nombre, codigo, tipo])).rows[0].id;
const nuevaColumna = async (tableroId: string, nombre: string, tipo: string, borrada = false) => (await pg.query<{ id: string }>(
  `insert into board_columns (column_name, board_id, column_type, column_order, deleted_at) values ($1, $2, $3, 1, $4) returning id::text as id`, [nombre, tableroId, tipo, borrada ? '2026-01-01' : null])).rows[0].id;
const nuevaFila = async (tableroId: string, codigo: string, nombreTablero: string, celdas: Record<string, string>, borrada = false, crudo?: string) => pg.query(
  `insert into recruitment_rows (board_id, project_code, board_name, participant_name, phone, cell_data, deleted_at) values ($1, $2, $3, $4, $5, $6, $7)`,
  [tableroId, codigo, nombreTablero, `Persona ${Math.random().toString(36).slice(2, 8)}`, `55${Math.floor(Math.random() * 1e8)}`,
    crudo ?? JSON.stringify(Object.fromEntries(Object.entries(celdas).map(([k, v]) => [k, { textValue: v }]))), borrada ? '2026-01-02' : null]);

const MARCAS = ['Corona', 'Modelo', 'Victoria', 'Indio', 'Tecate', 'Heineken'];
/** La lista de la fila `i`: una vuelta de las marcas desde otra posición, en un sentido u otro, de 2 a 5 marcas: 48 combinaciones, así que no hay dos filas iguales entre las primeras 40. */
const listaDe = (i: number): string[] => {
  const largo = 2 + (i % 4), inicio = Math.floor(i / 4) % 6, atras = Math.floor(i / 24) % 2 === 1;
  return Array.from({ length: largo }, (_, j) => MARCAS[(((atras ? -j : j) + inicio) % 6 + 6) % 6]);
};

// Tablero 1 (proyecto uno): 40 filas con una matriz de marcas, un ranking en lista, opciones con coma, y columnas personales.
const T1 = await nuevoTablero('Respuestas filtro uno', 'PRY-UNO');
const col1 = {
  levite: await nuevaColumna(T1, 'Levité (Priorización marcas)', 'Texto'),
  corona: await nuevaColumna(T1, 'Corona (Priorización marcas)', 'Texto'),
  ranking: await nuevaColumna(T1, 'Ranking marcas de cerveza', 'Texto'),
  ultimoMes: await nuevaColumna(T1, '¿La compraste el último mes?', 'Texto'),
  ocupacion: await nuevaColumna(T1, 'Ocupación', 'Texto'),
  monday: await nuevaColumna(T1, 'Tablero Monday', 'Texto'),
  nr: await nuevaColumna(T1, 'NR', 'Texto'),
  suDireccion: await nuevaColumna(T1, 'Por favor escribe tu dirección', 'Texto'),
  telefono: await nuevaColumna(T1, 'Teléfono', 'Texto'),
  nombre: await nuevaColumna(T1, 'Nombre completo', 'Texto'),
  direccion: await nuevaColumna(T1, 'Dirección', 'Texto'),
  aviso: await nuevaColumna(T1, 'Aviso de privacidad', 'Archivo'),
  vieja: await nuevaColumna(T1, 'Pregunta vieja de Levité', 'Texto', true),
};
const escalaLevite = [...Array(12).fill('Es mi top / favorita'), ...Array(9).fill('No me gusta / no la compro'), ...Array(15).fill('La consumo a veces'), ...Array(4).fill('Es de mis opciones principales')];
const escalaCorona = [...Array(20).fill('Es mi top / favorita'), ...Array(2).fill('No me gusta / no la compro'), ...Array(14).fill('La consumo a veces'), ...Array(4).fill('La dejé de consumir hace 6 meses o más')];
const ultimo = [...Array(10).fill('Sí, mucho'), ...Array(15).fill('No'), ...Array(15).fill('Sí, poco')];
// Una columna con nombre inocente pero con un correo repetido (una importación desalineada), otra con un identificador de once dígitos igual en todas las filas, la de los reclutadores y la de la dirección.
const ocupaciones = [...Array(14).fill('Empleado'), ...Array(20).fill('Estudiante'), ...Array(6).fill('ana@ejemplo.test')];
const reclutadoras = [...Array(25).fill('Recluta Uno'), ...Array(15).fill('Recluta Dos')];
for (let i = 0; i < 40; i++) {
  await nuevaFila(T1, 'PRY-UNO', 'Respuestas filtro uno', {
    [col1.levite]: escalaLevite[i], [col1.corona]: escalaCorona[i], [col1.ranking]: listaDe(i).join(i % 2 ? ', ' : '\n'), [col1.ultimoMes]: ultimo[i],
    [col1.telefono]: `55000000${i}`, [col1.nombre]: `Nombre Apellido ${i}`, [col1.direccion]: `Calle ${i} número ${i}`, [col1.vieja]: 'Es mi top / favorita',
    [col1.ocupacion]: ocupaciones[i], [col1.monday]: '12345678901', [col1.nr]: reclutadoras[i], [col1.suDireccion]: i < 6 ? 'Calle Falsa 123' : `Otra calle ${i}`,
  });
}
// Filas borradas: no cuentan (si contaran, «Levité» tendría 3 «Es mi top» de más).
for (let i = 0; i < 3; i++) await nuevaFila(T1, 'PRY-UNO', 'Respuestas filtro uno', { [col1.levite]: 'Es mi top / favorita', [col1.ranking]: 'Corona, Modelo' }, true);

// Tablero 2 (proyecto dos): una matriz con otra marca primero y «Levité» con dos respuestas que se repiten poco.
const T2 = await nuevoTablero('Respuestas filtro dos', 'PRY-DOS');
const col2 = { levite: await nuevaColumna(T2, 'Levité (Priorización marcas)', 'Texto'), ultima: await nuevaColumna(T2, '¿Cuándo fue la última vez que compraste Levité?', 'Texto') };
const escala2 = [...Array(7).fill('No me gusta / no la compro'), ...Array(2).fill('Es mi top / favorita'), ...Array(6).fill('La consumo a veces')];
for (const v of escala2) await nuevaFila(T2, 'PRY-DOS', 'Respuestas filtro dos', { [col2.levite]: v, [col2.ultima]: 'Hace menos de un mes' });

// Un tablero que no es de reclutamiento y otro sin filas vivas: no entran.
const T3 = await nuevoTablero('Calendario', 'PRY-UNO', 'calendar');
const colPm = await nuevaColumna(T3, 'Levité (Priorización marcas)', 'Texto');
for (let i = 0; i < 5; i++) await nuevaFila(T3, 'PRY-UNO', 'Calendario', { [colPm]: 'No me gusta / no la compro' });
const T4 = await nuevoTablero('Tablero vacío', 'PRY-DOS');
const colVacia = await nuevaColumna(T4, 'Levité (Priorización marcas)', 'Texto');
await nuevaFila(T4, 'PRY-DOS', 'Tablero vacío', { [colVacia]: 'No me gusta / no la compro' }, true);

// Un tablero con datos rotos: falla solo ese.
const T5 = await nuevoTablero('Tablero con datos rotos', 'PRY-DOS');
await nuevaColumna(T5, 'Levité (Priorización marcas)', 'Texto');
await nuevaFila(T5, 'PRY-DOS', 'Tablero con datos rotos', {}, false, 'esto no es json');

let resumen1: Awaited<ReturnType<typeof actualizarCatalogo>>;
await prueba('actualizarCatalogo: lee los tableros de reclutamiento con filas, avisa el avance y deja fallar solo al que trae datos rotos', async () => {
  const avances: Array<[number, number]> = [];
  resumen1 = await actualizarCatalogo({ consulta: pool as any, alAvanzar: (h, t) => avances.push([h, t]) });
  assert.equal(resumen1.tableros, 3, 'T1, T2 y T5: T3 no es de reclutamiento y T4 no tiene filas vivas');
  assert.equal(resumen1.leidos, 2);
  assert.equal(resumen1.sinCambios, 0);
  assert.deepEqual(resumen1.fallidos.map((f) => f.tablero), ['Tablero con datos rotos']);
  assert.deepEqual(avances[avances.length - 1], [3, 3]);
  const { rows } = await pg.query<{ tablero: string }>(`select tablero from busqueda_tableros order by tablero`);
  assert.deepEqual(rows.map((r) => r.tablero), ['Respuestas filtro dos', 'Respuestas filtro uno']);
});

const columnaDe = async (tableroNombre: string, nombre: string) => (await pg.query<{ id: string; modo: string; respondieron: number; distintos: number }>(
  `select c.id::text as id, c.modo, c.respondieron, c.distintos from busqueda_columnas c join busqueda_tableros t on t.tablero_id = c.tablero_id where t.tablero = $1 and c.nombre = $2`, [tableroNombre, nombre])).rows[0];
const piezasDe = async (columnaId: string) => new Map((await pg.query<{ pieza: string; filas: number; primero: number | null }>(`select pieza, filas, primero from busqueda_piezas where columna = $1::uuid`, [columnaId])).rows.map((r) => [r.pieza, r]));

await prueba('el catálogo guarda las preguntas y las respuestas que se repiten, con el conteo exacto y sin las filas borradas', async () => {
  const c = await columnaDe('Respuestas filtro uno', 'Levité (Priorización marcas)');
  assert.deepEqual([c.modo, c.respondieron, c.distintos], ['valores', 40, 4]);
  const p = await piezasDe(c.id);
  assert.deepEqual([...p].map(([k, v]) => [k, v.filas]).sort(), [['es de mis opciones principales', 4], ['es mi top / favorita', 12], ['la consumo a veces', 15], ['no me gusta / no la compro', 9]]);
  assert.equal(p.get('es mi top / favorita')!.primero, null, 'en una columna de opciones no hay «primero»');
});

await prueba('las opciones con coma se guardan enteras («Sí, mucho»), no partidas', async () => {
  const c = await columnaDe('Respuestas filtro uno', '¿La compraste el último mes?');
  assert.equal(c.modo, 'valores');
  assert.deepEqual([...(await piezasDe(c.id))].map(([k, v]) => [k, v.filas]).sort(), [['no', 15], ['si, mucho', 10], ['si, poco', 15]]);
});

await prueba('una lista escrita por cada persona se parte en piezas: en cuántas filas sale cada marca y cuántas veces es la primera', async () => {
  const c = await columnaDe('Respuestas filtro uno', 'Ranking marcas de cerveza');
  assert.equal(c.modo, 'lista');
  const listas = Array.from({ length: 40 }, (_, i) => listaDe(i).map((m) => m.toLowerCase()));
  const p = await piezasDe(c.id);
  for (const marca of MARCAS.map((m) => m.toLowerCase())) {
    const esperadoFilas = listas.filter((l) => l.includes(marca)).length;
    const esperadoPrimero = listas.filter((l) => l[0] === marca).length;
    assert.deepEqual([p.get(marca)?.filas, p.get(marca)?.primero], [esperadoFilas, esperadoPrimero], marca);
  }
});

await prueba('lo que da muy pocas filas no se guarda (así nada identifica a una persona): «Levité» del tablero dos, con 2 filas «Es mi top», no lo guarda', async () => {
  const c = await columnaDe('Respuestas filtro dos', 'Levité (Priorización marcas)');
  const p = await piezasDe(c.id);
  assert.equal(p.has('es mi top / favorita'), false);
  assert.ok(MIN_FILAS_POR_PIEZA > 2);
  assert.equal(p.get('no me gusta / no la compro')!.filas, 7);
  assert.equal(c.respondieron, 15, 'pero la pregunta sí cuenta a todas las que respondieron');
});

await prueba('se busca con el texto normalizado, pero se guarda cómo se escribía (con acentos) para mostrarlo', async () => {
  const c = await columnaDe('Respuestas filtro uno', 'Corona (Priorización marcas)');
  const { rows } = await pg.query<{ pieza: string; etiqueta: string; filas: number }>(`select pieza, etiqueta, filas from busqueda_piezas where columna = $1::uuid order by filas desc`, [c.id]);
  assert.deepEqual(rows.map((r) => [r.pieza, r.etiqueta, r.filas]), [['es mi top / favorita', 'es mi top / favorita', 20], ['la consumo a veces', 'la consumo a veces', 14], ['la deje de consumir hace 6 meses o mas', 'la dejé de consumir hace 6 meses o más', 4]]);
  const r = await buscarEnCatalogo(pool as any, 'corona');
  assert.equal(r.grupos.find((g) => g.donde === 'columna')!.valores.find((v) => v.valor === 'la deje de consumir hace 6 meses o mas')!.etiqueta, 'la dejé de consumir hace 6 meses o más');
});

await prueba('nada personal llega al catálogo: ni las columnas de nombre, teléfono, dirección, aviso ni las borradas, ni sus respuestas', async () => {
  const nombres = (await pg.query<{ nombre: string }>(`select nombre from busqueda_columnas`)).rows.map((r) => r.nombre);
  for (const prohibido of ['Teléfono', 'Nombre completo', 'Dirección', 'Aviso de privacidad', 'Pregunta vieja de Levité', 'NR', 'Por favor escribe tu dirección']) assert.ok(!nombres.includes(prohibido), prohibido);
  const { rows } = await pg.query<{ pieza: string }>(`select pieza from busqueda_piezas`);
  assert.ok(rows.every((r) => !/\d{7,}|apellido|calle \d|recluta|@/.test(r.pieza)), 'ninguna respuesta parece un teléfono, un correo, un nombre o una dirección');
  // Las columnas de nombre inocente sí están (son preguntas), pero sin sus respuestas personales; las demás respuestas de «Ocupación» sí se guardan.
  const ocup = await columnaDe('Respuestas filtro uno', 'Ocupación');
  assert.deepEqual([...(await piezasDe(ocup.id))].map(([k, v]) => [k, v.filas]).sort(), [['empleado', 14], ['estudiante', 20]], 'el correo repetido en seis filas no se guarda');
  const monday = await columnaDe('Respuestas filtro uno', 'Tablero Monday');
  assert.equal((await piezasDe(monday.id)).size, 0, 'un identificador de once dígitos no se guarda');
});

await prueba('buscar «Levité» (con acento y mayúsculas): la matriz de marcas de los dos tableros es UN grupo con las respuestas sumadas, y la otra forma de preguntar es otro grupo', async () => {
  for (const termino of ['Levité', 'LEVITE', ' levite ']) {
    const r = await buscarEnCatalogo(pool as any, termino);
    assert.equal(r.termino, 'levite');
    const matriz = r.grupos.find((g) => g.clave === '«…» (priorizacion marcas)')!;
    assert.deepEqual([matriz.donde, matriz.tableros, matriz.filas], ['columna', 2, 55]);
    assert.deepEqual(matriz.valores.find((v) => v.valor === 'no me gusta / no la compro'), { valor: 'no me gusta / no la compro', etiqueta: 'no me gusta / no la compro', filas: 16, tableros: 2 });
    assert.deepEqual(matriz.items.map((i) => [i.proyecto, i.cliente, i.respondieron]), [['PRY-UNO', 'Cliente Uno', 40], ['PRY-DOS', 'Cliente Dos', 15]]);
    const otra = r.grupos.find((g) => g.clave === '¿cuando fue la ultima vez que compraste «…»?')!;
    assert.deepEqual([otra.donde, otra.tableros, otra.filas], ['columna', 1, 15]);
    assert.equal(r.grupos.length, 2, 'no aparece el tablero de calendario, ni el vacío, ni el roto');
  }
});

await prueba('buscar «corona»: la matriz de Corona, y el ranking donde Corona está dentro de las listas (con cuántas veces fue la primera)', async () => {
  const r = await buscarEnCatalogo(pool as any, 'corona');
  const columna = r.grupos.find((g) => g.donde === 'columna')!;
  assert.deepEqual([columna.ejemplo, columna.filas, columna.valores[0].valor, columna.valores[0].filas], ['Corona (Priorización marcas)', 40, 'es mi top / favorita', 20]);
  const lista = r.grupos.find((g) => g.donde === 'respuesta')!;
  assert.equal(lista.clave, 'ranking marcas de cerveza');
  const esperadoFilas = Array.from({ length: 40 }, (_, i) => listaDe(i)).filter((l) => l.includes('Corona')).length;
  const esperadoPrimero = Array.from({ length: 40 }, (_, i) => listaDe(i)).filter((l) => l[0] === 'Corona').length;
  assert.deepEqual([lista.items[0].valores[0].valor, lista.items[0].valores[0].filas, lista.items[0].valores[0].primero], ['corona', esperadoFilas, esperadoPrimero]);
});

await prueba('buscar algo que no está, o un término de una sola letra, no encuentra nada; y los % y _ no valen como comodín', async () => {
  assert.deepEqual((await buscarEnCatalogo(pool as any, 'zzzz')).grupos, []);
  assert.deepEqual((await buscarEnCatalogo(pool as any, 'a')).grupos, []);
  assert.deepEqual((await buscarEnCatalogo(pool as any, '%%')).grupos, []);
  assert.deepEqual((await buscarEnCatalogo(pool as any, 'l_vite')).grupos, []);
});

await prueba('el endpoint de buscar responde con el formato esperado, y el estado cuenta tableros, preguntas y respuestas', async () => {
  const r = (await buscarGente.run({ termino: 'levité' }, ctx())) as any;
  assert.equal(r.grupos.length, 2);
  assert.equal(r.recortado, false);
  const e = (await getCatalogoBusqueda.run({}, ctx())) as any;
  assert.equal(e.existe, true);
  assert.equal(e.tableros, 2);
  assert.equal(e.preguntas, 8, 'T1: 6 preguntas (matriz de Levité, matriz de Corona, ranking, «último mes», «Ocupación» y «Tablero Monday»); T2: 2 («Levité» y «última vez»); no entran las personales, la de reclutadores, la de «Aviso» ni la borrada');
  assert.equal(e.respuestas, 21, 'T1: 4 de Levité, 3 de Corona (la que dio 2 filas no se guarda), 6 marcas del ranking, 3 de «último mes» y 2 de «Ocupación» (sin el correo); T2: 2 de Levité y 1 de «última vez»');
  assert.ok(e.actualizado);
});

await prueba('actualizar otra vez sin cambios no lee nada; si cambia una fila de un tablero, lee solo ese; con «forzar» los lee todos', async () => {
  const sinCambios = await actualizarCatalogo({ consulta: pool as any });
  assert.deepEqual([sinCambios.leidos, sinCambios.sinCambios], [0, 2]);
  assert.deepEqual(sinCambios.fallidos.map((f) => f.tablero), ['Tablero con datos rotos'], 'el roto sigue fallando, y se vuelve a intentar porque nunca se guardó');
  await pg.query(`update recruitment_rows set cell_data = cell_data where board_id = $1 and id = (select id from recruitment_rows where board_id = $1 limit 1)`, [T2]);
  const uno = await actualizarCatalogo({ consulta: pool as any });
  assert.equal(uno.leidos, 1);
  const todos = await actualizarCatalogo({ consulta: pool as any, forzar: true });
  assert.equal(todos.leidos, 2);
});

await prueba('un tablero que se borra sale del catálogo; y uno que cambia de respuestas se actualiza', async () => {
  // Cambian las respuestas del tablero dos: 9 filas más con «Es mi top».
  for (let i = 0; i < 9; i++) await nuevaFila(T2, 'PRY-DOS', 'Respuestas filtro dos', { [col2.levite]: 'Es mi top / favorita', [col2.ultima]: 'Hace menos de un mes' });
  const a = await actualizarCatalogo({ consulta: pool as any });
  assert.equal(a.leidos, 1);
  const c = await columnaDe('Respuestas filtro dos', 'Levité (Priorización marcas)');
  assert.equal((await piezasDe(c.id)).get('es mi top / favorita')!.filas, 11);
  await pg.query(`update boards set deleted_at = now() where id = $1::uuid`, [T1]);
  const b = await actualizarCatalogo({ consulta: pool as any });
  assert.equal(b.quitados, 1);
  const { rows } = await pg.query<{ n: number }>(`select count(*)::int n from busqueda_columnas c join busqueda_tableros t on t.tablero_id = c.tablero_id where t.tablero = 'Respuestas filtro uno'`);
  assert.equal(rows[0].n, 0);
  assert.equal((await pg.query<{ n: number }>(`select count(*)::int n from busqueda_piezas p where not exists (select 1 from busqueda_columnas c where c.id = p.columna)`)).rows[0].n, 0, 'no quedan respuestas sueltas');
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
