// Pruebas del módulo «Indicadores» (Reclutamiento): las sumas por periodo y las metas (src/lib/indicadores), el conteo proyecto por proyecto
// (src/serverUtils/indicadores/reclutamiento.ts) sobre casos inventados donde se conoce cada número, y los endpoints de punta a punta
// contra una base en memoria (PGlite) con el esquema real: acceso solo para Sergio, guardar el cálculo y las metas, y qué pasa si
// todavía no existen las tablas. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-indicadores-reclutamiento.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { buildIdentityClusters, type IdentityRow } from '../../src/lib/duplicateIdentity';
import {
  OPCIONES_GRAFICA, VECES, claveVeces, enPeriodo, estadoMeta, etiquetaVeces, fraseIndicador, leerMeta, porTrimestre, restarMeses, resumir, valorDe,
  valorPrimeraVez, valorVeces, type DatosReclutamiento, type PorVeces, type ProyectoReclutamiento,
} from '../../src/lib/indicadores/reclutamiento';
import { calcularReclutamiento } from '../../src/serverUtils/indicadores/reclutamiento';
import getIndicadoresReclutamiento from '../../src/api/getIndicadoresReclutamiento';
import calcularIndicadoresReclutamiento from '../../src/api/calcularIndicadoresReclutamiento';
import saveIndicadorMeta from '../../src/api/saveIndicadorMeta';

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

const CERO: PorVeces = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
/** Un conteo por veces con solo los tramos que se nombran. */
const por = (p: Partial<PorVeces>): PorVeces => ({ ...CERO, ...p });
const suma = (a: PorVeces) => VECES.reduce((s, v) => s + a[v], 0);

// `previas` (el acumulado de 2 o más, 3 o más…) ya no se muestra: se sigue guardando para que el cálculo lo lea también la versión anterior de la pantalla.
const proyecto = (p: Partial<ProyectoReclutamiento> & { codigo: string; fecha: string }): ProyectoReclutamiento => ({
  inferida: false, participaron: 0, noElegibles: 0, porMismoCliente: 0, marcadosTrabajados: 0, noElegiblesPorVeces: { ...CERO }, elegiblesPorVeces: { ...CERO },
  previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0, ...p,
});

// ── periodos ─────────────────────────────────────────────────────────────────
await prueba('restarMeses: respeta el fin de mes y cruza de año', () => {
  assert.equal(restarMeses('2026-10-17', 12), '2025-10-17');
  assert.equal(restarMeses('2026-10-17', 6), '2026-04-17');
  assert.equal(restarMeses('2026-03-31', 1), '2026-02-28');
  assert.equal(restarMeses('2026-01-15', 2), '2025-11-15');
  assert.equal(restarMeses('2024-03-31', 1), '2024-02-29');
});

// Cada proyecto con sus no elegibles y elegibles ya repartidos por número de veces (los tramos suman su grupo):
//  A: 4 no elegibles {1: 2, 2: 1, 3: 1} y, de sus 16 elegibles, 4 ya habían participado {1: 3, 2: 1}  → 12 de primera vez
//  B: 3 no elegibles {1: 1, 2: 1, 5: 1} y, de sus 27 elegibles, 7 ya habían participado {1: 4, 2: 2, 3: 1} → 20 de primera vez
//  C: 2 no elegibles {1: 2} y, de sus 48 elegibles, 6 ya habían participado {1: 5, 2: 1} → 42 de primera vez
const lista = [
  proyecto({ codigo: 'VIEJO', fecha: '2024-02-01', participaron: 10, noElegibles: 5, marcadosTrabajados: 8, noElegiblesPorVeces: por({ 1: 5 }) }),
  proyecto({ codigo: 'A', fecha: '2025-10-17', participaron: 20, noElegibles: 4, marcadosTrabajados: 10, noElegiblesPorVeces: por({ 1: 2, 2: 1, 3: 1 }), elegiblesPorVeces: por({ 1: 3, 2: 1 }), duplicados: 2 }),
  proyecto({ codigo: 'B', fecha: '2026-04-16', participaron: 30, noElegibles: 3, marcadosTrabajados: 6, noElegiblesPorVeces: por({ 1: 1, 2: 1, 5: 1 }), elegiblesPorVeces: por({ 1: 4, 2: 2, 3: 1 }), duplicados: 6 }),
  proyecto({ codigo: 'C', fecha: '2026-09-30', participaron: 50, noElegibles: 2, marcadosTrabajados: 2, noElegiblesPorVeces: por({ 1: 2 }), elegiblesPorVeces: por({ 1: 5, 2: 1 }), duplicados: 7 }),
  proyecto({ codigo: 'FUTURO', fecha: '2026-12-01', participaron: 99, noElegibles: 99, marcadosTrabajados: 99, noElegiblesPorVeces: por({ 5: 99 }) }),
];
const HOY = '2026-10-17';
await prueba('enPeriodo: incluye el día de corte, deja fuera lo que aún no empieza y «todo» trae todo lo ya empezado', () => {
  const codigos = (p: Parameters<typeof enPeriodo>[1]) => enPeriodo(lista, p, HOY).map((x) => x.codigo);
  assert.deepEqual(codigos('12m'), ['A', 'B', 'C']);
  assert.deepEqual(codigos('6m'), ['C']);
  assert.deepEqual(codigos('anio'), ['B', 'C']);
  assert.deepEqual(codigos('todo'), ['VIEJO', 'A', 'B', 'C']);
});

// ── resumen y metas ──────────────────────────────────────────────────────────
await prueba('resumir: suma los proyectos y saca cada porcentaje de su propio total', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY));
  assert.equal(r.proyectos, 3);
  assert.equal(r.participaron, 100);
  assert.deepEqual([r.noElegibles, r.pctNoElegibles], [9, 9]);
  // Con aviso y seguimiento: 18 personas; 9 de ellas entraron (las no elegibles) y 9 se frenaron.
  assert.deepEqual([r.avisosTrabajados, r.avisosRespetados], [18, 9]);
  assert.equal(r.pctAvisosRespetados, 50);
  assert.deepEqual([r.duplicados, r.pctDuplicados], [15, 15]);
});
await prueba('resumir: los tramos de no elegibles suman su grupo, y en los elegibles los de primera vez salen de restar', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY));
  assert.deepEqual(r.noElegiblesPorVeces, { 1: 5, 2: 2, 3: 1, 4: 0, 5: 1 });
  assert.equal(suma(r.noElegiblesPorVeces), r.noElegibles);
  assert.equal(r.elegibles, 91);
  assert.deepEqual(r.elegiblesPorVeces, { 1: 12, 2: 4, 3: 1, 4: 0, 5: 0 });
  assert.equal(r.primeraVez, 74); // 12 + 20 + 42
  assert.equal(r.primeraVez + suma(r.elegiblesPorVeces), r.elegibles);
});
await prueba('resumir: quien trae 5 o más participaciones está en un solo tramo, no en varios', () => {
  const r = resumir([proyecto({ codigo: 'X', fecha: '2026-01-01', participaron: 10, noElegibles: 4, noElegiblesPorVeces: por({ 5: 4 }), elegiblesPorVeces: por({ 5: 6 }) })]);
  assert.deepEqual(r.noElegiblesPorVeces, por({ 5: 4 }));
  assert.deepEqual(r.elegiblesPorVeces, por({ 5: 6 }));
  assert.equal(r.primeraVez, 0);
});
await prueba('resumir: sin proyectos no hay porcentaje (no se inventa un 0 %)', () => {
  const r = resumir([]);
  assert.deepEqual([r.participaron, r.pctNoElegibles, r.pctAvisosRespetados, r.pctDuplicados], [0, null, null, null]);
  assert.deepEqual(valorVeces(r, 'noElegibles', 3), { pct: null, parte: 0, total: 0 });
  assert.deepEqual(valorVeces(r, 'elegibles', 1), { pct: null, parte: 0, total: 0 });
  assert.deepEqual(valorPrimeraVez(r), { pct: null, parte: 0, total: 0 });
});
await prueba('resumir: un proyecto sin conteos por veces (cálculo viejo) cuenta como ceros y todos sus elegibles son de primera vez', () => {
  const viejo = { ...proyecto({ codigo: 'V', fecha: '2026-01-01', participaron: 10, noElegibles: 2 }), noElegiblesPorVeces: undefined, elegiblesPorVeces: undefined } as unknown as ProyectoReclutamiento;
  const r = resumir([viejo]);
  assert.deepEqual([r.noElegiblesPorVeces, r.elegiblesPorVeces, r.primeraVez], [CERO, CERO, 8]);
});
await prueba('valorDe: dice de qué total sale cada indicador', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY));
  assert.deepEqual(valorDe(r, 'noElegibles'), { pct: 9, parte: 9, total: 100, de: 'personas que entraron' });
  assert.deepEqual(valorDe(r, 'avisosRespetados'), { pct: 50, parte: 9, total: 18, de: 'personas con aviso y con seguimiento' });
  assert.equal(valorDe(r, 'duplicados').parte, 15);
});
await prueba('valorVeces: cada tramo es el porcentaje de SU grupo, no de todos los que entraron', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY));
  assert.deepEqual(valorVeces(r, 'noElegibles', 1), { pct: (100 * 5) / 9, parte: 5, total: 9 });
  assert.deepEqual(valorVeces(r, 'noElegibles', 5), { pct: (100 * 1) / 9, parte: 1, total: 9 });
  assert.deepEqual(valorVeces(r, 'elegibles', 1), { pct: (100 * 12) / 91, parte: 12, total: 91 });
  assert.deepEqual(valorVeces(r, 'elegibles', 4), { pct: 0, parte: 0, total: 91 });
  assert.deepEqual(valorPrimeraVez(r), { pct: (100 * 74) / 91, parte: 74, total: 91 });
});
await prueba('valorVeces y valorPrimeraVez: los porcentajes de cada grupo suman 100', () => {
  const r = resumir(enPeriodo(lista, '12m', HOY));
  const noElegibles = VECES.reduce((s, v) => s + valorVeces(r, 'noElegibles', v).pct!, 0);
  const elegibles = VECES.reduce((s, v) => s + valorVeces(r, 'elegibles', v).pct!, 0) + valorPrimeraVez(r).pct!;
  assert.ok(Math.abs(noElegibles - 100) < 1e-9, String(noElegibles));
  assert.ok(Math.abs(elegibles - 100) < 1e-9, String(elegibles));
});
await prueba('valorVeces: si el grupo no tiene personas el porcentaje es «sin dato» (no 0 %), y si todos son de primera vez, 100 %', () => {
  const r = resumir([proyecto({ codigo: 'L', fecha: '2026-01-01', participaron: 12 })]);
  assert.deepEqual(valorVeces(r, 'noElegibles', 2), { pct: null, parte: 0, total: 0 });
  assert.deepEqual(valorPrimeraVez(r), { pct: 100, parte: 12, total: 12 });
  assert.deepEqual(valorVeces(r, 'elegibles', 2), { pct: 0, parte: 0, total: 12 });
});
await prueba('porTrimestre: agrupa por trimestre de inicio, en orden, con la parte, el total y el porcentaje', () => {
  const t = porTrimestre(lista.filter((p) => p.codigo !== 'FUTURO'), 'noElegibles');
  assert.deepEqual(t.map((x) => x.trimestre), ['2024-T1', '2025-T4', '2026-T2', '2026-T3']);
  assert.deepEqual(t.find((x) => x.trimestre === '2026-T2'), { trimestre: '2026-T2', parte: 3, total: 30, pct: 10 });
  assert.equal(porTrimestre([], 'noElegibles').length, 0);
});
await prueba('porTrimestre: sirve para cualquier indicador, con su propio total', () => {
  const sin = lista.filter((p) => p.codigo !== 'FUTURO');
  assert.deepEqual(porTrimestre(sin, 'avisosRespetados').find((x) => x.trimestre === '2026-T2'), { trimestre: '2026-T2', parte: 3, total: 6, pct: 50 });
  assert.deepEqual(porTrimestre(sin, 'duplicados').find((x) => x.trimestre === '2026-T3'), { trimestre: '2026-T3', parte: 7, total: 50, pct: 14 });
});
await prueba('porTrimestre: también un tramo de cada grupo, contra el total de su grupo', () => {
  const sin = lista.filter((p) => p.codigo !== 'FUTURO');
  const de = (clave: Parameters<typeof porTrimestre>[1], trimestre: string) => porTrimestre(sin, clave).find((x) => x.trimestre === trimestre);
  // A (2025-T4): de 4 no elegibles, 1 traía 2 veces; de 16 elegibles, 3 traían 1 vez.
  assert.deepEqual(de('noElegibles_2', '2025-T4'), { trimestre: '2025-T4', parte: 1, total: 4, pct: 25 });
  assert.deepEqual(de('elegibles_1', '2025-T4'), { trimestre: '2025-T4', parte: 3, total: 16, pct: 18.75 });
  // B (2026-T2): de 3 no elegibles, 1 traía 5 o más.
  assert.deepEqual(de('noElegibles_5', '2026-T2'), { trimestre: '2026-T2', parte: 1, total: 3, pct: (100 * 1) / 3 });
  // Un trimestre sin no elegibles no tiene porcentaje (no es 0 %).
  assert.deepEqual(porTrimestre([proyecto({ codigo: 'L', fecha: '2026-01-01', participaron: 12 })], 'noElegibles_1'), [{ trimestre: '2026-T1', parte: 0, total: 0, pct: null }]);
});
await prueba('fraseIndicador: cada frase dice con números qué quiere decir el porcentaje', () => {
  assert.equal(fraseIndicador('noElegibles', { parte: 384, total: 2686 }), '384 de 2,686 personas que entraron a un grupo ya habían participado con el mismo cliente o en los 6 meses anteriores.');
  assert.equal(fraseIndicador('avisosRespetados', { parte: 104, total: 488 }), 'De 488 personas con aviso a las que el equipo dio seguimiento, 104 se frenaron y 384 terminaron en un grupo.');
  assert.equal(fraseIndicador('duplicados', { parte: 282, total: 2686 }), '282 de 2,686 personas que entraron aparecen en más de una fila de su tablero.');
});
await prueba('estadoMeta: «menos» y «más» es mejor, comparando con un decimal y sin meta no se juzga', () => {
  assert.equal(estadoMeta(4.9, 5, 'menos'), 'enMeta');
  assert.equal(estadoMeta(5.04, 5, 'menos'), 'enMeta'); // se muestra 5.0 %
  assert.equal(estadoMeta(5.06, 5, 'menos'), 'fuera');
  assert.equal(estadoMeta(95, 90, 'mas'), 'enMeta');
  assert.equal(estadoMeta(89.9, 90, 'mas'), 'fuera');
  assert.equal(estadoMeta(10, undefined, 'menos'), 'sinMeta');
  assert.equal(estadoMeta(null, 5, 'menos'), 'sinMeta');
  assert.equal(estadoMeta(0, 0, 'menos'), 'enMeta');
});
await prueba('claveVeces y etiquetaVeces: cada tramo de cada grupo guarda su propia meta', () => {
  assert.deepEqual(VECES.map((v) => claveVeces('noElegibles', v)), ['noElegibles_1', 'noElegibles_2', 'noElegibles_3', 'noElegibles_4', 'noElegibles_5']);
  assert.deepEqual(VECES.map((v) => claveVeces('elegibles', v)), ['elegibles_1', 'elegibles_2', 'elegibles_3', 'elegibles_4', 'elegibles_5']);
  assert.deepEqual(VECES.map(etiquetaVeces), ['1 vez', '2 veces', '3 veces', '4 veces', '5 o más veces']);
});
await prueba('OPCIONES_GRAFICA: los 3 indicadores y los 10 tramos, sin repetirse, cada uno con su propia meta', () => {
  assert.equal(OPCIONES_GRAFICA.length, 13);
  assert.equal(new Set(OPCIONES_GRAFICA.map((o) => o.clave)).size, 13);
  for (const o of OPCIONES_GRAFICA) assert.equal(o.meta, o.clave);
  // En los tramos lo bueno es que baje: son gente que no debía entrar o que ya venía de otros proyectos.
  assert.ok(OPCIONES_GRAFICA.filter((o) => o.clave.includes('_')).every((o) => o.mejor === 'menos'));
});

await prueba('leerMeta: acepta punto o coma, vacío quita la meta y lo demás no vale', () => {
  assert.equal(leerMeta('5'), 5);
  assert.equal(leerMeta(' 5,5 '), 5.5);
  assert.equal(leerMeta('0'), 0);
  assert.equal(leerMeta('100'), 100);
  assert.equal(leerMeta(''), null);
  assert.equal(leerMeta('   '), null);
  for (const mala of ['abc', '101', '-1', '5%', '1e3', 'NaN', 'Infinity']) assert.equal(leerMeta(mala), undefined, mala);
});

// ── el conteo, con un caso inventado ─────────────────────────────────────────
// Personas (cada una con el mismo correo, nombre y teléfono en todas sus filas, para que sean una sola identidad):
//  Ana: entró a ALFA, BETA (mismo cliente que ALFA) y GAMA (3 meses después de BETA)     → no elegible en BETA (1 vez) y en GAMA (2 veces)
//  Beto: ALFA y, un año después, DELTA                                                    → su participación en ALFA ya es vieja: elegible que ya había participado 1 vez
//  Carla: solo registrada en ALFA (no participó) y entró a BETA                           → elegible de primera vez
//  Diego: dos filas idénticas en el mismo tablero de BETA                                 → duplicado
//  Elena: entró a ALFA, sin más                                                           → entrante normal
//  Gina: entró a ALFA; en GAMA quedó «Rechazado» pero en un grupo                         → marcada no elegible en GAMA y NO entró (aviso respetado)
//  Hugo: entró a SINFECHA, un proyecto sin ninguna fecha                                  → no se puede contar por proyecto
//  Iris, Julia y Karla: entraron a ALFA y en GAMA traen aviso (participaron en ALFA hace menos de 6 meses) sin entrar a un grupo:
//    Iris se quedó en «Pendiente» y Karla sin estatus (nadie las tocó: no cuentan como seguimiento); Julia quedó «Contactado» (sí cuenta)
const PROYECTOS = [
  { codigo: 'ALFA', cliente: 'Cliente Uno', inicio: '2025-01-10' },
  { codigo: 'BETA', cliente: 'Cliente Uno', inicio: '2025-05-10' },
  { codigo: 'GAMA', cliente: 'Cliente Dos', inicio: '2025-06-20' },
  { codigo: 'DELTA', cliente: 'Cliente Tres', inicio: '2026-01-15' },
  { codigo: 'SINFECHA', cliente: 'Cliente Cuatro', inicio: null },
];
const PERSONAS: Record<string, { nombre: string; email: string; tel: string }> = {
  ana: { nombre: 'Ana Prueba Uno', email: 'ana@ejemplo.test', tel: '5500000001' },
  beto: { nombre: 'Beto Prueba Dos', email: 'beto@ejemplo.test', tel: '5500000002' },
  carla: { nombre: 'Carla Prueba Tres', email: 'carla@ejemplo.test', tel: '5500000003' },
  diego: { nombre: 'Diego Prueba Cuatro', email: 'diego@ejemplo.test', tel: '5500000004' },
  elena: { nombre: 'Elena Prueba Cinco', email: 'elena@ejemplo.test', tel: '5500000005' },
  gina: { nombre: 'Gina Prueba Siete', email: 'gina@ejemplo.test', tel: '5500000007' },
  hugo: { nombre: 'Hugo Prueba Ocho', email: 'hugo@ejemplo.test', tel: '5500000008' },
  iris: { nombre: 'Iris Prueba Nueve', email: 'iris@ejemplo.test', tel: '5500000009' },
  julia: { nombre: 'Julia Prueba Diez', email: 'julia@ejemplo.test', tel: '5500000010' },
  karla: { nombre: 'Karla Prueba Once', email: 'karla@ejemplo.test', tel: '5500000011' },
};
const FILAS: Array<{ persona: string; proyecto: string; tablero: string; status: string; grupo?: string }> = [
  { persona: 'ana', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió', grupo: 'G1' },
  { persona: 'beto', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'carla', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Contactado' },
  { persona: 'elena', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'gina', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'ana', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió', grupo: 'G1' },
  { persona: 'carla', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'diego', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'diego', proyecto: 'BETA', tablero: 'Tablero B', status: 'Asistió' },
  { persona: 'ana', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Asistió' },
  { persona: 'gina', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Rechazado', grupo: 'G2' },
  { persona: 'beto', proyecto: 'DELTA', tablero: 'Tablero D', status: 'Asistió' },
  { persona: 'hugo', proyecto: 'SINFECHA', tablero: 'Tablero E', status: 'Asistió' },
  { persona: 'iris', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'julia', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'karla', proyecto: 'ALFA', tablero: 'Tablero A', status: 'Asistió' },
  { persona: 'iris', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Pendiente' },
  { persona: 'julia', proyecto: 'GAMA', tablero: 'Tablero C', status: 'Contactado' },
  { persona: 'karla', proyecto: 'GAMA', tablero: 'Tablero C', status: '' },
];

const filasIdentidad: IdentityRow[] = FILAS.map((f, i) => ({
  id: `fila-${i + 1}`, projectCode: f.proyecto, boardName: f.tablero, participantName: PERSONAS[f.persona].nombre,
  email: PERSONAS[f.persona].email, phone: PERSONAS[f.persona].tel, status: f.status, group: f.grupo ?? '',
}));
const identidades = (filas: IdentityRow[]) => {
  const globalClusters = buildIdentityClusters(filas, { mode: 'strict' });
  const rowToGlobalCluster = new Map<string, string>();
  for (const [cid, c] of globalClusters) for (const id of c.rowIds) rowToGlobalCluster.set(id, cid);
  return { globalClusters, rowToGlobalCluster };
};
const { globalClusters, rowToGlobalCluster } = identidades(filasIdentidad);
const projectMap = new Map(PROYECTOS.map((p) => [p.codigo, { client: p.cliente, ...(p.inicio ? { startDate: p.inicio } : {}) }]));

const ESPERADO: DatosReclutamiento = {
  proyectos: [
    proyecto({ codigo: 'ALFA', cliente: 'Cliente Uno', fecha: '2025-01-10', participaron: 7 }),
    proyecto({ codigo: 'BETA', cliente: 'Cliente Uno', fecha: '2025-05-10', participaron: 3, noElegibles: 1, porMismoCliente: 1, marcadosTrabajados: 1, noElegiblesPorVeces: por({ 1: 1 }), duplicados: 1 }),
    proyecto({ codigo: 'GAMA', cliente: 'Cliente Dos', fecha: '2025-06-20', participaron: 1, noElegibles: 1, marcadosTrabajados: 3, noElegiblesPorVeces: por({ 2: 1 }), previas: { 2: 1, 3: 0, 4: 0, 5: 0 } }),
    proyecto({ codigo: 'DELTA', cliente: 'Cliente Tres', fecha: '2026-01-15', participaron: 1, elegiblesPorVeces: por({ 1: 1 }) }),
  ],
  vida: { personas: 10, enAlMenos: { 2: 2, 3: 1, 5: 0, 10: 0 } },
  sinFecha: 1,
};

await prueba('el caso inventado tiene las 10 identidades esperadas (Diego, con dos filas, es una sola)', () => {
  assert.equal(globalClusters.size, 10);
});
await prueba('calcularReclutamiento: cada proyecto sale con los números del caso', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  assert.deepEqual(r.proyectos, ESPERADO.proyectos);
});
await prueba('calcularReclutamiento: Ana sube de tramo (1 vez en BETA, 2 en GAMA), Beto entra como elegible con 1 vez y Carla de primera vez', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  const de = (codigo: string) => r.proyectos.find((p) => p.codigo === codigo)!;
  assert.deepEqual(de('BETA').noElegiblesPorVeces, por({ 1: 1 }));
  assert.deepEqual(de('GAMA').noElegiblesPorVeces, por({ 2: 1 }));
  assert.deepEqual(de('DELTA').elegiblesPorVeces, por({ 1: 1 }));
  // En BETA entraron 3 personas: 1 no elegible (Ana) y 2 elegibles (Carla y Diego), ninguna de ellas con participaciones previas.
  assert.deepEqual([de('BETA').participaron - de('BETA').noElegibles, suma(de('BETA').elegiblesPorVeces)], [2, 0]);
});
await prueba('calcularReclutamiento: en cada proyecto los tramos de no elegibles suman exactamente sus no elegibles, y los de elegibles no pasan de sus elegibles', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  for (const p of r.proyectos) {
    assert.equal(suma(p.noElegiblesPorVeces), p.noElegibles, p.codigo);
    assert.ok(suma(p.elegiblesPorVeces) <= p.participaron - p.noElegibles, p.codigo);
  }
});
await prueba('calcularReclutamiento: personas repetidas de por vida y proyecto sin fecha', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  assert.deepEqual(r.vida, ESPERADO.vida);
  assert.equal(r.sinFecha, ESPERADO.sinFecha);
});
await prueba('calcularReclutamiento: con aviso solo cuentan las que tuvieron seguimiento (Rechazada y Contactado sí; Pendiente y sin estatus no)', () => {
  const r = calcularReclutamiento({ activeRows: filasIdentidad, projectMap, globalClusters, rowToGlobalCluster });
  const gama = r.proyectos.find((p) => p.codigo === 'GAMA')!;
  // Ana (entró), Gina (Rechazada) y Julia (Contactado): 3 con seguimiento; Iris y Karla traen aviso pero nadie las tocó.
  assert.equal(gama.marcadosTrabajados, 3);
  assert.equal(gama.marcadosTrabajados - gama.noElegibles, 2); // las que se frenaron
});
await prueba('calcularReclutamiento: sin filas no truena', () => {
  const vacio = calcularReclutamiento({ activeRows: [], projectMap, globalClusters: new Map(), rowToGlobalCluster: new Map() });
  assert.deepEqual(vacio, { proyectos: [], vida: { personas: 0, enAlMenos: { 2: 0, 3: 0, 5: 0, 10: 0 } }, sinFecha: 0 });
});

// ── los tramos de «veces», de punta a punta de la escala ─────────────────────
// Max participó en seis proyectos de 2023 (uno por mes, cada uno de un cliente distinto) y en uno de 2026. En cada uno de los seis trae aviso
// (las participaciones anteriores son de hace menos de 6 meses) y una participación más que en el anterior; en el de 2026 todo lo suyo ya es viejo,
// así que entra como elegible, con seis participaciones previas = «5 o más».
// Zoe participó en SIN, un proyecto sin fecha, y después en NUEVO: trae aviso pero su única participación previa no tiene fecha, y cuenta como «1 vez».
// Pablo solo participó en NUEVO: elegible de primera vez.
const GENTE: Record<string, { nombre: string; email: string; tel: string }> = {
  max: { nombre: 'Max Oropeza Luna', email: 'max@ejemplo.test', tel: '5500000101' },
  zoe: { nombre: 'Zoe Barrientos Vega', email: 'zoe@ejemplo.test', tel: '5500000102' },
  pablo: { nombre: 'Pablo Quintana Rojas', email: 'pablo@ejemplo.test', tel: '5500000103' },
};
let consecutivo = 0;
const fila = (quien: string, codigo: string): IdentityRow => ({
  id: `tramos-${++consecutivo}`, projectCode: codigo, boardName: `Tablero ${codigo}`, participantName: GENTE[quien].nombre,
  email: GENTE[quien].email, phone: GENTE[quien].tel, status: 'Asistió', group: '',
});
const filasTramos = [...['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'FINAL'].map((c) => fila('max', c)), fila('zoe', 'SIN'), fila('zoe', 'NUEVO'), fila('pablo', 'NUEVO')];
const mapaTramos = new Map<string, { client: string; startDate?: string }>([
  ['T1', { client: 'Cliente T1', startDate: '2023-01-10' }], ['T2', { client: 'Cliente T2', startDate: '2023-02-10' }], ['T3', { client: 'Cliente T3', startDate: '2023-03-10' }],
  ['T4', { client: 'Cliente T4', startDate: '2023-04-10' }], ['T5', { client: 'Cliente T5', startDate: '2023-05-10' }], ['T6', { client: 'Cliente T6', startDate: '2023-06-10' }],
  ['NUEVO', { client: 'Cliente Nuevo', startDate: '2026-03-01' }], ['FINAL', { client: 'Cliente Final', startDate: '2026-06-01' }],
  ['SIN', { client: 'Cliente Sin' }],
]);
const tramos = calcularReclutamiento({ activeRows: filasTramos, projectMap: mapaTramos, ...identidades(filasTramos) });
const deTramos = (codigo: string) => tramos.proyectos.find((p) => p.codigo === codigo)!;

await prueba('tramos: quien recorre los proyectos cae en un solo tramo cada vez (1, 2, 3, 4 y «5 o más»)', () => {
  assert.deepEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((c) => deTramos(c).noElegiblesPorVeces), [CERO, por({ 1: 1 }), por({ 2: 1 }), por({ 3: 1 }), por({ 4: 1 }), por({ 5: 1 })]);
  assert.deepEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6'].map((c) => deTramos(c).noElegibles), [0, 1, 1, 1, 1, 1]);
});
await prueba('tramos: con seis participaciones previas el tope es «5 o más», y si todas son viejas entra como elegible', () => {
  const final = deTramos('FINAL');
  assert.deepEqual([final.participaron, final.noElegibles, final.noElegiblesPorVeces, final.elegiblesPorVeces], [1, 0, CERO, por({ 5: 1 })]);
  assert.deepEqual(final.previas, { 2: 1, 3: 1, 4: 1, 5: 1 });
});
await prueba('tramos: quien trae aviso por un proyecto anterior sin fecha cuenta como «1 vez», y quien entra por primera vez no queda en ningún tramo', () => {
  const nuevo = deTramos('NUEVO');
  // Zoe (aviso por SIN, sin fecha: ninguna participación previa fechada) y Pablo (primera vez).
  assert.deepEqual([nuevo.participaron, nuevo.noElegibles, nuevo.noElegiblesPorVeces, nuevo.elegiblesPorVeces], [2, 1, por({ 1: 1 }), CERO]);
  assert.equal(nuevo.marcadosTrabajados, 1);
  // SIN no se cuenta como proyecto (no tiene fecha) y Zoe en él queda como registro sin fecha.
  assert.equal(tramos.proyectos.some((p) => p.codigo === 'SIN'), false);
  assert.equal(tramos.sinFecha, 1);
});
await prueba('tramos: los proyectos salen en orden de fecha y con la suma de cada grupo cuadrada', () => {
  assert.deepEqual(tramos.proyectos.map((p) => p.codigo), ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'NUEVO', 'FINAL']);
  for (const p of tramos.proyectos) {
    assert.equal(suma(p.noElegiblesPorVeces), p.noElegibles, p.codigo);
    assert.ok(suma(p.elegiblesPorVeces) <= p.participaron - p.noElegibles, p.codigo);
  }
  // Max sumado en todos los periodos: de 7 entradas, 5 como no elegible (T2 a T6), 1 como elegible con 5 o más (FINAL) y 1 de primera vez (T1).
  const r = resumir(tramos.proyectos.filter((p) => p.fecha < '2024-01-01' || p.codigo === 'FINAL'));
  assert.deepEqual([r.noElegiblesPorVeces, r.elegiblesPorVeces, r.primeraVez], [{ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 }, por({ 5: 1 }), 1]);
});

// ── endpoints, de punta a punta contra PGlite ────────────────────────────────
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
(pool as any).query = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};

await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
// Las tablas se crean con el SQL del propio script, no con una copia que se pueda desviar.
const script = fs.readFileSync(new URL('./add-indicadores-tables.ts', import.meta.url), 'utf8');
const ddl = script.match(/pool\.query\(`([\s\S]*?)`\)/)?.[1];
assert.ok(ddl, 'no se encontró el SQL en add-indicadores-tables.ts');

for (const p of PROYECTOS) {
  await pg.query(`insert into projects (project_code, client, start_date) values ($1, $2, $3)`, [p.codigo, p.cliente, p.inicio]);
}
for (const [i, f] of FILAS.entries()) {
  const persona = PERSONAS[f.persona];
  await pg.query(
    `insert into recruitment_rows (row_name, project_code, board_name, participant_name, email, phone, status, "group", row_order) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [persona.nombre, f.proyecto, f.tablero, persona.nombre, persona.email, persona.tel, f.status, f.grupo ?? null, i],
  );
}

// Desde la base, un proyecto sin fecha de inicio toma la de su última actividad real (projectStartFallback) y queda marcado como inferido:
// por eso SINFECHA ya sí se cuenta, con la fecha de hoy (las filas se acaban de insertar), y deja de estar en «sinFecha». Ese «hoy» se lee de la
// misma base: `new Date().toISOString()` es la fecha en UTC, que a ciertas horas de la noche ya es otro día.
const hoyEnLaBase = (await pg.query<{ d: string }>(`select current_date::text as d`)).rows[0].d;
const esperadoDeLaBase = (): DatosReclutamiento => ({
  ...ESPERADO,
  proyectos: [
    ...ESPERADO.proyectos,
    proyecto({ codigo: 'SINFECHA', cliente: 'Cliente Cuatro', fecha: hoyEnLaBase, inferida: true, participaron: 1 }),
  ],
  sinFecha: 0,
});

const sergio = { user: { id: 'u1', email: 'sergio@sapience.com.mx' } };
const otra = { user: { id: 'u2', email: 'alguien@ejemplo.test' } };
const sinSesion = { user: null };
const rechazadoPor = (codigo: string) => (e: unknown) => e instanceof ZiteError && e.code === codigo;
const metasGuardadas = async () => ((await getIndicadoresReclutamiento.run({}, sergio)) as any).metas;

await prueba('sin las tablas: la pantalla abre vacía, y calcular o guardar una meta dicen qué falta', async () => {
  assert.deepEqual(await getIndicadoresReclutamiento.run({}, sergio), { metas: {} });
  await assert.rejects(() => calcularIndicadoresReclutamiento.run({}, sergio), (e: unknown) => e instanceof ZiteError && /add-indicadores-tables/.test(e.message));
  await assert.rejects(() => saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, sergio), (e: unknown) => e instanceof ZiteError && /add-indicadores-tables/.test(e.message));
});

await pg.exec(ddl!);

await prueba('solo Sergio: otra persona y quien no ha entrado reciben «no autorizado» en los tres endpoints', async () => {
  for (const contexto of [otra, sinSesion]) {
    const codigo = contexto.user ? 'FORBIDDEN' : 'UNAUTHORIZED';
    await assert.rejects(() => getIndicadoresReclutamiento.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => calcularIndicadoresReclutamiento.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, contexto), rechazadoPor(codigo));
  }
});
await prueba('antes de calcular no hay datos ni fecha, y las metas empiezan vacías', async () => {
  assert.deepEqual(await getIndicadoresReclutamiento.run({}, sergio), { metas: {} });
});
await prueba('calcular: lee la base, guarda y devuelve lo del caso inventado (el proyecto sin fecha, con su fecha inferida)', async () => {
  const r: any = await calcularIndicadoresReclutamiento.run({}, sergio);
  assert.deepEqual(r.datos, esperadoDeLaBase());
  assert.ok(Date.now() - new Date(r.calculadoEn).getTime() < 60_000, 'fecha de cálculo reciente');
  assert.deepEqual(r.metas, {});
});
await prueba('después de calcular, abrir la pantalla devuelve lo guardado sin volver a calcular', async () => {
  const r: any = await getIndicadoresReclutamiento.run({}, sergio);
  assert.deepEqual(r.datos, esperadoDeLaBase());
  const guardado = (await pg.query<{ calculado_por: string }>(`select calculado_por from indicadores_calculos where area = 'reclutamiento'`)).rows;
  assert.deepEqual(guardado, [{ calculado_por: 'sergio@sapience.com.mx' }]);
});
await prueba('calcular otra vez reemplaza el cálculo (una sola fila por área)', async () => {
  await calcularIndicadoresReclutamiento.run({}, sergio);
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from indicadores_calculos`)).rows[0].n), 1);
});
await prueba('dos cálculos a la vez se juntan en uno solo', async () => {
  const [a, b]: any[] = await Promise.all([calcularIndicadoresReclutamiento.run({}, sergio), calcularIndicadoresReclutamiento.run({}, sergio)]);
  assert.equal(a.calculadoEn, b.calculadoEn);
});
await prueba('metas: la de «avisos respetados» se guarda como cualquier otra', async () => {
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'avisosRespetados', valor: 80 }, sergio);
  assert.equal((await metasGuardadas()).avisosRespetados, 80);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'avisosRespetados', valor: null }, sergio);
});
await prueba('metas: guardar, cambiar y borrar, también las de cada tramo; se ven al abrir la pantalla', async () => {
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 5 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles_3', valor: 2.5 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'elegibles_2', valor: 30 }, sergio);
  assert.deepEqual(await metasGuardadas(), { noElegibles: 5, noElegibles_3: 2.5, elegibles_2: 30 });
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 4 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles_3', valor: null }, sergio);
  assert.deepEqual(await metasGuardadas(), { noElegibles: 4, elegibles_2: 30 });
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: 0 }, sergio);
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'elegibles_2', valor: null }, sergio);
  assert.deepEqual(await metasGuardadas(), { noElegibles: 0 });
  await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: 'noElegibles', valor: null }, sergio);
});
await prueba('metas: todas las claves que la pantalla puede guardar (3 indicadores y 10 tramos) las acepta el servidor', async () => {
  for (const o of OPCIONES_GRAFICA) await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: o.meta, valor: 1 }, sergio);
  assert.deepEqual(Object.keys(await metasGuardadas()).sort(), OPCIONES_GRAFICA.map((o) => o.meta).sort());
  for (const o of OPCIONES_GRAFICA) await saveIndicadorMeta.run({ area: 'reclutamiento', indicador: o.meta, valor: null }, sergio);
  assert.deepEqual(await metasGuardadas(), {});
});
await prueba('metas: un indicador que no existe, un área desconocida o un porcentaje fuera de 0–100 se rechazan', async () => {
  for (const mala of [
    { area: 'reclutamiento', indicador: 'inventado', valor: 5 },
    { area: 'reclutamiento', indicador: 'noElegibles_0', valor: 5 },
    { area: 'reclutamiento', indicador: 'noElegibles_6', valor: 5 },
    { area: 'reclutamiento', indicador: 'elegibles_9', valor: 5 },
    { area: 'reclutamiento', indicador: 'elegibles', valor: 5 }, // el grupo entero no tiene meta: solo sus tramos
    { area: 'reclutamiento', indicador: 'repetidores', valor: 5 }, // lo que se cambió por los dos grupos de tramos
    { area: 'reclutamiento', indicador: 'repetidores_3', valor: 5 },
    { area: 'reclutamiento', indicador: 'detectados', valor: 95 }, // el indicador que se cambió por «avisos respetados»
    { area: 'comercial', indicador: 'noElegibles', valor: 5 },
    { area: 'reclutamiento', indicador: 'noElegibles', valor: 101 },
    { area: 'reclutamiento', indicador: 'noElegibles', valor: -1 },
  ]) await assert.rejects(() => saveIndicadorMeta.run(mala, sergio), rechazadoPor('BAD_REQUEST'));
});

await prueba('un cálculo guardado con una forma anterior (sin «marcadosTrabajados» ni conteos por veces) se sigue leyendo, con ceros, hasta que se actualice', async () => {
  const base = { codigo: 'VIEJO', fecha: '2026-01-01', inferida: false, participaron: 5, noElegibles: 1, porMismoCliente: 0, previas: { 2: 0, 3: 0, 4: 0, 5: 0 }, duplicados: 0 };
  const vida = { personas: 5, enAlMenos: { 2: 0, 3: 0, 5: 0, 10: 0 } };
  const guardar = (proyectos: unknown[]) => pg.query(`update indicadores_calculos set datos = $1::jsonb where area = 'reclutamiento'`, [JSON.stringify({ proyectos, vida, sinFecha: 0 })]);

  // La primera forma: con «marcados» y sin «marcadosTrabajados».
  await guardar([{ ...base, marcados: 9 }]);
  let r: any = await getIndicadoresReclutamiento.run({}, sergio);
  assert.equal(r.datos.proyectos[0].marcadosTrabajados, 0);
  assert.equal(r.datos.proyectos[0].marcados, undefined);
  assert.equal(r.datos.proyectos[0].participaron, 5);
  assert.deepEqual([r.datos.proyectos[0].noElegiblesPorVeces, r.datos.proyectos[0].elegiblesPorVeces], [CERO, CERO]);

  // La de antes de separar elegibles y no elegibles por veces: con «marcadosTrabajados» pero sin los conteos.
  await guardar([{ ...base, marcadosTrabajados: 3 }]);
  r = await getIndicadoresReclutamiento.run({}, sergio);
  assert.equal(r.datos.proyectos[0].marcadosTrabajados, 3);
  assert.deepEqual([r.datos.proyectos[0].noElegiblesPorVeces, r.datos.proyectos[0].elegiblesPorVeces], [CERO, CERO]);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
