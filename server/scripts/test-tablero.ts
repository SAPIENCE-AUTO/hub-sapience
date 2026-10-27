// Pruebas del motor del tablero comercial (src/lib/tablero/): periodos y comparación, medidas, cortes, cruces, acumulado, filtros, rejilla de bloques, vistas guardadas
// y el parecido con las cuentas del dashboard anterior. Todo son funciones puras con deals inventados; no toca la base.
// uso: node server/node_modules/.bin/tsx server/scripts/test-tablero.ts
import assert from 'node:assert/strict';
import { diasEntre, fechaValida, sumarAnios, sumarMeses } from '../../src/lib/tablero/fechas';
import { etiquetaRango, rangoDe, resolverPeriodos } from '../../src/lib/tablero/periodos';
import { ejecutar, resolverConsulta } from '../../src/lib/tablero/motor';
import { DIMENSIONES, MEDIDAS, valoresDe } from '../../src/lib/tablero/campos';
import { cambio, formatear } from '../../src/lib/tablero/formato';
import { graficaCompatible, graficasValidas } from '../../src/lib/tablero/graficas';
import { COLUMNAS, MAX_BLOQUES, MAX_FILAS, choca, compactar, mover, normalizar, posNueva, redimensionar } from '../../src/lib/tablero/rejilla';
import { desdeVistaAnterior, leerTablero, serializarTablero, tableroInicial } from '../../src/lib/tablero/vistas';
import { PALETAS } from '../../src/lib/tablero/paletas';
import { tablaComoTexto } from '../../src/lib/tablero/exportar';
import type { ConsultaBloque, Contexto, Deal, Tablero } from '../../src/lib/tablero/tipos';
import { buildChartData } from '../../src/lib/commercial-dashboard/chartData';
import { calcMetricInCurrency } from '../../src/lib/commercial-dashboard/metrics';
import { DEFAULT_FILTERS } from '../../src/lib/commercial-dashboard/constants';
import { applyFilters } from '../../src/lib/commercial-dashboard/filters';

let n = 0;
let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  n++;
  try {
    fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).stack : (e as Error).message.split('\n')[0]}`);
  }
}

const HOY = '2026-10-23';
const ctx: Contexto = { hoy: HOY, nombreDe: id => ({ u1: 'Ana', u2: 'Luis' } as Record<string, string>)[id] };
const MXN = 'MXN 🇲🇽';
const USD = 'USD 🇺🇸';

let seq = 0;
const d = (o: Partial<Deal>): Deal => ({ id: `d${++seq}`, phase: 'Ganado', currency: MXN, ...o });

// Deals inventados. Ganados 2025: Alfa 100k (feb) + 200k (jun), Beta 50k (jun). Ganados 2026: Alfa 300k (ene), Gama 1000 USD a 18 (mar) = 18k,
// Gama 500 USD sin tipo de cambio (abr) = 10k, Delta 80k (oct 5). Perdidos, cotizaciones abiertas y prospectos aparte.
const deals: Deal[] = [
  d({ client: 'Alfa', clientPrice: 100_000, quotedCost: 60_000, proposalDate: '2025-02-03', approvalDate: '2025-02-10', projectType: 'Cuali', owner: ['u1'] }),
  d({ client: 'Alfa', clientPrice: 200_000, quotedCost: 120_000, proposalDate: '2025-06-01', approvalDate: '2025-06-15', projectType: 'Cuali' }),
  d({ client: 'Beta', clientPrice: 50_000, quotedCost: 30_000, proposalDate: '2025-06-10', approvalDate: '2025-06-20', projectType: 'Cuanti', owner: ['u2'] }),
  d({ client: 'Alfa', clientPrice: 300_000, quotedCost: 150_000, proposalDate: '2025-12-20', approvalDate: '2026-01-12', projectType: 'Cuali' }),
  d({ client: 'Gama', currency: USD, clientPrice: 1000, quotedCost: 400, exchangeRate: 18, proposalDate: '2026-02-20', approvalDate: '2026-03-05', projectType: 'Cuanti' }),
  d({ client: 'Gama', currency: USD, clientPrice: 500, quotedCost: 200, proposalDate: '2026-04-01', approvalDate: '2026-04-09', projectType: 'Cuanti' }),
  d({ client: 'Delta', clientPrice: 80_000, quotedCost: 50_000, proposalDate: '2026-09-28', approvalDate: '2026-10-05' }),
  d({ phase: 'Perdido', client: 'Beta', clientPrice: 70_000, proposalDate: '2025-08-01', fechaPerdida: '2025-08-20' }),
  d({ phase: 'Perdido', client: 'Epsilon', clientPrice: 90_000, proposalDate: '2026-05-04' }),
  d({ phase: 'Cotización enviada', client: 'Alfa', clientPrice: 120_000, proposalDate: '2026-10-01' }),
  d({ phase: 'Negociación', client: 'Delta', clientPrice: 60_000, proposalDate: '2026-09-10' }),
  d({ phase: 'Prospecto', client: 'Zeta' }),
];

const consulta = (c: Partial<ConsultaBloque>): ConsultaBloque => ({ medidas: ['ingresos'], filtros: [], ...c });
const tablero = (t: Partial<Pick<Tablero, 'periodo' | 'comparacion' | 'fecha' | 'filtros'>> = {}) => ({
  periodo: { modo: 'todo' } as Tablero['periodo'],
  comparacion: { modo: 'ninguna' } as Tablero['comparacion'],
  fecha: { campo: 'aprobacion', alterna: true } as Tablero['fecha'],
  filtros: [],
  ...t,
});
const correr = (c: Partial<ConsultaBloque>, t: Partial<Pick<Tablero, 'periodo' | 'comparacion' | 'fecha' | 'filtros'>> = {}, ds: Deal[] = deals) =>
  ejecutar(resolverConsulta(consulta(c), tablero(t)), ds, ctx);
const valores = (r: ReturnType<typeof correr>, k = 0) => r.filas.map(f => f.celdas[0].valores[k]);
const previos = (r: ReturnType<typeof correr>, k = 0) => r.filas.map(f => f.celdas[0].previos?.[k] ?? null);
const etiquetas = (r: ReturnType<typeof correr>) => r.filas.map(f => f.etiqueta);

// ── Fechas y periodos ─────────────────────────────────────────────────────────

prueba('un año atrás desde el 29 de febrero cae en el 28; sumar meses no se sale del mes', () => {
  assert.equal(sumarAnios('2028-02-29', -1), '2027-02-28');
  assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(sumarMeses('2026-03-15', -4), '2025-11-15');
  assert.equal(diasEntre('2026-01-01', '2026-03-01'), 59);
});
prueba('rango de cada tipo de periodo', () => {
  assert.deepEqual(rangoDe({ modo: 'anio', anio: 2026 }, HOY), { inicio: '2026-01-01', fin: '2026-12-31' });
  assert.deepEqual(rangoDe({ modo: 'trimestre', anio: 2026, trimestre: 3 }, HOY), { inicio: '2026-07-01', fin: '2026-09-30' });
  assert.deepEqual(rangoDe({ modo: 'mes', anio: 2028, mes: 2 }, HOY), { inicio: '2028-02-01', fin: '2028-02-29' });
  assert.deepEqual(rangoDe({ modo: 'ultimos', cantidad: 12, unidad: 'meses' }, HOY), { inicio: '2025-10-24', fin: '2026-10-23' });
  assert.deepEqual(rangoDe({ modo: 'ultimos', cantidad: 30, unidad: 'dias' }, HOY), { inicio: '2026-09-24', fin: '2026-10-23' });
  assert.equal(rangoDe({ modo: 'todo' }, HOY), null);
  assert.equal(rangoDe({ modo: 'rango', inicio: '2026-01-01' }, HOY), null);
  assert.deepEqual(rangoDe({ modo: 'rango', inicio: '2026-05-01', fin: '2026-02-01' }, HOY), { inicio: '2026-02-01', fin: '2026-05-01' });
});
prueba('misma fecha del año pasado: el año en curso se corta hoy y se compara con el mismo tramo de 2025', () => {
  const r = resolverPeriodos({ modo: 'anio', anio: 2026 }, { modo: 'mismaFecha' }, HOY);
  assert.deepEqual(r.actual, { inicio: '2026-01-01', fin: '2026-10-23' });
  assert.deepEqual(r.previo, { inicio: '2025-01-01', fin: '2025-10-23' });
  assert.equal(r.etiquetaActual, '1 ene–23 oct 2026');
  assert.equal(r.etiquetaPrevio, '1 ene–23 oct 2025');
});
prueba('año pasado completo: el año en curso contra todo 2025 (lo que hacía el KPI de antes)', () => {
  const r = resolverPeriodos({ modo: 'anio', anio: 2026 }, { modo: 'anioCompleto' }, HOY);
  assert.deepEqual(r.previo, { inicio: '2025-01-01', fin: '2025-12-31' });
  assert.equal(r.etiquetaPrevio, '2025');
  assert.equal(r.etiquetaActual, '2026');
});
prueba('periodo anterior: año, trimestre, mes y rango (de igual largo, justo antes)', () => {
  assert.deepEqual(resolverPeriodos({ modo: 'anio', anio: 2026 }, { modo: 'anterior' }, HOY).previo, { inicio: '2025-01-01', fin: '2025-12-31' });
  assert.deepEqual(resolverPeriodos({ modo: 'trimestre', anio: 2026, trimestre: 1 }, { modo: 'anterior' }, HOY).previo, { inicio: '2025-10-01', fin: '2025-12-31' });
  assert.deepEqual(resolverPeriodos({ modo: 'mes', anio: 2026, mes: 1 }, { modo: 'anterior' }, HOY).previo, { inicio: '2025-12-01', fin: '2025-12-31' });
  assert.deepEqual(resolverPeriodos({ modo: 'rango', inicio: '2026-03-01', fin: '2026-03-10' }, { modo: 'anterior' }, HOY).previo, { inicio: '2026-02-19', fin: '2026-02-28' });
});
prueba('un periodo ya terminado se compara completo con la misma fecha; un mes bisiesto contra uno que no', () => {
  const r = resolverPeriodos({ modo: 'anio', anio: 2025 }, { modo: 'mismaFecha' }, HOY);
  assert.deepEqual(r.actual, { inicio: '2025-01-01', fin: '2025-12-31' });
  assert.deepEqual(r.previo, { inicio: '2024-01-01', fin: '2024-12-31' });
  const b = resolverPeriodos({ modo: 'mes', anio: 2028, mes: 2 }, { modo: 'mismaFecha' }, '2028-02-29');
  assert.deepEqual(b.previo, { inicio: '2027-02-01', fin: '2027-02-28' });
});
prueba('todo el historial no se puede comparar y lo dice; un periodo futuro tampoco', () => {
  const t = resolverPeriodos({ modo: 'todo' }, { modo: 'mismaFecha' }, HOY);
  assert.equal(t.previo, null);
  assert.match(t.aviso ?? '', /periodo/);
  const f = resolverPeriodos({ modo: 'anio', anio: 2027 }, { modo: 'mismaFecha' }, HOY);
  assert.equal(f.previo, null);
  assert.ok(f.aviso);
});
prueba('etiquetas de rango: año, mes, trimestre y tramos', () => {
  assert.equal(etiquetaRango({ inicio: '2026-01-01', fin: '2026-12-31' }), '2026');
  assert.equal(etiquetaRango({ inicio: '2026-10-01', fin: '2026-10-31' }), 'Oct 2026');
  assert.equal(etiquetaRango({ inicio: '2026-07-01', fin: '2026-09-30' }), 'Q3 2026');
  assert.equal(etiquetaRango({ inicio: '2026-10-05', fin: '2026-10-23' }), '5–23 oct 2026');
  assert.equal(etiquetaRango({ inicio: '2025-10-01', fin: '2026-01-23' }), '1 oct 2025–23 ene 2026');
});

// ── Medidas ───────────────────────────────────────────────────────────────────

prueba('ingresos: solo ganados, en pesos; USD con su tipo de cambio o con 20 si falta', () => {
  const r = correr({});
  const esperado = 100_000 + 200_000 + 50_000 + 300_000 + 1000 * 18 + 500 * 20 + 80_000;
  assert.equal(r.total.valores[0], esperado);
  assert.equal(r.filas.length, 1);
});
prueba('deals ganados, todos, perdidos, deal promedio, tasa de cierre y mediana de días de cierre', () => {
  const r = correr({ medidas: ['dealsGanados', 'deals', 'perdidos', 'ticket', 'conversion', 'cicloMediano'] });
  const [g, t, p, tk, cv, ci] = r.total.valores;
  assert.equal(g, 7);
  assert.equal(t, 12);
  assert.equal(p, 2);
  assert.equal(tk, (100_000 + 200_000 + 50_000 + 300_000 + 18_000 + 10_000 + 80_000) / 7);
  // base = cotización enviada (1) + negociación (1) + ganados (7) + perdidos (2) = 11; 7 ganados
  assert.equal(cv, 7 / 11);
  // días propuesta→aprobación: 7, 14, 10, 23, 13, 8, 7 → mediana 10
  assert.equal(ci, 10);
});
prueba('moneda: «solo USD» deja solo esos deals y suma sin convertir', () => {
  const r = correr({ moneda: 'USD' });
  assert.equal(r.total.valores[0], 1500);
  const m = correr({ moneda: 'MXN' });
  assert.equal(m.total.valores[0], 100_000 + 200_000 + 50_000 + 300_000 + 80_000);
});

// ── Cortes ────────────────────────────────────────────────────────────────────

prueba('por cliente: de mayor a menor, sin renglones en cero (Zeta y Epsilon no ganaron nada) y con límite', () => {
  const r = correr({ filas: { campo: 'cliente' } });
  assert.deepEqual(etiquetas(r), ['Alfa', 'Beta', 'Delta', 'Gama'].sort((a, b) => ({ Alfa: 600_000, Beta: 50_000, Delta: 80_000, Gama: 28_000 } as Record<string, number>)[b] - ({ Alfa: 600_000, Beta: 50_000, Delta: 80_000, Gama: 28_000 } as Record<string, number>)[a]));
  assert.deepEqual(valores(r), [600_000, 80_000, 50_000, 28_000]);
  const top2 = correr({ filas: { campo: 'cliente' }, limite: 2 });
  assert.deepEqual(etiquetas(top2), ['Alfa', 'Delta']);
  const asc = correr({ filas: { campo: 'cliente' }, orden: 'valor-asc', limite: 2 });
  assert.deepEqual(etiquetas(asc), ['Gama', 'Beta']);
});
prueba('por fase: en el orden del embudo, aunque tenga pocos deals', () => {
  const r = correr({ medidas: ['deals'], filas: { campo: 'fase' } });
  assert.deepEqual(etiquetas(r), ['Prospecto', 'Cotización enviada', 'Negociación', 'Ganado', 'Perdido']);
  assert.deepEqual(valores(r), [1, 1, 1, 7, 2]);
});
prueba('por responsable: pone el nombre y no el identificador, y «Sin responsable» para el resto', () => {
  const r = correr({ medidas: ['dealsGanados'], filas: { campo: 'responsable' } });
  assert.deepEqual(etiquetas(r).sort(), ['Ana', 'Luis', 'Sin responsable']);
});
prueba('por tipo de proyecto y moneda: normaliza la moneda sin bandera', () => {
  const m = correr({ medidas: ['dealsGanados'], filas: { campo: 'moneda' } });
  assert.deepEqual(etiquetas(m).sort(), ['MXN', 'USD']);
  const t = correr({ filas: { campo: 'tipoProyecto' } });
  // Cuali 600k; sin tipo 80k (Delta); Cuanti 78k (Beta 50k + Gama 18k y 10k)
  assert.deepEqual(etiquetas(t), ['Cuali', 'Sin tipo', 'Cuanti']);
});
prueba('por mes: llena los meses sin datos y pone el año solo si el periodo cruza de año', () => {
  const unAnio = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } }, { periodo: { modo: 'anio', anio: 2026 } });
  assert.equal(unAnio.filas.length, 12);
  assert.deepEqual(etiquetas(unAnio).slice(0, 3), ['Ene', 'Feb', 'Mar']);
  assert.equal(unAnio.filas[0].celdas[0].valores[0], 300_000);
  assert.equal(unAnio.filas[2].celdas[0].valores[0], 18_000);
  assert.equal(unAnio.filas[3].celdas[0].valores[0], 10_000);
  assert.equal(unAnio.filas[9].celdas[0].valores[0], 80_000);
  // noviembre y diciembre todavía no llegan: sin dato, no cero
  assert.equal(unAnio.filas[10].celdas[0].valores[0], null);
  assert.equal(unAnio.filas[11].futuro, true);
  const todo = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } });
  assert.equal(todo.filas[0].etiqueta, 'Feb 2025');
  assert.equal(todo.filas[todo.filas.length - 1].etiqueta, 'Oct 2026');
  assert.equal(todo.filas.length, 21);
});
prueba('por trimestre y por año', () => {
  const q = correr({ filas: { campo: 'tiempo', granularidad: 'trimestre' } }, { periodo: { modo: 'anio', anio: 2026 } });
  assert.deepEqual(etiquetas(q), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual(valores(q), [318_000, 10_000, 0, null].map((v, i) => (i === 3 ? 80_000 : v)));
  const a = correr({ filas: { campo: 'tiempo', granularidad: 'anio' } });
  assert.deepEqual(etiquetas(a), ['2025', '2026']);
  assert.deepEqual(valores(a), [350_000, 408_000]);
});
prueba('año, trimestre y mes del año como cortes: sirven para comparar años mes contra mes', () => {
  const r = correr({ filas: { campo: 'mesAnio' }, columnas: { campo: 'anio' } });
  assert.deepEqual(r.columnas.map(c => c.etiqueta), ['2025', '2026']);
  const fila = (mes: string) => r.filas.find(f => f.etiqueta === mes)!;
  assert.deepEqual(fila('Jun').celdas.map(c => c.valores[0]), [250_000, 0]);
  assert.deepEqual(fila('Ene').celdas.map(c => c.valores[0]), [0, 300_000]);
  assert.deepEqual(r.filas.map(f => f.etiqueta).slice(0, 4), ['Ene', 'Feb', 'Mar', 'Abr']);
});

// ── Comparación ───────────────────────────────────────────────────────────────

prueba('el KPI compara con la misma fecha del año pasado y con el año pasado completo, a elección', () => {
  const mismaFecha = correr({}, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'mismaFecha' } });
  assert.equal(mismaFecha.total.valores[0], 408_000);
  assert.equal(mismaFecha.total.previos?.[0], 350_000);
  const completo = correr({}, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'anioCompleto' } });
  assert.equal(completo.total.previos?.[0], 350_000);
  // con un deal de 2025 aprobado en noviembre se nota la diferencia entre las dos formas
  const extra = [...deals, d({ client: 'Beta', clientPrice: 1_000_000, proposalDate: '2025-11-01', approvalDate: '2025-11-20' })];
  const a = correr({}, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'mismaFecha' } }, extra);
  const b = correr({}, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'anioCompleto' } }, extra);
  assert.equal(a.total.previos?.[0], 350_000);
  assert.equal(b.total.previos?.[0], 1_350_000);
  assert.equal(correr({}, { periodo: { modo: 'anio', anio: 2026 } }).total.previos, null);
  const c = cambio(a.total.valores[0], a.total.previos![0]);
  assert.equal(Math.round(c!.pct! * 10) / 10, 16.6);
});
prueba('por mes con comparación: el mes de ahora y el mismo mes del año pasado quedan en la misma fila', () => {
  const r = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } }, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'mismaFecha' } });
  // con la misma fecha de corte los dos lados llegan hasta octubre: 10 meses, sin noviembre ni diciembre
  assert.equal(r.filas.length, 10);
  assert.deepEqual(previos(r).slice(0, 7), [0, 100_000, 0, 0, 0, 250_000, 0]);
  assert.equal(r.filas[1].celdas[0].valores[0], 0);
  assert.equal(r.filas.some(f => f.futuro), false);
  // contra el año pasado completo, el eje llega a diciembre y lo de 2026 que todavía no pasa queda sin dato
  const completo = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } }, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'anioCompleto' } });
  assert.equal(completo.filas.length, 12);
  assert.equal(completo.filas[11].celdas[0].valores[0], null);
  assert.equal(completo.filas[11].celdas[0].previos?.[0], 0);
});
prueba('acumulado: la suma corrida de este año se detiene en el mes actual y la del año pasado sigue', () => {
  const r = correr({ filas: { campo: 'tiempo', granularidad: 'mes' }, acumulado: true }, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'anioCompleto' } });
  const act = valores(r);
  assert.deepEqual(act.slice(0, 4), [300_000, 300_000, 318_000, 328_000]);
  assert.equal(act[9], 408_000);
  assert.equal(act[10], null);
  assert.equal(act[11], null);
  const prev = previos(r);
  assert.equal(prev[1], 100_000);
  assert.equal(prev[5], 350_000);
  assert.equal(prev[11], 350_000);
});
prueba('por cliente con comparación: aparecen también los clientes que solo vendieron el año pasado', () => {
  const r = correr({ filas: { campo: 'cliente' } }, { periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'mismaFecha' } });
  assert.deepEqual(r.filas.map(f => [f.etiqueta, f.celdas[0].valores[0], f.celdas[0].previos?.[0]]), [
    ['Alfa', 300_000, 300_000], ['Delta', 80_000, 0], ['Gama', 28_000, 0], ['Beta', 0, 50_000],
  ]);
});

// ── Cruces, filtros y fechas ──────────────────────────────────────────────────

prueba('cruce cliente × tipo: una columna por tipo, totales por fila y «Otros» cuando no caben', () => {
  const r = correr({ filas: { campo: 'cliente' }, columnas: { campo: 'tipoProyecto' } });
  assert.equal(r.hayCruce, true);
  assert.deepEqual(r.columnas.map(c => c.etiqueta).sort(), ['Cuali', 'Cuanti', 'Sin tipo']);
  const alfa = r.filas.find(f => f.etiqueta === 'Alfa')!;
  assert.equal(alfa.total.valores[0], 600_000);
  assert.equal(alfa.celdas[r.columnas.findIndex(c => c.etiqueta === 'Cuali')].valores[0], 600_000);
  const poco = correr({ filas: { campo: 'cliente' }, columnas: { campo: 'tipoProyecto' }, limiteColumnas: 2 });
  assert.equal(poco.columnas.length, 2);
  assert.equal(poco.columnas[1].esOtros, true);
  const suma = poco.filas.map(f => f.celdas.reduce((s, c) => s + (c.valores[0] ?? 0), 0));
  assert.deepEqual(suma, poco.filas.map(f => f.total.valores[0]));
});
prueba('cruzar un corte consigo mismo se ignora', () => {
  const r = correr({ filas: { campo: 'cliente' }, columnas: { campo: 'cliente' } });
  assert.equal(r.hayCruce, false);
});
prueba('filtros: dejar solo, dejar fuera, y un filtro sin valores no filtra', () => {
  assert.equal(correr({ filtros: [{ campo: 'cliente', valores: ['Alfa'] }] }).total.valores[0], 600_000);
  assert.equal(correr({ filtros: [{ campo: 'cliente', valores: ['Alfa'], excluir: true }] }).total.valores[0], 50_000 + 18_000 + 10_000 + 80_000);
  assert.equal(correr({ filtros: [{ campo: 'cliente', valores: [] }] }).total.valores[0], 758_000);
  // los filtros del tablero y los del bloque se suman
  const r = ejecutar(resolverConsulta(consulta({ filtros: [{ campo: 'tipoProyecto', valores: ['Cuali'] }] }), tablero({ filtros: [{ campo: 'cliente', valores: ['Alfa', 'Beta'] }] })), deals, ctx);
  assert.equal(r.total.valores[0], 600_000);
});
prueba('fecha de referencia: por propuesta cambia el año de un deal; si falta la fecha usa la otra solo si se pidió', () => {
  const porPropuesta = correr({}, { periodo: { modo: 'anio', anio: 2026 }, fecha: { campo: 'propuesta', alterna: true } });
  // el deal de Alfa propuesto en diciembre de 2025 y aprobado en enero de 2026 cuenta para 2025
  assert.equal(porPropuesta.total.valores[0], 408_000 - 300_000);
  const sinFecha = [d({ client: 'Eta', clientPrice: 999, proposalDate: '2026-05-05' })];
  assert.equal(correr({}, { periodo: { modo: 'anio', anio: 2026 }, fecha: { campo: 'aprobacion', alterna: true } }, sinFecha).total.valores[0], 999);
  assert.equal(correr({}, { periodo: { modo: 'anio', anio: 2026 }, fecha: { campo: 'aprobacion', alterna: false } }, sinFecha).total.valores[0], 0);
});
prueba('lo que se pide con un bloque heredado: el periodo del bloque manda sobre el del tablero', () => {
  const c = resolverConsulta(consulta({ periodo: { modo: 'anio', anio: 2025 }, comparacion: { modo: 'ninguna' } }), tablero({ periodo: { modo: 'anio', anio: 2026 }, comparacion: { modo: 'mismaFecha' } }));
  assert.equal(ejecutar(c, deals, ctx).total.valores[0], 350_000);
});
prueba('valores para armar un filtro: con cuántos deals y en orden de fases', () => {
  const v = valoresDe('fase', deals, ctx);
  assert.deepEqual(v.map(x => x.valor), ['Prospecto', 'Cotización enviada', 'Negociación', 'Ganado', 'Perdido']);
  assert.equal(v.find(x => x.valor === 'Ganado')?.n, 7);
});

// ── Parecido con el dashboard anterior ────────────────────────────────────────

prueba('mismas cuentas que el dashboard anterior en cada medida y corte (por aprobación y por propuesta)', () => {
  const MEDIDA_ANTERIOR: Record<string, string> = { ingresos: 'revenue', deals: 'dealCount', ticket: 'avgTicket', margen: 'margin', costo: 'cost', conversion: 'conversionRate' };
  const CORTE: [string, string][] = [['client', 'cliente'], ['projectType', 'tipoProyecto'], ['phase', 'fase']];
  for (const ref of ['approvalDate', 'proposalDate'] as const) {
    for (const [medida, vieja] of Object.entries(MEDIDA_ANTERIOR)) {
      for (const [corteViejo, corteNuevo] of CORTE) {
        const anterior = buildChartData(deals as never[], { id: 'x', name: 'x', metric: vieja, groupBy: corteViejo, chartType: 'bar', size: 'half', filters: null, displayOptions: {} } as never, ref)
          .filter(p => !p.label.startsWith('Sin ') || p.value !== 0)
          .filter(p => p.value !== 0);
        const nuevo = correr({ medidas: [medida], filas: { campo: corteNuevo } }, { fecha: { campo: ref === 'approvalDate' ? 'aprobacion' : 'propuesta', alterna: true } });
        const comoMapa = (xs: { label: string; value: number }[]) => Object.fromEntries(xs.map(x => [x.label.replace(/^Sin tipo$/, 'Sin tipo'), Math.round(x.value * 1e6) / 1e6]));
        const a = comoMapa(anterior);
        const b = comoMapa(nuevo.filas.map(f => ({ label: f.etiqueta, value: f.celdas[0].valores[0] ?? 0 })).filter(x => x.value !== 0));
        assert.deepEqual(b, a, `${medida} por ${corteNuevo} (${ref})`);
      }
    }
  }
});
prueba('mismas cuentas que el dashboard anterior en una serie de tiempo, con los meses vacíos incluidos', () => {
  for (const [g, nuevo] of [['month', 'mes'], ['quarter', 'trimestre'], ['year', 'anio']] as const) {
    const anterior = buildChartData(deals as never[], { id: 'x', name: 'x', metric: 'revenue', groupBy: g, chartType: 'bar', size: 'half', filters: null, displayOptions: {} } as never, 'approvalDate');
    const r = correr({ filas: { campo: 'tiempo', granularidad: nuevo } });
    assert.deepEqual(r.filas.map(f => f.celdas[0].valores[0]), anterior.map(p => p.value), `por ${g}`);
    assert.deepEqual(r.filas.map(f => f.etiqueta), anterior.map(p => p.label), `etiquetas por ${g}`);
  }
});
prueba('el filtro por periodo deja los mismos deals que el anterior, con la regla de la fecha alterna', () => {
  const viejos = applyFilters(deals as never[], { ...DEFAULT_FILTERS, period: { mode: 'year', year: 2026 } }, 'approvalDate').map(x => (x as Deal).id).sort();
  const r = correr({ medidas: ['deals'] }, { periodo: { modo: 'anio', anio: 2026 } });
  assert.deepEqual(r.total.deals.map(x => x.id).sort(), viejos);
  const unico = calcMetricInCurrency(applyFilters(deals as never[], { ...DEFAULT_FILTERS, period: { mode: 'year', year: 2026 } }, 'approvalDate'), 'revenue');
  assert.equal(correr({}, { periodo: { modo: 'anio', anio: 2026 } }).total.valores[0], unico);
});

// ── Formato y gráficas ────────────────────────────────────────────────────────

prueba('formato: dinero compacto y completo, negativos, porcentaje, días y sin dato', () => {
  assert.equal(formatear(32_463_415, 'moneda'), '$32.5M');
  assert.equal(formatear(353_000, 'moneda'), '$353K');
  assert.equal(formatear(950, 'moneda'), '$950');
  assert.equal(formatear(-2_809_858, 'moneda'), '-$2.8M');
  assert.equal(formatear(32_463_415, 'moneda', 'todas', false), '$32,463,415');
  assert.equal(formatear(1500, 'moneda', 'USD'), 'USD $2K');
  assert.equal(formatear(0.8764, 'porcentaje'), '87.6%');
  assert.equal(formatear(10, 'dias'), '10 d');
  assert.equal(formatear(1234, 'numero'), '1,234');
  assert.equal(formatear(null, 'moneda'), '—');
  assert.equal(cambio(95, 100)?.pct, -5);
  assert.equal(cambio(5, 0)?.pct, null);
  assert.equal(cambio(null, 5), null);
});
prueba('qué gráficas valen según cómo se corta, y la gráfica se ajusta si ya no sirve', () => {
  assert.deepEqual(graficasValidas({ medidas: ['ingresos'] }), ['kpi', 'tabla']);
  assert.equal(graficasValidas({ medidas: ['ingresos'], filas: { campo: 'tiempo', granularidad: 'mes' } })[0], 'barras');
  assert.ok(graficasValidas({ medidas: ['ingresos'], filas: { campo: 'fase' } }).includes('embudo'));
  assert.ok(!graficasValidas({ medidas: ['ingresos'], filas: { campo: 'cliente' } }).includes('embudo'));
  assert.ok(graficasValidas({ medidas: ['ingresos', 'deals'], filas: { campo: 'cliente' } }).includes('dispersion'));
  assert.ok(graficasValidas({ medidas: ['ingresos'], filas: { campo: 'cliente' }, columnas: { campo: 'tipoProyecto' } }).includes('barrasApiladas'));
  assert.equal(graficaCompatible('embudo', { medidas: ['ingresos'], filas: { campo: 'cliente' } }), 'barras');
  assert.equal(graficaCompatible('kpi', { medidas: ['ingresos'], filas: { campo: 'cliente' } }), 'barras');
});
prueba('todas las medidas y cortes del registro tienen nombre y se pueden ejecutar', () => {
  for (const m of Object.values(MEDIDAS)) {
    assert.ok(m.etiqueta && m.descripcion, m.id);
    assert.doesNotThrow(() => correr({ medidas: [m.id] }), m.id);
  }
  for (const dim of Object.values(DIMENSIONES)) {
    assert.ok(dim.etiqueta, dim.id);
    assert.doesNotThrow(() => correr({ filas: dim.id === 'tiempo' ? { campo: 'tiempo', granularidad: 'mes' } : { campo: dim.id } }), dim.id);
  }
});

// ── Rejilla ───────────────────────────────────────────────────────────────────

const it = (id: string, x: number, y: number, w: number, h: number) => ({ id, pos: { x, y, w, h } });
const sinEmpalmes = (xs: ReturnType<typeof it>[]) => xs.every((a, i) => xs.every((b, j) => i === j || !choca(a.pos, b.pos)));

prueba('rejilla: choques y compactar quita los huecos de arriba hacia abajo', () => {
  assert.equal(choca({ x: 0, y: 0, w: 4, h: 2 }, { x: 3, y: 1, w: 4, h: 2 }), true);
  assert.equal(choca({ x: 0, y: 0, w: 4, h: 2 }, { x: 4, y: 0, w: 4, h: 2 }), false);
  assert.equal(choca({ x: 0, y: 0, w: 4, h: 2 }, { x: 0, y: 2, w: 4, h: 2 }), false);
  const r = compactar([it('a', 0, 0, 6, 3), it('b', 0, 10, 6, 3), it('c', 6, 7, 6, 2)]);
  assert.deepEqual(r.map(x => x.pos.y), [0, 3, 0]);
  assert.deepEqual(compactar(r).map(x => x.pos), r.map(x => x.pos));
});
prueba('rejilla: soltar un bloque sobre otro lo empuja hacia abajo; arrastrarlo debajo de otro los intercambia', () => {
  const base = [it('a', 0, 0, 6, 3), it('b', 6, 0, 6, 3), it('c', 0, 3, 12, 3)];
  const arriba = mover(base, 'c', 0, 0);
  assert.equal(arriba.find(x => x.id === 'c')!.pos.y, 0);
  assert.ok(arriba.find(x => x.id === 'a')!.pos.y >= 3);
  assert.ok(sinEmpalmes(arriba));
  const abajo = mover([it('a', 0, 0, 12, 3), it('b', 0, 3, 12, 3)], 'a', 0, 4);
  assert.equal(abajo.find(x => x.id === 'b')!.pos.y, 0);
  assert.equal(abajo.find(x => x.id === 'a')!.pos.y, 3);
});
prueba('rejilla: un bloque soltado en el vacío de abajo se pega al contenido y no se sale por los lados', () => {
  const r = mover([it('a', 0, 0, 6, 3), it('b', 6, 0, 6, 3)], 'a', 5, 20);
  const a = r.find(x => x.id === 'a')!;
  assert.equal(a.pos.x, 5);
  assert.equal(a.pos.y, 3);
  const fuera = mover([it('a', 0, 0, 6, 3)], 'a', 99, -4);
  assert.deepEqual(fuera[0].pos, { x: COLUMNAS - 6, y: 0, w: 6, h: 3 });
});
prueba('rejilla: estirar empuja lo de abajo y lo de al lado; respeta el mínimo y el borde', () => {
  const base = [it('a', 0, 0, 6, 3), it('b', 6, 0, 6, 3), it('c', 0, 3, 6, 3)];
  const alto = redimensionar(base, 'a', 6, 5);
  assert.equal(alto.find(x => x.id === 'a')!.pos.h, 5);
  assert.equal(alto.find(x => x.id === 'c')!.pos.y, 5);
  assert.ok(sinEmpalmes(alto));
  const ancho = redimensionar(base, 'a', 12, 3);
  assert.equal(ancho.find(x => x.id === 'a')!.pos.w, 12);
  assert.ok(sinEmpalmes(ancho));
  assert.ok(ancho.find(x => x.id === 'b')!.pos.y >= 3);
  const chico = redimensionar(base, 'a', 0, 0);
  assert.deepEqual([chico.find(x => x.id === 'a')!.pos.w, chico.find(x => x.id === 'a')!.pos.h], [2, 2]);
  assert.equal(redimensionar([it('z', 8, 0, 2, 2)], 'z', 20, 2)[0].pos.w, 4);
});
prueba('rejilla: un bloque nuevo va al final y lo guardado se normaliza (enteros, dentro de la rejilla, sin empalmes)', () => {
  assert.deepEqual(posNueva([it('a', 0, 0, 6, 3), it('b', 0, 3, 6, 4)], 6, 8), { x: 0, y: 7, w: 6, h: 8 });
  assert.deepEqual(posNueva([], 20, 3), { x: 0, y: 0, w: 12, h: 3 });
  const n = normalizar([it('a', -3, 2.4, 40, 0), it('b', 5.6, 2.4, 8, 3)]);
  assert.ok(sinEmpalmes(n));
  assert.ok(n.every(x => x.pos.x >= 0 && x.pos.x + x.pos.w <= COLUMNAS && x.pos.h >= 2 && Number.isInteger(x.pos.y)));
  assert.deepEqual(normalizar(n).map(x => x.pos), n.map(x => x.pos));
});

// ── Vistas ────────────────────────────────────────────────────────────────────

prueba('el tablero inicial es válido, no se empalma y todos sus bloques se pueden ejecutar', () => {
  const t = tableroInicial(HOY);
  assert.equal(t.periodo.modo, 'anio');
  assert.equal(t.comparacion.modo, 'mismaFecha');
  assert.ok(t.bloques.length >= 6);
  assert.ok(sinEmpalmes(t.bloques));
  for (const b of t.bloques) assert.doesNotThrow(() => ejecutar(resolverConsulta(b.consulta, t), deals, ctx), b.titulo);
  assert.equal(new Set(t.bloques.map(b => b.id)).size, t.bloques.length);
});
prueba('guardar y leer un tablero da lo mismo; lo inválido se descarta o se arregla sin tronar', () => {
  const t = tableroInicial(HOY);
  assert.deepEqual(leerTablero(serializarTablero(t), HOY), t);
  assert.equal(leerTablero('esto no es json', HOY), null);
  assert.equal(leerTablero('[]', HOY), null);
  assert.equal(leerTablero('{"v":1}', HOY), null);
  const sucio = leerTablero(JSON.stringify({
    v: 2, periodo: { modo: 'inventado' }, comparacion: 7, fecha: { campo: 'xx' }, filtros: [{ campo: 'noExiste', valores: ['a'] }, { campo: 'tiempo', valores: ['a'] }, { campo: 'cliente', valores: ['Alfa', 3] }],
    bloques: [
      { id: 'x', titulo: 'sin medida', tipo: 'barras', consulta: { medidas: ['noExiste'], filtros: [] }, pos: { x: 0, y: 0, w: 6, h: 6 } },
      { id: 'y', titulo: 'ok', tipo: 'embudo', consulta: { medidas: ['ingresos', 'deals', 'ticket'], filas: { campo: 'cliente' }, columnas: { campo: 'cliente' } }, pos: { x: 3, y: 0, w: 99, h: 6 } },
      { id: 'y', titulo: '', tipo: 'xx', consulta: { medidas: ['ingresos'], filtros: [], periodo: { modo: 'raro' } }, pos: {} },
    ],
  }), HOY)!;
  assert.equal(sucio.periodo.modo, 'anio');
  assert.equal(sucio.comparacion.modo, 'mismaFecha');
  assert.deepEqual(sucio.fecha, { campo: 'aprobacion', alterna: true });
  assert.deepEqual(sucio.filtros, [{ campo: 'cliente', valores: ['Alfa'] }]);
  assert.equal(sucio.bloques.length, 2);
  assert.equal(new Set(sucio.bloques.map(b => b.id)).size, 2);
  const y = sucio.bloques.find(b => b.id === 'y')!;
  assert.equal(y.tipo, 'dispersion');
  assert.equal(y.consulta.medidas.length, 2);
  assert.equal(y.consulta.columnas, undefined);
  assert.ok(sucio.bloques.every(b => b.consulta.periodo === undefined || b.consulta.periodo.modo !== ('raro' as string)));
  assert.ok(sinEmpalmes(sucio.bloques));
});
prueba('al leer, cada gráfica conserva las medidas que sabe dibujar: la tabla varias, la dispersión dos y las demás una', () => {
  const medidas = ['ingresos', 'deals', 'ticket'];
  const t = leerTablero(JSON.stringify({
    v: 2,
    bloques: [
      { id: 'a', titulo: 'tabla', tipo: 'tabla', consulta: { medidas, filas: { campo: 'cliente' } }, pos: { x: 0, y: 0, w: 6, h: 6 } },
      { id: 'b', titulo: 'barras', tipo: 'barras', consulta: { medidas, filas: { campo: 'tiempo' } }, pos: { x: 6, y: 0, w: 6, h: 6 } },
      { id: 'c', titulo: 'dispersion', tipo: 'dispersion', consulta: { medidas, filas: { campo: 'cliente' } }, pos: { x: 0, y: 6, w: 6, h: 6 } },
      { id: 'd', titulo: 'cifra', tipo: 'kpi', consulta: { medidas }, pos: { x: 6, y: 6, w: 3, h: 3 } },
    ],
  }), HOY)!;
  const de = (id: string) => t.bloques.find(b => b.id === id)!;
  assert.equal(de('a').tipo, 'tabla');
  assert.equal(de('a').consulta.medidas.length, 3);
  assert.equal(de('b').consulta.medidas.length, 1);
  assert.equal(de('c').consulta.medidas.length, 2);
  assert.equal(de('d').consulta.medidas.length, 1);
});
prueba('una vista del dashboard anterior se convierte: filtros, fecha, gráficas sin comparar y una fila de cifras', () => {
  const t = desdeVistaAnterior({
    dateReference: 'approvalDate',
    filtersJson: JSON.stringify({ period: { mode: 'year', year: 2026 }, clients: ['Alfa'], projectTypes: [], currencies: ['MXN 🇲🇽'], owners: ['u1'], empresaOperadora: [], phases: [], compareMode: 'previous' }),
    widgetsJson: JSON.stringify([
      { id: 'w1', name: 'Revenue por Mes', metric: 'revenue', groupBy: 'month', chartType: 'combo', size: 'full', filters: null, displayOptions: {} },
      { id: 'w2', name: 'Margen por tipo', metric: 'margin', groupBy: 'projectType', chartType: 'rankingTable', size: 'half', filters: null, displayOptions: { limit: 10, sortDirection: 'desc' } },
      { id: 'w3', name: 'Ticket por cliente', metric: 'avgTicket', groupBy: 'client', chartType: 'pie', size: 'half', filters: null, displayOptions: { showLegend: true }, currency: 'USD' },
      { id: 'w4', name: 'Años', metric: 'revenue', groupBy: 'month', chartType: 'bar', size: 'full', filters: null, displayOptions: {}, compareBy: 'year', compareMode: 'auto' },
      { id: 'w5', name: 'Rara', metric: 'noExiste', groupBy: 'month', chartType: 'bar', size: 'half', filters: null, displayOptions: {} },
    ]),
  }, HOY, id => ({ u1: 'Ana' } as Record<string, string>)[id]);
  assert.deepEqual(t.periodo, { modo: 'anio', anio: 2026 });
  assert.deepEqual(t.fecha, { campo: 'aprobacion', alterna: true });
  assert.deepEqual(t.comparacion, { modo: 'anterior' });
  assert.deepEqual(t.filtros, [{ campo: 'cliente', valores: ['Alfa'] }, { campo: 'moneda', valores: ['MXN'] }, { campo: 'responsable', valores: ['Ana'] }]);
  const bloques = t.bloques.filter(b => b.tipo !== 'kpi');
  assert.equal(bloques.length, 4);
  assert.equal(t.bloques.filter(b => b.tipo === 'kpi').length, 4);
  assert.deepEqual(bloques.map(b => b.titulo), ['Revenue por Mes', 'Margen por tipo', 'Ticket por cliente', 'Años']);
  assert.deepEqual(bloques.map(b => b.tipo), ['barras', 'ranking', 'pie', 'barras']);
  assert.ok(bloques.every(b => b.consulta.comparacion?.modo === 'ninguna'));
  assert.deepEqual(bloques[3].consulta.filas, { campo: 'mesAnio' });
  assert.deepEqual(bloques[3].consulta.columnas, { campo: 'anio' });
  assert.equal(bloques[2].consulta.moneda, 'USD');
  assert.equal(bloques[2].estilo.leyenda, true);
  assert.ok(sinEmpalmes(t.bloques));
  for (const b of t.bloques) assert.doesNotThrow(() => ejecutar(resolverConsulta(b.consulta, t), deals, ctx), b.titulo);
});

// ── Correcciones de la revisión independiente ─────────────────────────────────

const ANIO_2026 = { periodo: { modo: 'anio', anio: 2026 } as Tablero['periodo'] };

prueba('un deal con fecha adelantada (después de hoy) entra en su mes, en el total y en el acumulado; un mes futuro sin deals sigue «sin dato»', () => {
  const ds = [
    d({ clientPrice: 100, proposalDate: '2026-03-01', approvalDate: '2026-03-10' }),
    d({ clientPrice: 500, proposalDate: '2026-12-01', approvalDate: '2026-12-15' }),
  ];
  const r = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } }, ANIO_2026, ds);
  assert.equal(r.total.valores[0], 600);
  assert.equal(r.filas[11].celdas[0].valores[0], 500);
  assert.equal(r.filas[11].celdas[0].deals.length, 1);
  assert.equal(r.filas[10].celdas[0].valores[0], null);
  assert.equal(r.filas.reduce((suma, f) => suma + (f.celdas[0].valores[0] ?? 0), 0), r.total.valores[0]);
  const ac = correr({ filas: { campo: 'tiempo', granularidad: 'mes' }, acumulado: true }, ANIO_2026, ds);
  assert.equal(ac.filas[11].celdas[0].valores[0], 600);
  assert.equal(ac.filas[10].celdas[0].valores[0], null);
});

prueba('el detalle de una cifra trae solo los deals que cuentan para ella; con varias medidas, los que cuentan para alguna; «Deals (todos)» trae todos', () => {
  const ds = [
    d({ client: 'A', clientPrice: 100, proposalDate: '2026-01-20', approvalDate: '2026-02-01' }),
    d({ phase: 'Perdido', client: 'A', clientPrice: 5000, proposalDate: '2026-02-02' }),
    d({ phase: 'Negociación', client: 'A', clientPrice: 9000, proposalDate: '2026-02-03' }),
  ];
  const r = correr({ filas: { campo: 'cliente' } }, ANIO_2026, ds);
  assert.equal(r.filas[0].celdas[0].valores[0], 100);
  assert.deepEqual(r.filas[0].celdas[0].deals.map(x => x.phase), ['Ganado']);
  assert.deepEqual(r.total.deals.map(x => x.phase), ['Ganado']);
  const t = correr({ medidas: ['ingresos', 'perdidos'], filas: { campo: 'cliente' } }, ANIO_2026, ds);
  assert.deepEqual(t.filas[0].celdas[0].deals.map(x => x.phase).sort(), ['Ganado', 'Perdido']);
  assert.equal(correr({ medidas: ['deals'] }, ANIO_2026, ds).total.deals.length, 3);
  assert.equal(correr({ medidas: ['conversion'] }, ANIO_2026, ds).total.deals.length, 3);
  assert.equal(correr({ medidas: ['perdidos'] }, ANIO_2026, ds).total.deals.length, 1);
});

prueba('cada medida da lo mismo con todos los deals que con solo los que cuentan para ella (en las tres monedas)', () => {
  for (const m of Object.values(MEDIDAS)) {
    for (const moneda of ['todas', 'MXN', 'USD'] as const) {
      const completo = m.calcular(deals, { moneda });
      const filtrado = m.calcular(m.cuenta ? deals.filter(m.cuenta) : deals, { moneda });
      assert.equal(filtrado, completo, `${m.id} · ${moneda}`);
    }
  }
});

prueba('una tasa de cierre de 0 % y un cierre en 0 días son datos y el renglón se queda; sin cotizaciones no hay dato en lugar de 0 %', () => {
  const ds = [
    d({ client: 'A', clientPrice: 10, proposalDate: '2026-01-05', approvalDate: '2026-01-05' }),
    d({ phase: 'Perdido', client: 'A', clientPrice: 10, proposalDate: '2026-02-05' }),
    d({ phase: 'Cotización enviada', client: 'B', clientPrice: 10, proposalDate: '2026-03-05' }),
    d({ phase: 'Perdido', client: 'B', clientPrice: 10, proposalDate: '2026-03-06' }),
    d({ phase: 'Prospecto', client: 'C', proposalDate: '2026-03-07' }),
  ];
  const r = correr({ medidas: ['conversion'], filas: { campo: 'cliente' } }, ANIO_2026, ds);
  assert.deepEqual(etiquetas(r).sort(), ['A', 'B']);
  assert.equal(r.filas.find(f => f.etiqueta === 'B')!.celdas[0].valores[0], 0);
  const c = correr({ medidas: ['cicloMediano'], filas: { campo: 'cliente' } }, ANIO_2026, ds);
  assert.deepEqual(etiquetas(c), ['A']);
  assert.equal(c.filas[0].celdas[0].valores[0], 0);
  const m = correr({ medidas: ['conversion'], filas: { campo: 'tiempo', granularidad: 'mes' } }, ANIO_2026, ds);
  assert.equal(m.filas[3].celdas[0].valores[0], null);
  assert.equal(formatear(m.filas[3].celdas[0].valores[0], 'porcentaje'), '—');
});

prueba('mes del año y trimestre del año muestran los 12 meses y los 4 trimestres aunque algunos no tengan ingresos; «Sin fecha» solo si tiene algo', () => {
  const ds = [
    d({ clientPrice: 10, approvalDate: '2026-01-10' }), d({ clientPrice: 20, approvalDate: '2026-03-10' }), d({ clientPrice: 30, approvalDate: '2026-04-10' }), d({ clientPrice: 5 }),
  ];
  const m = correr({ filas: { campo: 'mesAnio' } }, { periodo: { modo: 'todo' } }, ds);
  assert.deepEqual(etiquetas(m).slice(0, 12), ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']);
  assert.equal(m.filas[1].celdas[0].valores[0], 0);
  assert.deepEqual(etiquetas(m).slice(12), ['Sin fecha']);
  const q = correr({ filas: { campo: 'trimestreAnio' } }, { periodo: { modo: 'todo' } }, ds);
  assert.deepEqual(etiquetas(q).slice(0, 4), ['Q1', 'Q2', 'Q3', 'Q4']);
  // sin deals sin fecha, «Sin fecha» no aparece
  const sin = correr({ filas: { campo: 'mesAnio' } }, { periodo: { modo: 'todo' } }, ds.slice(0, 3));
  assert.equal(sin.filas.length, 12);
  // como columnas, los meses no se juntan en «Otros»
  const c = correr({ filas: { campo: 'cliente' }, columnas: { campo: 'mesAnio' } }, { periodo: { modo: 'todo' } }, ds.map((x, i) => ({ ...x, client: `C${i}` })));
  assert.equal(c.columnas.filter(x => x.esOtros).length, 0);
  assert.equal(c.columnas.length, 13);
});

prueba('febrero contra el bisiesto anterior: el 29 de febrero entra en la comparación; las demás fechas no cambian', () => {
  assert.deepEqual(resolverPeriodos({ modo: 'mes', anio: 2025, mes: 2 }, { modo: 'anioCompleto' }, HOY).previo, { inicio: '2024-02-01', fin: '2024-02-29' });
  assert.deepEqual(resolverPeriodos({ modo: 'mes', anio: 2025, mes: 2 }, { modo: 'mismaFecha' }, HOY).previo, { inicio: '2024-02-01', fin: '2024-02-29' });
  assert.deepEqual(resolverPeriodos({ modo: 'anio', anio: 2026 }, { modo: 'mismaFecha' }, '2026-02-28').previo, { inicio: '2025-01-01', fin: '2025-02-28' });
  assert.deepEqual(resolverPeriodos({ modo: 'mes', anio: 2024, mes: 2 }, { modo: 'anioCompleto' }, HOY).previo, { inicio: '2023-02-01', fin: '2023-02-28' });
  assert.deepEqual(resolverPeriodos({ modo: 'mes', anio: 2026, mes: 4 }, { modo: 'anioCompleto' }, HOY).previo, { inicio: '2025-04-01', fin: '2025-04-30' });
  const ds = [d({ clientPrice: 1000, approvalDate: '2024-02-29' }), d({ clientPrice: 500, approvalDate: '2025-02-10' })];
  const k = correr({}, { periodo: { modo: 'mes', anio: 2025, mes: 2 }, comparacion: { modo: 'mismaFecha' } }, ds);
  assert.equal(k.total.valores[0], 500);
  assert.equal(k.total.previos![0], 1000);
});

prueba('el dinero compacto no sale como «$1000K»: sube a millones donde ya redondea', () => {
  assert.equal(formatear(999_500, 'moneda'), '$1.0M');
  assert.equal(formatear(999_400, 'moneda'), '$999K');
  assert.equal(formatear(999.6, 'moneda'), '$1K');
  assert.equal(formatear(999, 'moneda'), '$999');
  assert.equal(formatear(-1_250_000, 'moneda'), '-$1.3M');
  assert.equal(formatear(32_463_415, 'moneda'), '$32.5M');
});

prueba('fechaValida: solo fechas reales, con año de cuatro cifras entre 1900 y 2200 (lo que escribe el selector de fechas o trae una vista guardada)', () => {
  for (const bien of ['2026-02-28', '2024-02-29', '2026-10-23T10:00:00']) assert.equal(fechaValida(bien), true, bien);
  for (const mal of ['2025-02-29', '2026-13-01', '2026-00-10', '20261-03-01', '0202-04-10', '2205-04-10x', '2300-01-01', '2026-4-5', '', null, 7]) assert.equal(fechaValida(mal), false, String(mal));
});

prueba('un tipo de cambio en cero cuenta como faltante (se usa 20) y no como ingresos en cero', () => {
  const ds = [
    d({ currency: USD, clientPrice: 100, exchangeRate: 0, approvalDate: '2026-01-10' }),
    d({ currency: USD, clientPrice: 100, approvalDate: '2026-01-11' }),
    d({ currency: USD, clientPrice: 100, exchangeRate: 17.5, approvalDate: '2026-01-12' }),
  ];
  assert.equal(correr({}, ANIO_2026, ds).total.valores[0], 2000 + 2000 + 1750);
});

prueba('nombres heredados de JavaScript («constructor», «__proto__») en una vista guardada se descartan, y el motor tampoco truena con ellos', () => {
  const t = leerTablero(JSON.stringify({
    v: 2,
    filtros: [{ campo: 'constructor', valores: ['x'] }, { campo: 'hasOwnProperty', valores: ['x'] }],
    bloques: [
      { id: 'a', titulo: 'x', tipo: 'constructor', consulta: { medidas: ['constructor'], filtros: [] }, pos: { x: 0, y: 0, w: 6, h: 6 } },
      {
        id: 'b', titulo: 'y', tipo: 'barras', estilo: { paleta: 'constructor' },
        consulta: { medidas: ['ingresos', 'toString'], filas: { campo: '__proto__' }, columnas: { campo: 'constructor' }, filtros: [{ campo: 'toString', valores: ['x'] }] },
        pos: { x: 6, y: 0, w: 6, h: 6 },
      },
    ],
  }), HOY)!;
  assert.deepEqual(t.filtros, []);
  assert.equal(t.bloques.length, 1);
  const b = t.bloques[0];
  assert.deepEqual(b.consulta.medidas, ['ingresos']);
  assert.equal(b.consulta.filas, undefined);
  assert.equal(b.consulta.columnas, undefined);
  assert.deepEqual(b.consulta.filtros, []);
  assert.ok(Object.prototype.hasOwnProperty.call(PALETAS, b.estilo.paleta));
  assert.doesNotThrow(() => ejecutar(resolverConsulta(b.consulta, t), deals, ctx));
  // directo al motor, sin pasar por la lectura
  assert.doesNotThrow(() => ejecutar({
    medidas: ['constructor', 'ingresos'], filtros: [{ campo: '__proto__', valores: ['x'] }], filas: { campo: 'constructor' }, columnas: { campo: 'toString' },
    periodo: { modo: 'todo' }, comparacion: { modo: 'ninguna' }, fecha: { campo: 'aprobacion', alterna: true },
  }, deals, ctx));
});

prueba('periodos y fechas absurdos de una vista guardada se descartan o se arreglan, no truenan al escribirlos y no cambian al leerlos otra vez', () => {
  const periodos: unknown[] = [
    { modo: 'ultimos', cantidad: 1e9, unidad: 'dias' }, { modo: 'ultimos', cantidad: 0.4, unidad: 'dias' }, { modo: 'rango', inicio: '2026-13-45', fin: '2026-02-30' },
    { modo: 'anio', anio: 300_000 }, { modo: 'mes', anio: 2026, mes: 13 }, { modo: 'trimestre', anio: 2026, trimestre: 9 }, { modo: 'rango', inicio: '20261-03-01', fin: '2026-03-01' },
  ];
  for (const periodo of periodos) {
    for (const comparacion of [{ modo: 'rango', inicio: '2026-13-45', fin: '20261-03-01' }, { modo: 'anterior' }, { modo: 'mismaFecha' }]) {
      const t = leerTablero(JSON.stringify({ v: 2, periodo, comparacion, bloques: [] }), HOY)!;
      const r = resolverPeriodos(t.periodo, t.comparacion, HOY);
      assert.equal(typeof r.etiquetaActual, 'string');
      assert.deepEqual(leerTablero(serializarTablero(t), HOY), t);
    }
  }
  assert.deepEqual(leerTablero(JSON.stringify({ v: 2, periodo: { modo: 'ultimos', cantidad: 0.4, unidad: 'dias' }, bloques: [] }), HOY)!.periodo, { modo: 'ultimos', cantidad: 1, unidad: 'dias' });
});

prueba('la rejilla no se queda dando vueltas con alturas o posiciones absurdas, ni deja un bloque fuera de las 12 columnas al estirarlo', () => {
  const inicio = Date.now();
  const sucio = normalizar([it('a', 0, 0, 6, Infinity), it('b', 0, 0, 6, 1e9), it('c', 3, 1e999, 99, NaN)]);
  assert.ok(sinEmpalmes(sucio));
  assert.ok(sucio.every(i => i.pos.h <= MAX_FILAS && Number.isFinite(i.pos.y) && i.pos.x + i.pos.w <= COLUMNAS));
  assert.ok(sinEmpalmes(mover(sucio, 'a', Infinity, 1e9)));
  assert.ok(sinEmpalmes(redimensionar(sucio, 'a', 5, Infinity)));
  // lo mismo, llegando desde un JSON guardado (1e999 es Infinity al leerlo)
  const bloque = (id: string, h: string) => `{"id":"${id}","titulo":"t","tipo":"barras","consulta":{"medidas":["ingresos"],"filas":{"campo":"cliente"}},"pos":{"x":0,"y":0,"w":6,"h":${h}}}`;
  const leido = leerTablero(`{"v":2,"bloques":[${bloque('a', '1e999')},${bloque('b', '1e9')},${bloque('c', '4')}]}`, HOY)!;
  assert.equal(leido.bloques.length, 3);
  assert.ok(sinEmpalmes(leido.bloques));
  const e = redimensionar([it('a', 10, 0, 2, 2)], 'a', 5, 5, { w: 3, h: 4 });
  assert.ok(e[0].pos.x + e[0].pos.w <= COLUMNAS);
  assert.equal(e[0].pos.w, 3);
  assert.ok(Date.now() - inicio < 3000, 'tardó demasiado');
});

prueba('un tablero guardado no pasa del máximo de bloques', () => {
  const muchos = Array.from({ length: MAX_BLOQUES + 40 }, (_, i) => ({ id: `b${i}`, titulo: 't', tipo: 'kpi', consulta: { medidas: ['ingresos'] }, pos: { x: 0, y: i * 3, w: 3, h: 3 } }));
  const t = leerTablero(JSON.stringify({ v: 2, bloques: muchos }), HOY)!;
  assert.equal(t.bloques.length, MAX_BLOQUES);
  assert.ok(sinEmpalmes(t.bloques));
});

prueba('el total de cada columna cuenta todos los renglones, también los que el límite dejó fuera; sin cruce es el total', () => {
  const r = correr({ filas: { campo: 'cliente' }, columnas: { campo: 'tipoProyecto' }, limite: 1 });
  assert.equal(r.filas.length, 1);
  assert.deepEqual(r.columnas.map(c => c.etiqueta), ['Cuali', 'Sin tipo', 'Cuanti']);
  assert.deepEqual(r.totalColumnas.map(c => c.valores[0]), [600_000, 80_000, 78_000]);
  assert.equal(r.total.valores[0], 758_000);
  const sin = correr({ filas: { campo: 'cliente' } });
  assert.equal(sin.totalColumnas.length, 1);
  assert.equal(sin.totalColumnas[0].valores[0], sin.total.valores[0]);
});

prueba('con acumulado y cruce, el total de cada renglón también corre; sin acumulado no cambia', () => {
  const ds = [
    d({ client: 'A', clientPrice: 100, approvalDate: '2026-01-10' }), d({ client: 'B', clientPrice: 50, approvalDate: '2026-01-20' }), d({ client: 'A', clientPrice: 200, approvalDate: '2026-02-10' }),
  ];
  const enero_marzo = { periodo: { modo: 'rango', inicio: '2026-01-01', fin: '2026-03-31' } as Tablero['periodo'] };
  const f = { campo: 'tiempo', granularidad: 'mes' as const };
  const ac = correr({ filas: f, columnas: { campo: 'cliente' }, acumulado: true }, enero_marzo, ds);
  assert.deepEqual(ac.filas.map(x => x.total.valores[0]), [150, 350, 350]);
  const normal = correr({ filas: f, columnas: { campo: 'cliente' } }, enero_marzo, ds);
  assert.deepEqual(normal.filas.map(x => x.total.valores[0]), [150, 200, 0]);
});

prueba('una columna cuyo margen suma exactamente cero se queda y los renglones cuadran con su total', () => {
  const ds = [
    d({ client: 'A', projectType: 'X', clientPrice: 3000, quotedCost: 1000, approvalDate: '2026-01-10' }),
    d({ client: 'A', projectType: 'Y', clientPrice: 1000, quotedCost: 3000, approvalDate: '2026-01-11' }),
    d({ client: 'B', projectType: 'X', clientPrice: 1600, quotedCost: 1000, approvalDate: '2026-01-12' }),
  ];
  const r = correr({ medidas: ['margen'], filas: { campo: 'tipoProyecto' }, columnas: { campo: 'cliente' } }, ANIO_2026, ds);
  assert.deepEqual(r.columnas.map(c => c.etiqueta).sort(), ['A', 'B']);
  for (const f of r.filas) assert.equal(f.celdas.reduce((suma, c) => suma + (c.valores[0] ?? 0), 0), f.total.valores[0]);
});

prueba('todo el historial: una fecha mal tecleada (año 2205 o 0202) no estira la gráfica a cientos de tramos, y los totales siguen contando todo', () => {
  const ds = [
    d({ clientPrice: 100, approvalDate: '2025-03-10' }), d({ clientPrice: 200, approvalDate: '2026-04-10' }),
    d({ clientPrice: 999, approvalDate: '2205-04-10' }), d({ clientPrice: 7, approvalDate: '0202-04-10' }),
  ];
  const r = correr({ filas: { campo: 'tiempo', granularidad: 'mes' } }, {}, ds);
  assert.equal(r.filas.length, 14);
  assert.equal(r.filas[0].etiqueta, 'Mar 2025');
  assert.equal(r.filas[13].etiqueta, 'Abr 2026');
  assert.equal(r.total.valores[0], 1306);
});

prueba('una dispersión del dashboard anterior conserva sus dos medidas (la segunda, por omisión, el número de deals)', () => {
  const t = desdeVistaAnterior({
    dateReference: 'approvalDate',
    filtersJson: '{}',
    widgetsJson: JSON.stringify([
      { id: 'w1', name: 'Ingresos contra margen', metric: 'revenue', metricY: 'margin', groupBy: 'client', chartType: 'scatter', size: 'half', filters: null, displayOptions: {} },
      { id: 'w2', name: 'Sin segunda', metric: 'revenue', groupBy: 'client', chartType: 'scatter', size: 'half', filters: null, displayOptions: {} },
      { id: 'w3', name: 'Con prototipo', metric: 'constructor', groupBy: 'client', chartType: 'toString', size: 'half', filters: null, displayOptions: {} },
    ]),
  }, HOY);
  const dispersiones = t.bloques.filter(b => b.tipo === 'dispersion');
  assert.equal(dispersiones.length, 2);
  assert.deepEqual(dispersiones[0].consulta.medidas, ['ingresos', 'margen']);
  assert.deepEqual(dispersiones[1].consulta.medidas, ['ingresos', 'deals']);
  assert.equal(t.bloques.some(b => b.titulo === 'Con prototipo'), false);
  for (const b of t.bloques) assert.doesNotThrow(() => ejecutar(resolverConsulta(b.consulta, t), deals, ctx), b.titulo);
});

prueba('copiar los datos: una etiqueta con tabulador o salto de línea no corre las columnas', () => {
  const ds = [d({ client: 'Cliente\tcon\ntabulador', clientPrice: 100, approvalDate: '2026-01-10' })];
  const r = correr({ filas: { campo: 'cliente' } }, ANIO_2026, ds);
  const lineas = tablaComoTexto(r).split('\n');
  assert.equal(lineas.length, 2);
  assert.equal(lineas[1].split('\t').length, 2);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
