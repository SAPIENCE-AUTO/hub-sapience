// Pruebas del módulo «Pagos de análisis / management»: las reglas del reparto (src/lib/pagosManagement), y los endpoints de punta a punta contra una
// base en memoria (PGlite) con el esquema real: de dónde salen los montos de un deal por rubro, guardar y leer repartos (el presupuesto es la suma
// de rubros), validaciones, acceso solo para Sergio y qué pasa si todavía no existen las tablas. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-management.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import {
  MAX_PERSONAS, MAX_PORCENTAJE, RUBROS, acumuladoPorPersona, costoDealDe, enPeriodo, esEditado, esPorOmision, estadoDeDeal, estadoReparto, etiquetaRubros, leerMonto, leerPorcentaje,
  managementDe, montoDe, montoDeRubro, montosDe, normalizarNombre, partesIguales, porcentajeDeMonto, presupuestoDe, repartirMonto, resumenDeDeal, rubrosPorOmision, sumaPorcentajes,
  textoNumero, totalesDeDeals, totalesPorMoneda, validarReparto, validarRubros, type DealManagement, type PersonaReparto, type ProyectoDisponible, type ProyectoManagement, type RubrosDeal,
} from '../../src/lib/pagosManagement/reparto';
import {
  agregarRubro, conBase, conMonto, conPartesIguales, conPorcentaje, conTextoDeRubro, dealAGuardar, filaVacia, filasDe, personasDe, quitarRubro, recalcular, rubroEditado,
  rubrosAGuardar, rubrosDe, rubrosFaltantes, totalDe, type FilaReparto, type FilaRubro,
} from '../../src/lib/pagosManagement/filas';
import getPagosManagement from '../../src/api/getPagosManagement';
import savePagosManagementReparto from '../../src/api/savePagosManagementReparto';

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

const interna = (userId: string, nombre: string, porcentaje: number): PersonaReparto => ({ userId, nombre, externo: false, porcentaje });
const externa = (nombre: string, porcentaje: number): PersonaReparto => ({ userId: null, nombre, externo: true, porcentaje });

// ── porcentajes y montos ─────────────────────────────────────────────────────
await prueba('partesIguales: siempre suman exactamente 100 y las primeras personas llevan la diferencia', () => {
  assert.deepEqual(partesIguales(1), [100]);
  assert.deepEqual(partesIguales(2), [50, 50]);
  assert.deepEqual(partesIguales(3), [33.333334, 33.333333, 33.333333]);
  assert.deepEqual(partesIguales(4), [25, 25, 25, 25]);
  assert.deepEqual(partesIguales(5), [20, 20, 20, 20, 20]);
  assert.deepEqual(partesIguales(7), [14.285715, 14.285715, 14.285714, 14.285714, 14.285714, 14.285714, 14.285714]);
  for (let k = 1; k <= 30; k++) assert.equal(sumaPorcentajes(partesIguales(k).map((porcentaje) => ({ porcentaje }))), 100, `k=${k}`);
  assert.deepEqual(partesIguales(0), []);
  assert.deepEqual(partesIguales(-2), []);
});
await prueba('estadoReparto: sin repartir, incompleto, completo (con unos centavos de tolerancia) y excedido', () => {
  const e = (...porcentajes: number[]) => estadoReparto(porcentajes.map((porcentaje) => ({ porcentaje })));
  assert.equal(e(), 'sinRepartir');
  assert.equal(e(0), 'sinRepartir');
  assert.equal(e(60), 'incompleto');
  assert.equal(e(60, 40), 'completo');
  assert.equal(e(60, 40.00005), 'completo');
  assert.equal(e(99.99995), 'completo');
  assert.equal(e(99.999), 'incompleto');
  assert.equal(e(60, 40.001), 'excedido');
  assert.equal(e(...partesIguales(3)), 'completo');
});
await prueba('montoDe y porcentajeDeMonto: se convierten uno en otro con centavos y sin presupuesto no hay porcentaje', () => {
  assert.equal(montoDe(25000, 20), 5000);
  assert.equal(montoDe(25000, 33.3333), 8333.33);
  assert.equal(montoDe(0, 50), 0);
  assert.equal(porcentajeDeMonto(25000, 5000), 20);
  assert.equal(porcentajeDeMonto(25000, 8333.33), 33.33332);
  assert.equal(porcentajeDeMonto(0, 100), 0);
  // Ida y vuelta: el monto escrito vuelve a salir igual, también en presupuestos que no dividen justo (5,000 de 37,500 es 13.333333 %).
  for (const monto of [1234.56, 8333.33, 4166.67, 25000, 0.01]) assert.equal(montoDe(25000, porcentajeDeMonto(25000, monto)), monto, String(monto));
  for (const monto of [5000, 12345, 1, 4999.99, 37500]) assert.equal(montoDe(37500, porcentajeDeMonto(37500, monto)), monto, String(monto));
  for (const monto of [10000, 333.33, 100000.01]) assert.equal(montoDe(300000, porcentajeDeMonto(300000, monto)), monto, String(monto));
});
// Lo que el deal dice de cada rubro (costo sin markup y, de referencia, con markup).
const mgmt = (costo: number, conMarkup = costo * 1.5): RubrosDeal => ({ Management: { costo, conMarkup } });
const DEAL: RubrosDeal = { Management: { costo: 25000, conMarkup: 37500 }, 'Moderación': { costo: 8000, conMarkup: 12000 } };
await prueba('presupuestoDe: la suma de sus rubros, cada uno con su monto puesto a mano o, si no, el del deal (un 0 puesto a mano también cuenta)', () => {
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: rubrosPorOmision() }), 25000);
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: 40000 }] }), 40000);
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: 0 }] }), 0);
  // Se le suma otro rubro, con el monto del deal o con uno puesto a mano.
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }] }), 33000);
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: 5000 }] }), 30000);
  // Un rubro que el deal no trae vale 0 mientras no se le ponga monto.
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Back office', monto: null }] }), 25000);
  assert.equal(presupuestoDe({ rubrosDeal: {}, rubros: rubrosPorOmision() }), 0);
  // Sin Management: solo lo que se agregó.
  assert.equal(presupuestoDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Moderación', monto: null }] }), 8000);
});
await prueba('rubros: los de la cotización con Management primero; por omisión solo Management del deal; costo y monto de cada uno', () => {
  assert.equal(RUBROS.length, 5);
  assert.equal(RUBROS[0], 'Management');
  assert.deepEqual(rubrosPorOmision(), [{ rubro: 'Management', monto: null }]);
  assert.equal(esPorOmision(rubrosPorOmision()), true);
  assert.equal(esPorOmision([{ rubro: 'Management', monto: 0 }]), false);
  assert.equal(esPorOmision([{ rubro: 'Moderación', monto: null }]), false);
  assert.equal(esPorOmision([{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }]), false);
  assert.deepEqual([costoDealDe(DEAL, 'Management'), costoDealDe(DEAL, 'Moderación'), costoDealDe(DEAL, 'Back office')], [25000, 8000, 0]);
  assert.deepEqual([montoDeRubro(DEAL, { rubro: 'Moderación', monto: null }), montoDeRubro(DEAL, { rubro: 'Moderación', monto: 100 }), montoDeRubro(DEAL, { rubro: 'Back office', monto: null })], [8000, 100, 0]);
});
await prueba('esEditado y etiquetaRubros: «editado» solo si cambió un monto que el deal trae; la etiqueta junta los nombres cortos', () => {
  assert.equal(esEditado({ rubrosDeal: DEAL, rubros: rubrosPorOmision() }), false);
  assert.equal(esEditado({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: 40000 }] }), true);
  assert.equal(esEditado({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: 5000 }] }), true);
  assert.equal(esEditado({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Back office', monto: 3000 }] }), false); // el deal no trae Back office
  assert.equal(esEditado({ rubrosDeal: {}, rubros: [{ rubro: 'Management', monto: 3000 }] }), false);
  assert.equal(etiquetaRubros([{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }, { rubro: 'Logística y operación', monto: null }]), 'Management + Moderación + Logística');
  assert.equal(etiquetaRubros([{ rubro: 'Reclutamiento e incentivos', monto: null }]), 'Reclutamiento');
});
await prueba('validarRubros: al menos uno, sin repetir y con montos válidos', () => {
  assert.equal(validarRubros(rubrosPorOmision()), null);
  assert.equal(validarRubros([{ rubro: 'Management', monto: 0 }, { rubro: 'Back office', monto: 10 }]), null);
  assert.equal(validarRubros([]), 'El presupuesto necesita al menos un rubro.');
  assert.match(validarRubros([{ rubro: 'Moderación', monto: null }, { rubro: 'Moderación', monto: 5 }])!, /«Moderación» está dos veces en el presupuesto/);
  assert.match(validarRubros([{ rubro: 'Management', monto: -1 }])!, /El monto de Management no es válido/);
  assert.match(validarRubros([{ rubro: 'Management', monto: Number.NaN }])!, /no es válido/);
});

// ── lo que se escribe en los campos ──────────────────────────────────────────
await prueba('leerMonto: acepta $, comas de miles y coma decimal; vacío es «sin monto»; lo demás no vale', () => {
  assert.equal(leerMonto('25000'), 25000);
  assert.equal(leerMonto('25,000'), 25000);
  assert.equal(leerMonto('$25,000.50'), 25000.5);
  assert.equal(leerMonto('$ 25,000'), 25000);
  assert.equal(leerMonto('1,234,567.89'), 1234567.89);
  assert.equal(leerMonto('25 000'), 25000);
  assert.equal(leerMonto('5,5'), 5.5);
  assert.equal(leerMonto('0'), 0);
  assert.equal(leerMonto('25000.456'), 25000.46);
  assert.equal(leerMonto(''), null);
  assert.equal(leerMonto('   '), null);
  for (const malo of ['abc', '-5', '1e3', '12,34,56', '1,5000', '5%', 'NaN', 'Infinity', '1000000001']) assert.equal(leerMonto(malo), undefined, malo);
});
await prueba('leerPorcentaje: acepta punto, coma y %; vacío es «sin porcentaje»; más de 100 vale hasta el tope; negativo o no numérico no', () => {
  assert.equal(leerPorcentaje('33.33'), 33.33);
  assert.equal(leerPorcentaje('33,33'), 33.33);
  assert.equal(leerPorcentaje('33%'), 33);
  assert.equal(leerPorcentaje(' 50 % '), 50);
  assert.equal(leerPorcentaje('12.34567'), 12.34567);
  assert.equal(leerPorcentaje('12.3456789'), 12.345679);
  assert.equal(leerPorcentaje('100'), 100);
  assert.equal(leerPorcentaje('0'), 0);
  assert.equal(leerPorcentaje(''), null);
  // Se puede pasar de 100 (a veces se paga de más), hasta un tope contra errores de dedo.
  assert.equal(MAX_PORCENTAJE, 1000);
  assert.equal(leerPorcentaje('120'), 120);
  assert.equal(leerPorcentaje('150,5'), 150.5);
  assert.equal(leerPorcentaje('1000'), 1000);
  for (const malo of ['1000.01', '1001', '-1', 'abc', '1e2', '5.5.5', 'NaN']) assert.equal(leerPorcentaje(malo), undefined, malo);
});
await prueba('textoNumero: sin ceros de sobra', () => {
  assert.equal(textoNumero(33.3333), '33.3333');
  assert.equal(textoNumero(50), '50');
  assert.equal(textoNumero(12.5), '12.5');
  assert.equal(textoNumero(33.33333333), '33.333333');
  assert.equal(textoNumero(33.333334), '33.333334');
});

// ── validación ───────────────────────────────────────────────────────────────
await prueba('normalizarNombre: mayúsculas, acentos y espacios de sobra no hacen otra persona', () => {
  assert.equal(normalizarNombre('  Luis   PÉREZ '), 'luis perez');
  assert.equal(normalizarNombre('luis perez'), normalizarNombre('Luis Pérez'));
});
await prueba('validarReparto: un reparto bien armado, incompleto, vacío o que se pasa de 100 % vale (pasarse es un aviso, no un error)', () => {
  assert.equal(validarReparto([interna('u1', 'Ana', 60), externa('Luis', 40)]), null);
  assert.equal(validarReparto([interna('u1', 'Ana', 50)]), null); // se completa después
  assert.equal(validarReparto([]), null); // solo el presupuesto
  assert.equal(validarReparto(partesIguales(3).map((p, i) => interna(`u${i}`, `P${i}`, p))), null);
  assert.equal(validarReparto([interna('u1', 'Ana', 70), externa('Luis', 50)]), null); // suman 120 %
  assert.equal(validarReparto([interna('u1', 'Ana', 150)]), null); // una sola persona con más del presupuesto
  assert.equal(estadoReparto([{ porcentaje: 70 }, { porcentaje: 50 }]), 'excedido'); // lo que sí se sabe es que se pasó
});
await prueba('validarReparto: dice qué está mal en palabras llanas', () => {
  assert.equal(validarReparto([{ userId: null, nombre: 'Ana', externo: false, porcentaje: 50 }]), 'Elige a la persona de cada renglón.');
  assert.equal(validarReparto([externa('   ', 50)]), 'Escribe el nombre de la persona externa.');
  assert.match(validarReparto([interna('u1', 'Ana', 30), interna('u1', 'Ana', 30)])!, /«Ana» está dos veces/);
  assert.match(validarReparto([externa('Luis  Pérez', 30), externa('luis perez', 30)])!, /dos veces en el reparto/);
  assert.match(validarReparto([interna('u1', 'Ana', 0)])!, /porcentaje mayor a cero para Ana/);
  assert.match(validarReparto([interna('u1', 'Ana', Number.NaN)])!, /mayor a cero/);
  assert.equal(validarReparto([interna('u1', 'Ana', 1000.5)]), 'Un porcentaje no puede pasar de 1000.');
  assert.match(validarReparto(Array.from({ length: MAX_PERSONAS + 1 }, (_, i) => interna(`u${i}`, `P${i}`, 1)))!, /más de 30 personas/);
});

// ── acumulado, totales y periodo ─────────────────────────────────────────────
const proyecto = (p: Partial<ProyectoManagement> & { codigo: string }): ProyectoManagement => ({
  repartoId: 'r', projectId: 'p', rubrosDeal: {}, monedaDeal: 'MXN', rubros: rubrosPorOmision(), moneda: 'MXN', personas: [], eliminado: false, ...p,
});
const PROYECTOS = [
  proyecto({ codigo: 'ALFA', cliente: 'Cliente Uno', inicio: '2026-03-01', rubrosDeal: mgmt(35000), personas: [interna('u1', 'Ana Prueba', 50), interna('u2', 'Beto Prueba', 30), externa('Luis Externo', 20)] }),
  proyecto({ codigo: 'BETA', inicio: '2026-08-10', rubrosDeal: mgmt(25000), rubros: [{ rubro: 'Management', monto: 10000 }], personas: [interna('u1', 'Ana Prueba', 100)] }),
  proyecto({ codigo: 'GAMA', inicio: '2025-01-15', rubrosDeal: mgmt(700), monedaDeal: 'USD', moneda: 'USD', personas: [interna('u1', 'Ana Prueba', 50), externa('luis  externo', 50)] }),
  proyecto({ codigo: 'DELTA', rubrosDeal: mgmt(5000) }),
];
await prueba('acumuladoPorPersona: suma cada persona en todos sus proyectos, por moneda, y junta al externo escrito de dos formas', () => {
  const a = acumuladoPorPersona(PROYECTOS);
  assert.deepEqual(a.map((x) => [x.nombre, x.externo, x.proyectos, x.porMoneda]), [
    ['Ana Prueba', false, 3, { MXN: 27500, USD: 350, EUR: 0 }],
    ['Beto Prueba', false, 1, { MXN: 10500, USD: 0, EUR: 0 }],
    ['Luis Externo', true, 2, { MXN: 7000, USD: 350, EUR: 0 }],
  ]);
  // El detalle de Ana va del monto más grande al más chico, con el porcentaje y la moneda de cada proyecto.
  assert.deepEqual(a[0].detalle.map((d) => [d.codigo, d.porcentaje, d.monto, d.moneda]), [['ALFA', 50, 17500, 'MXN'], ['BETA', 100, 10000, 'MXN'], ['GAMA', 50, 350, 'USD']]);
  assert.deepEqual(acumuladoPorPersona([]), []);
  assert.deepEqual(acumuladoPorPersona([PROYECTOS[3]]), []);
});
await prueba('acumuladoPorPersona: un presupuesto cambiado a mano manda sobre el del deal', () => {
  const a = acumuladoPorPersona([PROYECTOS[1]]);
  assert.equal(a[0].porMoneda.MXN, 10000); // no 25,000
});
await prueba('acumuladoPorPersona y totalesPorMoneda: con otro rubro sumado el reparto es sobre el presupuesto total', () => {
  const dos = proyecto({
    codigo: 'DOS', rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }],
    personas: [interna('u1', 'Ana Prueba', 50), interna('u2', 'Beto Prueba', 50)],
  });
  assert.deepEqual(acumuladoPorPersona([dos]).map((x) => [x.nombre, x.porMoneda.MXN]), [['Ana Prueba', 16500], ['Beto Prueba', 16500]]);
  assert.deepEqual(totalesPorMoneda([dos]), {
    presupuestado: { MXN: 33000, USD: 0, EUR: 0 }, repartido: { MXN: 33000, USD: 0, EUR: 0 }, porRepartir: { MXN: 0, USD: 0, EUR: 0 }, excedido: { MXN: 0, USD: 0, EUR: 0 }, proyectosExcedidos: 0,
  });
});
await prueba('totalesPorMoneda: lo presupuestado, lo repartido y lo que falta, cada moneda por su lado', () => {
  const t = totalesPorMoneda(PROYECTOS);
  assert.deepEqual(t.presupuestado, { MXN: 35000 + 10000 + 5000, USD: 700, EUR: 0 });
  assert.deepEqual(t.repartido, { MXN: 45000, USD: 700, EUR: 0 });
  assert.deepEqual(t.porRepartir, { MXN: 5000, USD: 0, EUR: 0 }); // DELTA, sin repartir
  assert.deepEqual([t.excedido, t.proyectosExcedidos], [{ MXN: 0, USD: 0, EUR: 0 }, 0]);
});
await prueba('totalesPorMoneda: un proyecto que se pasa de 100 % se cuenta aparte y no le resta a lo que falta en otro', () => {
  const pasado = proyecto({ codigo: 'PASADO', rubrosDeal: mgmt(25000), personas: [interna('u1', 'Ana Prueba', 60), interna('u2', 'Beto Prueba', 50)] }); // 110 %: 27,500
  const falta = proyecto({ codigo: 'FALTA', rubrosDeal: mgmt(10000), personas: [interna('u1', 'Ana Prueba', 50)] }); // falta la mitad: 5,000
  const t = totalesPorMoneda([pasado, falta]);
  assert.deepEqual(t.presupuestado, { MXN: 35000, USD: 0, EUR: 0 });
  assert.deepEqual(t.repartido, { MXN: 32500, USD: 0, EUR: 0 });
  assert.deepEqual(t.porRepartir, { MXN: 5000, USD: 0, EUR: 0 }); // no 2,500
  assert.deepEqual([t.excedido, t.proyectosExcedidos], [{ MXN: 2500, USD: 0, EUR: 0 }, 1]);
  // Los montos de cada persona salen del porcentaje que se le puso, aunque se pase.
  assert.deepEqual(acumuladoPorPersona([pasado]).map((x) => [x.nombre, x.porMoneda.MXN]), [['Ana Prueba', 15000], ['Beto Prueba', 12500]]);
  // Un reparto completo (con unos centavos de tolerancia) no deja resto.
  const completo = proyecto({ codigo: 'COMPLETO', rubrosDeal: mgmt(20000), personas: partesIguales(3).map((pc, i) => interna(`u${i}`, `P${i}`, pc)) });
  assert.deepEqual([totalesPorMoneda([completo]).porRepartir.MXN, totalesPorMoneda([completo]).excedido.MXN], [0, 0]);
});
await prueba('enPeriodo: por inicio del proyecto; los que aún no empiezan sí cuentan y sin fecha solo en «todo»', () => {
  const hoy = '2026-10-17';
  const codigos = (p: Parameters<typeof enPeriodo>[1]) => enPeriodo(PROYECTOS, p, hoy).map((x) => x.codigo);
  assert.deepEqual(codigos('12m'), ['ALFA', 'BETA']);
  assert.deepEqual(codigos('6m'), ['BETA']);
  assert.deepEqual(codigos('anio'), ['ALFA', 'BETA']);
  assert.deepEqual(codigos('todo'), ['ALFA', 'BETA', 'GAMA', 'DELTA']);
  assert.deepEqual(enPeriodo([proyecto({ codigo: 'FUTURO', inicio: '2026-12-01' })], '6m', hoy).map((x) => x.codigo), ['FUTURO']);
});

// ── los centavos: lo repartido suma exacto ───────────────────────────────────
await prueba('repartirMonto: los montos suman exacto lo repartido; los centavos de más se quitan a quien tiene la fracción menor', () => {
  assert.deepEqual(repartirMonto(20000, partesIguales(3)), [6666.67, 6666.67, 6666.66]);
  assert.deepEqual(repartirMonto(100, partesIguales(3)), [33.34, 33.33, 33.33]);
  assert.deepEqual(repartirMonto(25000, [50, 50]), [12500, 12500]);
  assert.deepEqual(repartirMonto(25000, [100]), [25000]);
  assert.deepEqual(repartirMonto(0, [50, 50]), [0, 0]);
  assert.deepEqual(repartirMonto(25000, []), []);
  // Menos de 100 %: solo se reparte lo asignado.
  assert.deepEqual(repartirMonto(20000, [60, 20]), [12000, 4000]);
  // Montos escritos a mano que suman un centavo menos de 100 % no cambian lo que se escribió.
  assert.deepEqual(repartirMonto(20000, [33.33335, 33.33335, 33.3333]), [6666.67, 6666.67, 6666.66]);
  assert.deepEqual(montosDe(20000, [{ porcentaje: 70 }, { porcentaje: 30 }]), [14000, 6000]);
});
await prueba('repartirMonto: en 500 repartos completos al azar la suma es el presupuesto al centavo y a nadie le cambia más de un centavo', () => {
  let semilla = 12345;
  const azar = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let ronda = 0; ronda < 500; ronda++) {
    const base = Math.round(azar() * 5_000_000) / 100; // hasta 50,000.00
    const pesos = Array.from({ length: 1 + Math.floor(azar() * 6) }, () => 1 + Math.floor(azar() * 9));
    const total = pesos.reduce((s, x) => s + x, 0);
    // Porcentajes con 6 decimales que suman 100 exacto: el último lleva lo que falta.
    const micro = pesos.map((w) => Math.floor((w / total) * 100 * 1e6));
    micro[micro.length - 1] += 100 * 1e6 - micro.reduce((s, x) => s + x, 0);
    const pcts = micro.map((m) => m / 1e6);
    const montos = repartirMonto(base, pcts);
    assert.equal(Math.round(montos.reduce((s, x) => s + x, 0) * 100), Math.round(base * 100), `ronda ${ronda}: base ${base}, pcts ${pcts}`);
    montos.forEach((m, i) => assert.ok(Math.abs(m - (base * pcts[i]) / 100) < 0.0100001, `ronda ${ronda}, persona ${i}`));
  }
});
await prueba('un reparto en tres partes suma exacto el presupuesto en el acumulado y en los totales, sin el centavo de más', () => {
  const tres = proyecto({ codigo: 'TRES', inicio: '2026-05-01', rubrosDeal: mgmt(20000), personas: [interna('u1', 'Ana Prueba', 33.333334), interna('u2', 'Beto Prueba', 33.333333), externa('Luis Externo', 33.333333)] });
  assert.deepEqual(acumuladoPorPersona([tres]).map((x) => [x.nombre, x.porMoneda.MXN]), [['Ana Prueba', 6666.67], ['Beto Prueba', 6666.67], ['Luis Externo', 6666.66]]);
  assert.equal(totalesPorMoneda([tres]).repartido.MXN, 20000);
});

// ── los renglones del reparto en pantalla ────────────────────────────────────
const fila = (f: Partial<FilaReparto>): FilaReparto => ({ ...filaVacia(), ...f });
const interno = (userId: string, nombre: string, pct = '', monto = ''): FilaReparto => fila({ tipo: 'interno', userId, nombre, pct, monto });
const campos = (filas: FilaReparto[]) => filas.map((f) => [f.pct, f.monto]);
await prueba('filas: al escribir un porcentaje se calcula el monto y al escribir un monto se calcula el porcentaje', () => {
  let filas = [interno('u1', 'Ana'), interno('u2', 'Beto')];
  filas = conPorcentaje(filas, 0, '20', 25000);
  assert.deepEqual(campos(filas), [['20', '5000'], ['', '']]);
  filas = conMonto(filas, 1, '7,500', 25000);
  assert.deepEqual(campos(filas), [['20', '5000'], ['30', '7,500']]); // el monto queda como se escribió
  assert.deepEqual(campos(conBase(filas, 40000)), [['20', '8000'], ['30', '12000']]); // otro presupuesto: los porcentajes se quedan
});
await prueba('filas: un monto escrito vuelve igual aunque el presupuesto no divida justo (5,000 de 37,500)', () => {
  const filas = conMonto([interno('u1', 'Ana')], 0, '5000', 37500);
  assert.equal(filas[0].pct, '13.333333');
  assert.equal(recalcular(filas, 37500)[0].monto, '5000');
});
await prueba('filas: partes iguales entre tres suman 100 y los montos suman exacto', () => {
  const filas = conPartesIguales([interno('u1', 'Ana'), interno('u2', 'Beto'), interno('u3', 'Carla')], 20000);
  assert.deepEqual(campos(filas), [['33.333334', '6666.67'], ['33.333333', '6666.67'], ['33.333333', '6666.66']]);
  assert.equal(sumaPorcentajes(personasDe(filas)), 100);
});
await prueba('filas: un porcentaje a medio escribir deja el monto, vacío lo borra, y sin presupuesto no hay montos', () => {
  const filas = conPorcentaje([interno('u1', 'Ana', '20', '5000')], 0, '3.', 25000);
  assert.deepEqual(campos(filas), [['3.', '5000']]);
  assert.deepEqual(campos(conPorcentaje(filas, 0, '', 25000)), [['', '']]);
  assert.deepEqual(campos(conPorcentaje(filas, 0, '20', 0)), [['20', '']]);
  assert.deepEqual(campos(conPorcentaje(filas, 0, '20', undefined)), [['20', '5000']]); // presupuesto mal escrito: no se toca
  assert.deepEqual(campos(conMonto(filas, 0, '1000', 0)), [['3.', '1000']]); // sin presupuesto no hay con qué calcular el porcentaje
  assert.deepEqual(campos(conMonto(filas, 0, '', 25000)), [['', '']]);
});
await prueba('filas: filasDe abre con las personas del reparto (con su monto) o con un renglón vacío', () => {
  assert.equal(filasDe(proyecto({ codigo: 'X' })).length, 1);
  assert.equal(filasDe(proyecto({ codigo: 'X' }))[0].tipo, 'sin');
  const tres = proyecto({ codigo: 'TRES', rubrosDeal: mgmt(20000), personas: [interna('u1', 'Ana', 33.333334), interna('u2', 'Beto', 33.333333), externa('Luis', 33.333333)] });
  const filas = filasDe(tres);
  assert.deepEqual(campos(filas), [['33.333334', '6666.67'], ['33.333333', '6666.67'], ['33.333333', '6666.66']]);
  assert.deepEqual(filas.map((f) => [f.tipo, f.userId, f.nombre]), [['interno', 'u1', 'Ana'], ['interno', 'u2', 'Beto'], ['externo', null, 'Luis']]);
  // Con un presupuesto puesto a mano, o con otro rubro sumado, los montos salen del presupuesto de hoy.
  assert.deepEqual(campos(filasDe({ ...tres, rubros: [{ rubro: 'Management', monto: 30000 }] })).map((c) => c[1]), ['10000', '10000', '10000']);
  assert.deepEqual(campos(filasDe({ ...tres, rubrosDeal: { ...tres.rubrosDeal, 'Moderación': { costo: 10000, conMarkup: 15000 } }, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }] })).map((c) => c[1]), ['10000', '10000', '10000']);
});
const dealMgmt = { rubrosDeal: DEAL, monedaDeal: 'MXN' as const };
const textos = (filas: FilaRubro[]) => filas.map((f) => [f.rubro, f.texto]);
await prueba('rubros en pantalla: abren con lo que valen hoy (el monto puesto a mano o el del deal; vacío si no hay)', () => {
  assert.deepEqual(textos(rubrosDe({ ...dealMgmt, rubros: rubrosPorOmision() })), [['Management', '25000']]);
  assert.deepEqual(textos(rubrosDe({ ...dealMgmt, rubros: [{ rubro: 'Management', monto: 40000 }] })), [['Management', '40000']]);
  assert.deepEqual(textos(rubrosDe({ ...dealMgmt, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }, { rubro: 'Back office', monto: null }] })), [['Management', '25000'], ['Moderación', '8000'], ['Back office', '']]);
  assert.deepEqual(textos(rubrosDe({ rubrosDeal: {}, rubros: rubrosPorOmision() })), [['Management', '']]);
});
await prueba('rubros en pantalla: se agregan con el monto del deal, una sola vez, y siempre queda al menos uno', () => {
  let filas = rubrosDe({ ...dealMgmt, rubros: rubrosPorOmision() });
  filas = agregarRubro(filas, 'Moderación', DEAL);
  assert.deepEqual(textos(filas), [['Management', '25000'], ['Moderación', '8000']]);
  assert.equal(agregarRubro(filas, 'Moderación', DEAL).length, 2); // ya estaba
  filas = agregarRubro(filas, 'Back office', DEAL);
  assert.deepEqual(textos(filas).at(-1), ['Back office', '']); // el deal no lo trae
  assert.deepEqual(rubrosFaltantes(filas), ['Reclutamiento e incentivos', 'Logística y operación']);
  filas = quitarRubro(quitarRubro(filas, 'Management'), 'Back office');
  assert.deepEqual(textos(filas), [['Moderación', '8000']]);
  assert.deepEqual(textos(quitarRubro(filas, 'Moderación')), [['Moderación', '8000']]); // el último no se quita
  assert.deepEqual(textos(conTextoDeRubro(filas, 'Moderación', '5000')), [['Moderación', '5000']]);
});
await prueba('rubros en pantalla: el total suma los rubros (vacío = el del deal) y no vale si algo escrito no es un monto', () => {
  const filas = rubrosDe({ ...dealMgmt, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }] });
  assert.equal(totalDe(filas, DEAL), 33000);
  assert.equal(totalDe(conTextoDeRubro(filas, 'Management', ''), DEAL), 33000); // vacío = el del deal
  assert.equal(totalDe(conTextoDeRubro(filas, 'Management', '30,000'), DEAL), 38000);
  assert.equal(totalDe(conTextoDeRubro(filas, 'Moderación', 'abc'), DEAL), undefined);
  assert.equal(totalDe(rubrosDe({ rubrosDeal: {}, rubros: rubrosPorOmision() }), {}), 0);
});
await prueba('rubros en pantalla: «editado» solo donde el deal trae un monto y se cambió (o se cambió la moneda)', () => {
  const f = (rubro: FilaRubro['rubro'], texto: string): FilaRubro => ({ clave: 'x', rubro, texto });
  assert.equal(rubroEditado(f('Management', '25000'), DEAL, 'MXN', 'MXN'), false);
  assert.equal(rubroEditado(f('Management', '30000'), DEAL, 'MXN', 'MXN'), true);
  assert.equal(rubroEditado(f('Management', ''), DEAL, 'MXN', 'MXN'), false);
  assert.equal(rubroEditado(f('Back office', '3000'), DEAL, 'MXN', 'MXN'), false); // el deal no lo trae
  assert.equal(rubroEditado(f('Management', '25000'), DEAL, 'USD', 'MXN'), true); // otra moneda: ya no es lo del deal
  assert.equal(rubroEditado(f('Management', 'abc'), DEAL, 'MXN', 'MXN'), false);
});
await prueba('rubros en pantalla: se guarda null si vale el del deal (vacío o igual, en su moneda) y el monto escrito si no; la moneda solo si algo va a mano', () => {
  const guardado = (...pares: Array<[FilaRubro['rubro'], string]>) => pares.map(([rubro, texto]): FilaRubro => ({ clave: 'x', rubro, texto }));
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '25000']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: null }], moneda: null });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '25,000']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: null }], moneda: null });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: null }], moneda: null });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '40000']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: 40000 }], moneda: 'MXN' });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '25000'], ['Moderación', '5000']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: 5000 }], moneda: 'MXN' });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '25000'], ['Back office', '']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Back office', monto: null }], moneda: null });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '0']), 'MXN', { rubrosDeal: {}, monedaDeal: 'MXN' }), { rubros: [{ rubro: 'Management', monto: null }], moneda: null });
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '0']), 'MXN', dealMgmt), { rubros: [{ rubro: 'Management', monto: 0 }], moneda: 'MXN' });
  // Con una moneda distinta a la del deal todos los montos van a mano (vacío = 0).
  assert.deepEqual(rubrosAGuardar(guardado(['Management', '25000'], ['Moderación', '']), 'USD', dealMgmt), { rubros: [{ rubro: 'Management', monto: 25000 }, { rubro: 'Moderación', monto: 0 }], moneda: 'USD' });
  const malo = rubrosAGuardar(guardado(['Management', '25000'], ['Moderación', 'abc']), 'MXN', dealMgmt);
  assert.ok('error' in malo && /Moderación/.test(malo.error));
});
await prueba('filas: personasDe ignora los renglones vacíos, deja pasar un porcentaje de más (el tope lo pone validarReparto) y marca como NaN lo que no es un número', () => {
  const filas = [
    interno('u1', 'Ana', '50'),
    filaVacia(),
    fila({ tipo: 'externo', nombre: 'Luis', pct: '50%' }),
    fila({ tipo: 'sin', pct: 'abc' }),
    interno('u2', 'Beto', '150'),
    interno('u3', 'Carla', '12,5'),
  ];
  const p = personasDe(filas);
  assert.deepEqual(p.map((x) => [x.userId, x.nombre, x.externo]), [['u1', 'Ana', false], [null, 'Luis', true], [null, '', false], ['u2', 'Beto', false], ['u3', 'Carla', false]]);
  assert.deepEqual(p.map((x) => x.porcentaje).map((x) => (Number.isNaN(x) ? 'NaN' : x)), [50, 50, 'NaN', 150, 12.5]);
  assert.equal(validarReparto([p[3]]), null); // 150 % para una persona vale; solo se avisa
  assert.equal(validarReparto([{ ...p[3], porcentaje: 1500 }]), 'Un porcentaje no puede pasar de 1000.');
});

// ── deals que se fragmentan en proyectos: cuánto de lo cotizado ya está repartido ──
const proyectoDe = (codigo: string, extra: Partial<ProyectoManagement>): ProyectoManagement => ({
  repartoId: 'r-' + codigo, projectId: 'p-' + codigo, codigo, rubrosDeal: {}, monedaDeal: 'MXN', rubros: rubrosPorOmision(), moneda: 'MXN', personas: [], eliminado: false, ...extra,
});
const disponibleDe = (codigo: string, extra: Partial<ProyectoDisponible>): ProyectoDisponible => ({ projectId: 'p-' + codigo, codigo, monedaDeal: 'MXN', rubrosDeal: {}, ...extra });
const DEAL_X: DealManagement = { dealId: 'deal-1', nombre: 'Deal X', moneda: 'MXN', cotizado: 100000, unidades: [{ precio: 2000, cantidad: 10 }, { precio: 12000, cantidad: 5 }] };
await prueba('managementDe: de un proyecto solo cuenta su rubro Management, puesto a mano o el del deal (los demás rubros no restan de lo cotizado)', () => {
  assert.equal(managementDe({ rubrosDeal: DEAL, rubros: rubrosPorOmision() }), 25000);
  assert.equal(managementDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: 15000 }, { rubro: 'Moderación', monto: 5000 }] }), 15000);
  assert.equal(managementDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Moderación', monto: null }] }), 0);
  assert.equal(managementDe({ rubrosDeal: {}, rubros: rubrosPorOmision() }), 0);
  assert.equal(managementDe({ rubrosDeal: DEAL, rubros: [{ rubro: 'Management', monto: 0 }] }), 0);
});
await prueba('resumenDeDeal: suma lo que se llevan sus proyectos (con y sin reparto, sin los de otro deal ni los eliminados) y dice cuánto queda y qué porcentaje es', () => {
  const proyectos: ProyectoManagement[] = [
    proyectoDe('A', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 15000 }, { rubro: 'Moderación', monto: 5000 }], inicio: '2026-04-28', personas: [interna('u1', 'Ana', 100)] }),
    proyectoDe('B', { dealId: 'deal-1', rubrosDeal: mgmt(25000), inicio: '2026-06-09' }), // sigue a su deal (el vinculado): vale lo del deal, sin escribir nada
    proyectoDe('C', { dealId: 'deal-2', rubros: [{ rubro: 'Management', monto: 99999 }], inicio: '2026-07-01' }),
    proyectoDe('D', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 8000 }], eliminado: true, projectId: null }),
    proyectoDe('E', { dealId: null, rubros: [{ rubro: 'Management', monto: 7000 }] }),
    proyectoDe('F', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 5000 }] }), // sin fecha: va al final
  ];
  const sinMonto = [disponibleDe('G', { dealId: 'deal-1', inicio: '2026-09-01' })]; // del deal, pero todavía sin monto
  const r = resumenDeDeal(DEAL_X, proyectos, sinMonto);
  assert.deepEqual(r.proyectos.map((p) => [p.codigo, p.monto]), [['G', 0], ['B', 25000], ['A', 15000], ['F', 5000]]);
  assert.deepEqual([r.asignado, r.disponible, r.porcentaje], [45000, 55000, 45]);
  assert.deepEqual([r.proyectos[0].estadoReparto, r.proyectos[2].estadoReparto, r.proyectos[2].repartoId], ['sinRepartir', 'completo', 'r-A']);
  // Sin proyectos queda todo lo cotizado; y si se llevan más de lo cotizado queda negativo (se avisa, pero se deja).
  const vacio = resumenDeDeal(DEAL_X, [], []);
  assert.deepEqual([vacio.asignado, vacio.disponible, vacio.porcentaje, vacio.proyectos.length], [0, 100000, 0, 0]);
  const pasado = resumenDeDeal(DEAL_X, [proyectoDe('X', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 130000 }] })], []);
  assert.deepEqual([pasado.asignado, pasado.disponible, pasado.porcentaje], [130000, -30000, 130]);
  // Los centavos no se pierden; y sin cotizado no hay porcentaje que calcular.
  assert.equal(resumenDeDeal({ ...DEAL_X, cotizado: 100 }, [proyectoDe('Y', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 33.33 }] }), proyectoDe('Z', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 33.33 }] })], []).disponible, 33.34);
  assert.equal(resumenDeDeal({ ...DEAL_X, cotizado: 0 }, [], []).porcentaje, 0);
});
await prueba('estadoDeDeal: sin asignar, por asignar, completo (unos centavos no cuentan) y se pasa', () => {
  const e = (asignado: number, cotizado = 100) => estadoDeDeal({ asignado, disponible: cotizado - asignado });
  assert.deepEqual([e(0), e(40), e(100), e(99.996), e(100.004), e(100.5)], ['sinAsignar', 'parcial', 'completo', 'completo', 'completo', 'excedido']);
  assert.equal(estadoDeDeal({ asignado: 0, disponible: 0 }), 'sinAsignar'); // un deal sin Management cotizado y sin proyectos
});
await prueba('totalesDeDeals: cotizado, asignado, lo que falta y lo que se pasó, por moneda (un deal que se pasa no le resta a otro)', () => {
  const dolares: DealManagement = { ...DEAL_X, dealId: 'deal-usd', moneda: 'USD', cotizado: 1000 };
  const rs = [
    resumenDeDeal(DEAL_X, [proyectoDe('A', { dealId: 'deal-1', rubros: [{ rubro: 'Management', monto: 40000 }] })], []), // 40,000 de 100,000
    resumenDeDeal({ ...DEAL_X, dealId: 'deal-2', cotizado: 50000 }, [proyectoDe('B', { dealId: 'deal-2', rubros: [{ rubro: 'Management', monto: 60000 }] })], []), // se pasa 10,000
    resumenDeDeal(dolares, [], []),
  ];
  const t = totalesDeDeals(rs);
  assert.deepEqual([t.cotizado.MXN, t.asignado.MXN, t.porAsignar.MXN, t.excedido.MXN, t.dealsExcedidos], [150000, 100000, 60000, 10000, 1]);
  assert.deepEqual([t.cotizado.USD, t.asignado.USD, t.porAsignar.USD, t.excedido.USD], [1000, 0, 1000, 0]);
});
await prueba('dealAGuardar: el deal vinculado (o ninguno) no se guarda como asignado, porque el proyecto lo sigue; cualquier otro sí', () => {
  assert.equal(dealAGuardar('deal-1', 'deal-1'), null);
  assert.equal(dealAGuardar('', null), null);
  assert.equal(dealAGuardar('', undefined), null);
  assert.equal(dealAGuardar('deal-2', 'deal-1'), 'deal-2');
  assert.equal(dealAGuardar('deal-2', null), 'deal-2');
  assert.equal(dealAGuardar('', 'deal-1'), null); // sin elegir nada: sigue al vinculado
});

// ── endpoints, de punta a punta contra PGlite ────────────────────────────────
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
// Las tablas se crean con el SQL del propio script, no con una copia que se pueda desviar.
const script = fs.readFileSync(new URL('./add-pagos-management-tables.ts', import.meta.url), 'utf8');
const ddl = script.match(/pool\.query\(`([\s\S]*?)`\)/)?.[1];
assert.ok(ddl, 'no se encontró el SQL en add-pagos-management-tables.ts');

const id = async (sql: string, params: unknown[]) => (await pg.query<{ id: string }>(`${sql} returning id`, params as any)).rows[0].id;
const usuario = (email: string, nombre: string, apellido: string, departamento: string | null) =>
  id(`insert into users (email, first_name, last_name, "role", departamento) values ($1, $2, $3, 'Analista', $4)`, [email, nombre, apellido, departamento]);
const ana = await usuario('ana@ejemplo.test', 'Ana', 'Prueba', 'Análisis');
const beto = await usuario('beto@ejemplo.test', 'Beto', 'Prueba', 'Análisis');
const carla = await usuario('carla@ejemplo.test', 'Carla', 'Prueba', null);

const deal = (nombre: string, moneda: string) => id(`insert into deals (deal_name, client, currency) values ($1, 'Cliente Uno', $2)`, [nombre, moneda]);
const cotizacion = (dealId: string, incluida: boolean | null) =>
  id(`insert into cotizaciones (cotizacion_name, deal_id, status, currency, included) values ('Cotización', $1, 'Aprobada', 'MXN', $2)`, [dealId, incluida]);
const linea = (cotizacionId: string, rubro: string, subRubro: string, cantidad: number, componentes: number, costo: number, precio: number, enPresupuesto: boolean | null = null) =>
  pg.query(
    `insert into cotizacion_line_items (sub_rubro, cotizacion_id, rubro, cantidad, componentes, unit_cost, final_price, included_in_budget) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [subRubro, cotizacionId, rubro, cantidad, componentes, costo, precio, enPresupuesto],
  );
const proyectoBD = (codigo: string, cliente: string, inicio: string | null, dealId: string | null) =>
  id(`insert into projects (project_code, full_name, client, status, start_date, deal_vinculado_id) values ($1, $2, $3, 'En curso', $4, $5)`, [codigo, `${codigo} completo`, cliente, inicio, dealId]);

// Deal de ALFA (MXN): dos líneas de Management que cuentan (25,000 + 2×5,000), una de Moderación (8,000), una de Back office con costo 0 que no cuenta, y
// otras que no cuentan: una excluida del presupuesto y toda una cotización no incluida (o sin marcar).
const dealAlfa = await deal('Deal Alfa', 'MXN 🇲🇽');
const cAlfa = await cotizacion(dealAlfa, true);
await linea(cAlfa, 'Management', 'Management Cuali', 1, 1, 25000, 37500);
await linea(cAlfa, 'Management', 'Management Fase 2', 2, 1, 5000, 15000, true);
await linea(cAlfa, 'Moderación', 'Moderación', 1, 1, 8000, 12000);
await linea(cAlfa, 'Management', 'Excluida', 1, 1, 99999, 99999, false);
await linea(cAlfa, 'Back office', 'Sin costo', 1, 1, 0, 0);
await linea(await cotizacion(dealAlfa, false), 'Management', 'Otra cotización', 1, 1, 77777, 77777);
await linea(await cotizacion(dealAlfa, null), 'Management', 'Cotización sin marcar', 1, 1, 66666, 66666);
// Deal de BETA (USD).
const dealBeta = await deal('Deal Beta', 'USD 🇺🇸');
await linea(await cotizacion(dealBeta, true), 'Management', 'Management Cuali', 1, 1, 700, 1050);
// Deal de EPSILON, más viejo; deal de GAMA, sin management.
const dealEpsilon = await deal('Deal Epsilon', 'MXN 🇲🇽');
await linea(await cotizacion(dealEpsilon, true), 'Management', 'Management Cuali', 1, 1, 12000, 18000);
const dealGama = await deal('Deal Gama', 'MXN 🇲🇽');
await linea(await cotizacion(dealGama, true), 'Moderación', 'Moderación', 1, 1, 8000, 12000);

const alfa = await proyectoBD('ALFA', 'Cliente Uno', '2026-03-01', dealAlfa);
const beta = await proyectoBD('BETA', 'Cliente Dos', '2026-08-10', dealBeta);
const gama = await proyectoBD('GAMA', 'Cliente Tres', '2026-09-01', dealGama);
const delta = await proyectoBD('DELTA', 'Cliente Cuatro', null, null);
const epsilon = await proyectoBD('EPSILON', 'Cliente Cinco', '2025-01-15', dealEpsilon);

const sergio = { user: { id: 'u1', email: 'sergio@sapience.com.mx' } };
const otra = { user: { id: 'u2', email: 'alguien@ejemplo.test' } };
const sinSesion = { user: null };
const rechazadoPor = (codigo: string) => (e: unknown) => e instanceof ZiteError && e.code === codigo;
const leer = async (): Promise<any> => getPagosManagement.run({}, sergio);
const guardar = (entrada: Record<string, unknown>) => savePagosManagementReparto.run({ rubros: rubrosPorOmision(), moneda: null, personas: [], ...entrada } as any, sergio);
const proyecto_ = async (codigo: string) => (await leer()).proyectos.find((p: any) => p.codigo === codigo);
const ana100 = [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 100 }];
const filasEnBD = async (tabla: string) => Number((await pg.query<{ n: number }>(`select count(*)::int as n from ${tabla}`)).rows[0].n);

await prueba('sin las tablas: se pueden ver los proyectos con lo que dice su deal, y guardar dice qué falta', async () => {
  const r = await leer();
  assert.equal(r.sinTablas, true);
  assert.deepEqual(r.proyectos.map((p: any) => p.codigo), ['BETA', 'ALFA', 'EPSILON']);
  assert.deepEqual(r.proyectos.map((p: any) => p.repartoId), [null, null, null]);
  assert.deepEqual(r.proyectos[0].rubros, [{ rubro: 'Management', monto: null }]);
  await assert.rejects(() => guardar({ projectId: alfa, personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 50 }] }), (e: unknown) => e instanceof ZiteError && /add-pagos-management-tables/.test(e.message));
  await assert.rejects(() => guardar({ projectId: alfa }), (e: unknown) => e instanceof ZiteError && /add-pagos-management-tables/.test(e.message));
});

await pg.exec(ddl!);

await prueba('solo Sergio: otra persona y quien no ha entrado reciben «no autorizado» en los dos endpoints', async () => {
  for (const contexto of [otra, sinSesion]) {
    const codigo = contexto.user ? 'FORBIDDEN' : 'UNAUTHORIZED';
    await assert.rejects(() => getPagosManagement.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => savePagosManagementReparto.run({ projectId: alfa, rubros: rubrosPorOmision(), moneda: null, personas: [] }, contexto), rechazadoPor(codigo));
  }
});
await prueba('lo que dice el deal de cada rubro es lo de la pestaña Presupuesto: líneas de cotizaciones incluidas, con costo y no excluidas', async () => {
  const r = await leer();
  assert.equal(r.sinTablas, false);
  const alfa_ = r.proyectos.find((p: any) => p.codigo === 'ALFA');
  // Management: 25,000 + 2×5,000 (35,000; con markup 37,500 + 15,000); Moderación: 8,000. Sin Back office (costo 0), sin lo excluido ni lo de cotizaciones no incluidas.
  assert.deepEqual(alfa_.rubrosDeal, { Management: { costo: 35000, conMarkup: 52500 }, 'Moderación': { costo: 8000, conMarkup: 12000 } });
  assert.deepEqual([alfa_.monedaDeal, alfa_.moneda, alfa_.rubros], ['MXN', 'MXN', [{ rubro: 'Management', monto: null }]]);
  const beta_ = r.proyectos.find((p: any) => p.codigo === 'BETA');
  assert.deepEqual([beta_.rubrosDeal, beta_.monedaDeal, beta_.moneda], [{ Management: { costo: 700, conMarkup: 1050 } }, 'USD', 'USD']);
  assert.deepEqual([alfa_.nombre, alfa_.cliente, alfa_.estado, alfa_.inicio, alfa_.dealNombre], ['ALFA completo', 'Cliente Uno', 'En curso', '2026-03-01', 'Deal Alfa']);
});
await prueba('los proyectos con management van del más reciente al más viejo, y el resto queda disponible para agregarlo a mano (con lo que su deal trae)', async () => {
  const r = await leer();
  assert.deepEqual(r.proyectos.map((p: any) => p.codigo), ['BETA', 'ALFA', 'EPSILON']);
  // GAMA (su deal solo tiene Moderación) y DELTA (sin deal ni fecha, al final).
  assert.deepEqual(r.disponibles.map((p: any) => p.codigo), ['GAMA', 'DELTA']);
  assert.deepEqual(r.disponibles.map((p: any) => p.rubrosDeal), [{ 'Moderación': { costo: 8000, conMarkup: 12000 } }, {}]);
  assert.equal(r.disponibles[1].inicio, undefined);
  assert.deepEqual(r.usuarios.map((u: any) => u.nombre), ['Ana Prueba', 'Beto Prueba', 'Carla Prueba']);
  assert.equal(r.usuarios[0].departamento, 'Análisis');
  assert.equal(r.usuarios[2].departamento, undefined);
  assert.deepEqual(r.externos, []);
});
await prueba('guardar: el reparto de un proyecto con personas internas y externas, en orden, con el nombre de hoy de cada usuario', async () => {
  const r = await guardar({
    projectId: alfa,
    personas: [
      { userId: ana, nombre: 'nombre que manda la pantalla', externo: false, porcentaje: 50 },
      { userId: beto, nombre: '', externo: false, porcentaje: 30 },
      { userId: null, nombre: '  Luis Externo ', externo: true, porcentaje: 20 },
    ],
  });
  assert.deepEqual(r, { ok: true, eliminado: false });
  const p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, p.moneda], [[{ rubro: 'Management', monto: null }], 'MXN']);
  assert.deepEqual(p.personas.map((x: any) => [x.userId, x.nombre, x.externo, x.porcentaje]), [[ana, 'Ana Prueba', false, 50], [beto, 'Beto Prueba', false, 30], [null, 'Luis Externo', true, 20]]);
  assert.ok(p.repartoId);
  assert.deepEqual((await leer()).externos, ['Luis Externo']);
});
await prueba('guardar de nuevo reemplaza el reparto (una sola fila por proyecto) y un monto puesto a mano manda sobre el del deal', async () => {
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Management', monto: 40000 }], moneda: 'MXN', personas: [{ userId: carla, nombre: 'Carla', externo: false, porcentaje: 100 }] });
  const p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, p.moneda, p.rubrosDeal.Management.costo], [[{ rubro: 'Management', monto: 40000 }], 'MXN', 35000]);
  assert.equal(presupuestoDe(p), 40000);
  assert.deepEqual(p.personas.map((x: any) => [x.nombre, x.porcentaje]), [['Carla Prueba', 100]]);
  assert.equal(await filasEnBD('pagos_management_proyectos'), 1);
  assert.equal(await filasEnBD('pagos_management_personas'), 1);
  assert.equal(await filasEnBD('pagos_management_rubros'), 1);
});
await prueba('se le suma otro rubro de la cotización: el presupuesto es la suma, cada rubro con el monto del deal o con uno puesto a mano, y se conserva el orden', async () => {
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }], moneda: null, personas: ana100 });
  let p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, p.moneda, presupuestoDe(p), esEditado(p)], [[{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: null }], 'MXN', 43000, false]);
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: 5000 }], moneda: 'MXN', personas: ana100 });
  p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, p.moneda, presupuestoDe(p), esEditado(p)], [[{ rubro: 'Management', monto: null }, { rubro: 'Moderación', monto: 5000 }], 'MXN', 40000, true]);
  // Un rubro que el deal no trae, con el monto que se le ponga; y en otro orden.
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Back office', monto: 3000 }, { rubro: 'Management', monto: null }], moneda: 'MXN', personas: ana100 });
  p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros.map((r: any) => r.rubro), presupuestoDe(p)], [['Back office', 'Management'], 38000]);
  assert.equal(await filasEnBD('pagos_management_rubros'), 2); // reemplaza, no acumula filas
  // Sin Management: solo lo que se agregó.
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Moderación', monto: null }], personas: ana100 });
  assert.equal(presupuestoDe(await proyecto_('ALFA')), 8000);
});
await prueba('la moneda solo se guarda si algún monto va a mano; con otra moneda que la del deal todos van a mano', async () => {
  // BETA es de un deal en USD.
  await guardar({ projectId: beta, rubros: rubrosPorOmision(), moneda: 'USD', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 60 }] });
  let p = await proyecto_('BETA');
  assert.deepEqual([p.rubros, p.moneda, p.monedaDeal], [[{ rubro: 'Management', monto: null }], 'USD', 'USD']);
  assert.equal((await pg.query<{ moneda: string | null }>(`select moneda from pagos_management_proyectos where project_id = $1`, [beta])).rows[0].moneda, null); // vale la del deal: no se guarda
  // Con montos del deal no se puede pedir otra moneda: los montos del deal están en USD.
  await assert.rejects(() => guardar({ projectId: beta, rubros: rubrosPorOmision(), moneda: 'EUR', personas: ana100 }), rechazadoPor('BAD_REQUEST'));
  await assert.rejects(() => guardar({ projectId: beta, rubros: [{ rubro: 'Management', monto: 15000 }, { rubro: 'Moderación', monto: null }], moneda: 'MXN', personas: ana100 }), rechazadoPor('BAD_REQUEST'));
  // En pesos, con todos los montos escritos.
  await guardar({ projectId: beta, rubros: [{ rubro: 'Management', monto: 15000 }], moneda: 'MXN', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 60 }] });
  p = await proyecto_('BETA');
  assert.deepEqual([p.rubros, p.moneda, presupuestoDe(p)], [[{ rubro: 'Management', monto: 15000 }], 'MXN', 15000]);
  // Un monto a mano sin decir moneda vale en la del deal.
  await guardar({ projectId: beta, rubros: [{ rubro: 'Management', monto: 800 }], moneda: null, personas: [] });
  assert.equal((await proyecto_('BETA')).moneda, 'USD');
});
await prueba('un monto en cero puesto a mano se conserva (no se confunde con «el del deal»)', async () => {
  await guardar({ projectId: beta, rubros: [{ rubro: 'Management', monto: 0 }], moneda: 'USD', personas: ana100 });
  const p = await proyecto_('BETA');
  assert.deepEqual([p.rubros, p.moneda, presupuestoDe(p)], [[{ rubro: 'Management', monto: 0 }], 'USD', 0]);
  await guardar({ projectId: beta, rubros: rubrosPorOmision(), moneda: null, personas: [] });
});
await prueba('quitar todo (solo el Management del deal sin tocar y sin personas) borra el reparto y el proyecto vuelve a «sin repartir»', async () => {
  assert.deepEqual(await guardar({ projectId: alfa, personas: [] }), { ok: true, eliminado: true });
  const p = await proyecto_('ALFA');
  assert.deepEqual([p.repartoId, p.rubros, p.personas], [null, [{ rubro: 'Management', monto: null }], []]);
  // Con el reparto se van sus personas y sus rubros (y no queda ningún otro: BETA ya se había quitado).
  assert.deepEqual([await filasEnBD('pagos_management_proyectos'), await filasEnBD('pagos_management_personas'), await filasEnBD('pagos_management_rubros')], [0, 0, 0]);
  assert.deepEqual(await guardar({ projectId: alfa, personas: [] }), { ok: true, eliminado: true }); // otra vez, sin nada que borrar
});
await prueba('un proyecto sin management en su deal se agrega a mano con un presupuesto, o con otro rubro del deal: sale de «disponibles» y entra a la lista', async () => {
  await guardar({ projectId: gama, rubros: [{ rubro: 'Management', monto: 5000 }], moneda: 'MXN', personas: [] });
  let r = await leer();
  assert.deepEqual(r.disponibles.map((p: any) => p.codigo), ['DELTA']);
  let p = r.proyectos.find((x: any) => x.codigo === 'GAMA');
  assert.deepEqual([p.rubros, p.personas, presupuestoDe(p)], [[{ rubro: 'Management', monto: 5000 }], [], 5000]);
  assert.ok(p.repartoId);
  // Con el rubro que su deal sí trae (Moderación) y sin Management, aunque no tenga personas se conserva: ya no es «el de siempre».
  await guardar({ projectId: gama, rubros: [{ rubro: 'Moderación', monto: null }], personas: [] });
  p = await proyecto_('GAMA');
  assert.deepEqual([p.rubros, presupuestoDe(p)], [[{ rubro: 'Moderación', monto: null }], 8000]);
  assert.ok(p.repartoId);
  await guardar({ projectId: gama, personas: [] }); // quitarlo
  r = await leer();
  assert.deepEqual(r.disponibles.map((x: any) => x.codigo), ['GAMA', 'DELTA']);
});
await prueba('se puede pasar de 100 %: el servidor lo guarda, los montos salen del porcentaje de cada quien y la restricción de la base lo permite hasta el tope', async () => {
  await guardar({
    projectId: alfa,
    personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 60 }, { userId: beto, nombre: 'Beto', externo: false, porcentaje: 50 }], // 110 %
  });
  let p = await proyecto_('ALFA');
  assert.deepEqual(p.personas.map((x: any) => [x.nombre, x.porcentaje]), [['Ana Prueba', 60], ['Beto Prueba', 50]]);
  assert.equal(estadoReparto(p.personas), 'excedido');
  assert.deepEqual(acumuladoPorPersona([p]).map((x) => [x.nombre, x.porMoneda.MXN]), [['Ana Prueba', 21000], ['Beto Prueba', 17500]]); // sobre los 35,000 del deal
  assert.deepEqual([totalesPorMoneda([p]).repartido.MXN, totalesPorMoneda([p]).excedido.MXN, totalesPorMoneda([p]).proyectosExcedidos], [38500, 3500, 1]);
  // Una sola persona con más del presupuesto.
  await guardar({ projectId: alfa, personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 150 }] });
  p = await proyecto_('ALFA');
  assert.deepEqual(p.personas.map((x: any) => x.porcentaje), [150]);
  // En la base: hasta 1000 % cabe y más no.
  await pg.query(`update pagos_management_personas set porcentaje = 1000 where reparto_id = $1`, [p.repartoId]);
  await assert.rejects(() => pg.query(`update pagos_management_personas set porcentaje = 1000.01 where reparto_id = $1`, [p.repartoId]), /porcentaje_chk/);
  await guardar({ projectId: alfa, personas: [] });
});
await prueba('validaciones del servidor: porcentajes absurdos, personas repetidas, usuario que no existe, nombre vacío, rubros mal puestos y datos mal formados', async () => {
  const ana_ = (porcentaje: number) => ({ userId: ana, nombre: 'Ana', externo: false, porcentaje });
  const casos: Array<[string, Record<string, unknown>]> = [
    ['repetida', { personas: [ana_(30), ana_(30)] }],
    ['externa repetida', { personas: [{ userId: null, nombre: 'Luis', externo: true, porcentaje: 30 }, { userId: null, nombre: 'LUIS ', externo: true, porcentaje: 30 }] }],
    ['usuario inexistente', { personas: [{ userId: '00000000-0000-4000-8000-000000000000', nombre: 'Nadie', externo: false, porcentaje: 50 }] }],
    ['externa sin nombre', { personas: [{ userId: null, nombre: '  ', externo: true, porcentaje: 50 }] }],
    ['interna sin usuario', { personas: [{ userId: null, nombre: 'Ana', externo: false, porcentaje: 50 }] }],
    ['porcentaje 0', { personas: [ana_(0)] }],
    ['porcentaje 1001', { personas: [ana_(1001)] }],
    ['monto negativo', { rubros: [{ rubro: 'Management', monto: -1 }], personas: [] }],
    ['rubro inventado', { rubros: [{ rubro: 'Inventado', monto: 5 }], personas: [] }],
    ['sin rubros', { rubros: [], personas: [] }],
    ['rubro repetido', { rubros: [{ rubro: 'Moderación', monto: null }, { rubro: 'Moderación', monto: 5 }], personas: [] }],
    ['moneda inventada', { rubros: [{ rubro: 'Management', monto: 100 }], moneda: 'JPY', personas: [] }],
    ['moneda distinta con montos del deal', { rubros: [{ rubro: 'Management', monto: null }], moneda: 'USD', personas: ana100 }],
    ['proyecto mal formado', { projectId: 'no-es-un-id', personas: [ana_(50)] }],
  ];
  for (const [nombre, extra] of casos) await assert.rejects(() => guardar({ projectId: alfa, ...extra }), rechazadoPor('BAD_REQUEST'), nombre);
  await assert.rejects(() => guardar({ projectId: '00000000-0000-4000-8000-000000000000', personas: [ana_(50)] }), rechazadoPor('NOT_FOUND'));
  // Nada de eso dejó basura.
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_proyectos where project_id = $1`, [alfa])).rows[0].n), 0);
});
await prueba('si algo falla a medias no queda un reparto a medias (la transacción se deshace, rubros incluidos)', async () => {
  await guardar({ projectId: alfa, personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 70 }] });
  const antes = await proyecto_('ALFA');
  const enviado: string[] = [];
  (pool as any).connect = async () => ({
    query: async (sql: string, params?: unknown[]) => {
      enviado.push(sql.trim().split(/\s+/)[0].toLowerCase());
      if (/insert into pagos_management_personas/.test(sql)) throw new Error('falla simulada');
      return q(sql, params);
    },
    release: () => {},
  });
  await assert.rejects(() => guardar({ projectId: alfa, rubros: [{ rubro: 'Management', monto: 99999 }, { rubro: 'Moderación', monto: null }], moneda: 'MXN', personas: [{ userId: beto, nombre: 'Beto', externo: false, porcentaje: 10 }] }), /falla simulada/);
  (pool as any).connect = async () => ({ query: q, release: () => {} });
  assert.deepEqual(enviado.filter((s) => s === 'begin' || s === 'rollback' || s === 'commit'), ['begin', 'rollback']);
  assert.deepEqual(await proyecto_('ALFA'), antes);
  await guardar({ projectId: alfa, personas: [] });
});
await prueba('si se elimina un proyecto con reparto, el reparto se conserva con el código y los rubros que tenía', async () => {
  await guardar({ projectId: epsilon, rubros: [{ rubro: 'Management', monto: 9000 }], moneda: 'MXN', personas: ana100 });
  await pg.query(`delete from projects where id = $1`, [epsilon]);
  const r = await leer();
  const huerfano = r.proyectos.find((p: any) => p.codigo === 'EPSILON');
  assert.deepEqual([huerfano.eliminado, huerfano.projectId, huerfano.rubros, huerfano.rubrosDeal, huerfano.personas.map((x: any) => x.nombre)], [true, null, [{ rubro: 'Management', monto: 9000 }], {}, ['Ana Prueba']]);
  assert.equal(presupuestoDe(huerfano), 9000);
  assert.deepEqual(r.proyectos.filter((p: any) => !p.eliminado).map((p: any) => p.codigo), ['BETA', 'ALFA']);
});
await prueba('si se borra un usuario, su reparto sigue con el nombre que tenía al repartir', async () => {
  await guardar({ projectId: alfa, personas: [{ userId: carla, nombre: 'Carla', externo: false, porcentaje: 100 }] });
  await pg.query(`delete from users where id = $1`, [carla]);
  const p = await proyecto_('ALFA');
  assert.deepEqual(p.personas.map((x: any) => [x.userId, x.nombre, x.externo]), [[null, 'Carla Prueba', false]]);
  assert.deepEqual((await leer()).usuarios.map((u: any) => u.nombre), ['Ana Prueba', 'Beto Prueba']);
});
await prueba('un reparto de la primera versión (un solo presupuesto, sin rubros) se pasa a rubros al correr el script otra vez, sin duplicarse', async () => {
  await guardar({ projectId: alfa, personas: [] }); // se quita el de ALFA para poder escribir el de la primera versión
  await pg.query(`insert into pagos_management_proyectos (project_id, project_codigo, presupuesto, moneda) values ($1, 'ALFA', 12345, 'MXN')`, [alfa]);
  // Con la restricción de la primera versión (hasta 100 %) un reparto que se pasa no cabe; el script la cambia por la nueva (hasta 1000 %).
  await pg.exec(`alter table pagos_management_personas drop constraint pagos_management_personas_porcentaje_chk;
                 alter table pagos_management_personas add constraint pagos_management_personas_porcentaje_chk check (porcentaje > 0 and porcentaje <= 100)`);
  const repartoViejo = (await pg.query<{ id: string }>(`select id from pagos_management_proyectos where project_id = $1`, [alfa])).rows[0].id;
  await assert.rejects(() => pg.query(`insert into pagos_management_personas (reparto_id, nombre, porcentaje) values ($1, 'Alguien', 120)`, [repartoViejo]), /porcentaje_chk/);
  // Antes de pasarlo no tiene rubros guardados: vale lo de siempre, el Management del deal.
  let p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, presupuestoDe(p)], [[{ rubro: 'Management', monto: null }], 35000]);
  await pg.exec(ddl!);
  await pg.query(`insert into pagos_management_personas (reparto_id, nombre, porcentaje) values ($1, 'Alguien', 120)`, [repartoViejo]); // ya cabe
  await pg.query(`delete from pagos_management_personas where reparto_id = $1`, [repartoViejo]);
  p = await proyecto_('ALFA');
  assert.deepEqual([p.rubros, p.moneda, presupuestoDe(p)], [[{ rubro: 'Management', monto: 12345 }], 'MXN', 12345]);
  await pg.exec(ddl!); // el script se puede correr las veces que haga falta
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_rubros r join pagos_management_proyectos x on x.id = r.reparto_id where x.project_id = $1`, [alfa])).rows[0].n), 1);
  // Guardar lo limpia: el monto de la primera versión ya no se usa.
  await guardar({ projectId: alfa, rubros: [{ rubro: 'Management', monto: 20000 }], moneda: 'MXN', personas: ana100 });
  assert.equal((await pg.query<{ presupuesto: number | null }>(`select presupuesto from pagos_management_proyectos where project_id = $1`, [alfa])).rows[0].presupuesto, null);
  await guardar({ projectId: alfa, personas: [] });
});
await prueba('si falta la tabla de rubros (el código nuevo antes que el script) la pantalla se ve, avisa y no guarda; con el script todo vuelve', async () => {
  await pg.exec(`drop table pagos_management_rubros`);
  const r = await leer();
  assert.equal(r.sinTablas, true);
  assert.deepEqual(r.proyectos.map((p: any) => p.repartoId), r.proyectos.map(() => null));
  await assert.rejects(() => guardar({ projectId: alfa, personas: ana100 }), (e: unknown) => e instanceof ZiteError && /add-pagos-management-tables/.test(e.message));
  await pg.exec(ddl!);
  assert.equal((await leer()).sinTablas, false);
});

// ── deals que se fragmentan en proyectos, de punta a punta ───────────────────
// «Deal Fragmentado»: 40 sesiones a $2,000 y 6 a $12,000 (152,000 de Management); una línea excluida y otra de Moderación no cuentan. «Deal Chico» es chico
// (2 × 3 × $1,000 = 6,000) para probar que se puede pasar. «Deal Prospecto» no está ganado ni tiene proyectos: no se ofrece. «Deal Gemelo» tiene dos
// proyectos vinculados (se fragmenta sin que nadie asigne nada).
const dealGanado = async (nombre: string, fase: string) => {
  const d = await deal(nombre, 'MXN 🇲🇽');
  await pg.query(`update deals set phase = $2, approval_date = $3 where id = $1`, [d, fase, nombre === 'Deal Fragmentado' ? '2026-01-01' : null]);
  return d;
};
const dealUno = await dealGanado('Deal Fragmentado', 'Ganado');
const cUno = await cotizacion(dealUno, true);
await linea(cUno, 'Management', 'Management por sesión A', 40, 1, 2000, 120000);
await linea(cUno, 'Management', 'Management por sesión B', 6, 1, 12000, 108000);
await linea(cUno, 'Management', 'Excluida', 1, 1, 99999, 99999, false);
await linea(cUno, 'Moderación', 'Moderación', 1, 1, 8000, 12000);
const dealDos = await dealGanado('Deal Chico', 'Ganado');
await linea(await cotizacion(dealDos, true), 'Management', 'Con componentes', 2, 3, 1000, 1500);
const dealProspecto = await dealGanado('Deal Prospecto', 'Prospecto');
await linea(await cotizacion(dealProspecto, true), 'Management', 'Management', 1, 1, 5000, 7500);
const dealLineal = await dealGanado('Deal Lineal', 'Ganado');
await linea(await cotizacion(dealLineal, true), 'Management', 'Management', 1, 1, 25000, 37500);
const dealGemelo = await dealGanado('Deal Gemelo', 'Ganado');
await linea(await cotizacion(dealGemelo, true), 'Management', 'Management', 1, 1, 40000, 60000);

const prog1 = await proyectoBD('PROG-1', 'Cliente Uno', '2026-04-28', null);
const prog2 = await proyectoBD('PROG-2', 'Cliente Uno', '2026-05-29', null);
const lineal = await proyectoBD('LINEAL', 'Cliente Uno', '2026-06-09', dealLineal);
const madre = await proyectoBD('MADRE', 'Cliente Uno', '2026-01-12', dealUno); // el proyecto del propio deal fragmentado, sin reparto
const gemeloA = await proyectoBD('GEMELO-A', 'Cliente Uno', '2026-02-01', dealGemelo);
const gemeloB = await proyectoBD('GEMELO-B', 'Cliente Uno', '2026-02-02', dealGemelo);
const unaPersona = [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 100 }];
const resumen = async (dealId: string) => {
  const r = await leer();
  const d = r.deals.find((x: any) => x.dealId === dealId);
  assert.ok(d, 'el deal no salió en la lista');
  return resumenDeDeal(d, r.proyectos, r.disponibles);
};
const en = async (codigo: string) => { const r = await leer(); return r.proyectos.find((p: any) => p.codigo === codigo) ?? r.disponibles.find((p: any) => p.codigo === codigo); };

await prueba('deals: salen los ganados con Management cotizado y los que ya tienen proyecto, con lo cotizado, cómo se cotizó y cuándo se aprobó; no los que no tienen nada de eso', async () => {
  const r = await leer();
  const nombres = r.deals.map((x: any) => x.nombre);
  for (const esperado of ['Deal Fragmentado', 'Deal Chico', 'Deal Lineal', 'Deal Gemelo', 'Deal Alfa']) assert.ok(nombres.includes(esperado), `${esperado} no salió: ${nombres.join(', ')}`); // Deal Alfa no está ganado, pero es el de un proyecto
  for (const ausente of ['Deal Prospecto', 'Deal Gama']) assert.ok(!nombres.includes(ausente), `${ausente} no debía salir`); // sin ganar y sin proyectos / sin Management
  const uno = r.deals.find((x: any) => x.nombre === 'Deal Fragmentado');
  assert.deepEqual([uno.dealId, uno.cliente, uno.moneda, uno.cotizado, uno.inicio], [dealUno, 'Cliente Uno', 'MXN', 152000, '2026-01-01']);
  assert.deepEqual(uno.unidades, [{ precio: 2000, cantidad: 40 }, { precio: 12000, cantidad: 6 }]);
  const dos = r.deals.find((x: any) => x.nombre === 'Deal Chico');
  assert.deepEqual([dos.cotizado, dos.unidades, dos.inicio], [6000, [{ precio: 1000, cantidad: 6 }], undefined]); // cantidad × componentes; sin fecha de aprobación
});
await prueba('todos los proyectos salen (con o sin deal) y cada uno trae su deal: el vinculado, y de ahí el monto por omisión', async () => {
  const l = await en('LINEAL');
  assert.deepEqual([l.dealId, l.dealVinculadoId, l.dealAsignadoId, l.dealNombre, l.dealFragmentado], [dealLineal, dealLineal, null, 'Deal Lineal', undefined]);
  assert.equal(managementDe(l), 25000); // sin escribir nada: lo que cotizó su deal
  const sin = await en('PROG-1');
  assert.deepEqual([sin.dealId, sin.dealVinculadoId, sin.dealAsignadoId, sin.dealNombre], [null, null, null, undefined]); // sin deal: un proyecto más para asignar
  const r = await leer();
  assert.ok(r.disponibles.some((p: any) => p.codigo === 'PROG-1') && r.proyectos.some((p: any) => p.codigo === 'LINEAL'));
  // El deal de un solo proyecto (lineal) está repartido al 100 %.
  const resumenLineal = await resumen(dealLineal);
  assert.deepEqual([resumenLineal.asignado, resumenLineal.disponible, resumenLineal.porcentaje, estadoDeDeal(resumenLineal), resumenLineal.proyectos.map((x) => x.codigo)], [25000, 0, 100, 'completo', ['LINEAL']]);
  // Antes de que otro proyecto salga de su deal, el proyecto del deal fragmentado tiene toda la cotización como suya.
  assert.equal(managementDe(await en('MADRE')), 152000);
  assert.equal((await en('MADRE')).dealFragmentado, undefined);
});
await prueba('a un proyecto sin deal se le asigna uno y se escribe cuánto se lleva: el deal lo suma y le queda lo demás', async () => {
  assert.deepEqual(await guardar({ projectId: prog1, dealId: dealUno, rubros: [{ rubro: 'Management', monto: 15000 }], moneda: 'MXN', personas: unaPersona }), { ok: true, eliminado: false });
  const p = await en('PROG-1');
  assert.deepEqual([p.dealId, p.dealAsignadoId, p.dealVinculadoId, p.dealNombre, p.rubros, p.moneda, presupuestoDe(p)], [dealUno, dealUno, null, 'Deal Fragmentado', [{ rubro: 'Management', monto: 15000 }], 'MXN', 15000]);
  assert.equal((await pg.query<{ d: string | null }>(`select deal_asignado_id as d from projects where id = $1`, [prog1])).rows[0].d, dealUno);
  const r = await resumen(dealUno);
  assert.deepEqual([r.asignado, r.disponible, r.porcentaje.toFixed(2), estadoDeDeal(r)], [15000, 137000, '9.87', 'parcial']);
  assert.deepEqual(r.proyectos.map((x) => [x.codigo, x.monto]), [['PROG-1', 15000], ['MADRE', 0]]); // MADRE, sin monto todavía
});
await prueba('un deal con varios proyectos se fragmenta: ya no le ofrece su Management completo a quien no tiene reparto, pero respeta el reparto que ya estaba guardado', async () => {
  // MADRE (vinculado, sin reparto): ahora el deal tiene dos proyectos, así que la cotización completa deja de ser suya.
  const m = await en('MADRE');
  assert.deepEqual([m.dealFragmentado, m.rubrosDeal.Management, m.dealId], [true, undefined, dealUno]);
  assert.ok((await leer()).disponibles.some((x: any) => x.codigo === 'MADRE')); // sin monto: vuelve a «por asignar»
  assert.equal((await en('PROG-1')).dealFragmentado, true);
  // Deal Gemelo: dos proyectos vinculados sin que nadie asigne nada. El que ya tenía reparto guardado sigue con el monto del deal; el otro no.
  await guardar({ projectId: gemeloA, personas: unaPersona });
  const a = await en('GEMELO-A');
  const b = await en('GEMELO-B');
  assert.deepEqual([a.dealFragmentado, managementDe(a), b.dealFragmentado, b.rubrosDeal.Management], [true, 40000, true, undefined]);
  assert.deepEqual((await leer()).disponibles.some((x: any) => x.codigo === 'GEMELO-B'), true); // B no tiene reparto ni monto: queda «por asignar»
  const g = await resumen(dealGemelo);
  assert.deepEqual([g.asignado, g.disponible, g.proyectos.map((x) => x.codigo)], [40000, 0, ['GEMELO-B', 'GEMELO-A']]);
  // Cuando B escribe lo que se lleva (se asigna el mismo deal), el deal se pasa y se ve.
  await guardar({ projectId: gemeloB, rubros: [{ rubro: 'Management', monto: 10000 }], moneda: 'MXN', personas: unaPersona });
  const pasado = await resumen(dealGemelo);
  assert.deepEqual([pasado.asignado, pasado.disponible, estadoDeDeal(pasado)], [50000, -10000, 'excedido']);
  assert.equal((await en('GEMELO-B')).dealAsignadoId, null); // sigue a su deal vinculado: no hace falta asignarle nada
});
await prueba('varios proyectos suman en el deal, del más reciente al más viejo, y cada uno puede abrirse como un proyecto más', async () => {
  await guardar({ projectId: prog2, dealId: dealUno, rubros: [{ rubro: 'Management', monto: 9000 }], moneda: 'MXN', personas: unaPersona });
  const r = await resumen(dealUno);
  assert.deepEqual(r.proyectos.map((x) => [x.codigo, x.monto]), [['PROG-2', 9000], ['PROG-1', 15000], ['MADRE', 0]]);
  assert.deepEqual([r.asignado, r.disponible], [24000, 128000]);
});
await prueba('los demás rubros de un proyecto no restan de lo cotizado de Management del deal', async () => {
  await guardar({ projectId: prog1, dealId: dealUno, rubros: [{ rubro: 'Management', monto: 15000 }, { rubro: 'Moderación', monto: 5000 }], moneda: 'MXN', personas: unaPersona });
  const p = await en('PROG-1');
  assert.deepEqual([presupuestoDe(p), managementDe(p)], [20000, 15000]);
  assert.equal((await resumen(dealUno)).asignado, 24000);
  await guardar({ projectId: prog1, dealId: dealUno, rubros: [{ rubro: 'Management', monto: 15000 }], moneda: 'MXN', personas: unaPersona });
});
await prueba('asignar el deal vinculado (o ninguno) no se guarda como asignado: el proyecto sigue a su vínculo; sin mandar el deal no se toca; null lo quita', async () => {
  await guardar({ projectId: lineal, dealId: dealLineal, personas: unaPersona }); // es el suyo: nada que guardar
  assert.equal((await en('LINEAL')).dealAsignadoId, null);
  await guardar({ projectId: lineal, dealId: dealDos, rubros: [{ rubro: 'Management', monto: 3000 }], moneda: 'MXN', personas: unaPersona }); // otro deal: se guarda
  let l = await en('LINEAL');
  assert.deepEqual([l.dealId, l.dealAsignadoId, l.dealVinculadoId, l.dealNombre, managementDe(l)], [dealDos, dealDos, dealLineal, 'Deal Chico', 3000]);
  assert.equal((await resumen(dealLineal)).proyectos.length, 0); // ya no es de su deal vinculado
  await guardar({ projectId: lineal, rubros: [{ rubro: 'Management', monto: 3500 }], moneda: 'MXN', personas: unaPersona }); // sin deal: no se toca
  assert.equal((await en('LINEAL')).dealAsignadoId, dealDos);
  await guardar({ projectId: lineal, dealId: dealLineal, rubros: rubrosPorOmision(), moneda: null, personas: unaPersona }); // vuelve al vinculado
  l = await en('LINEAL');
  assert.deepEqual([l.dealId, l.dealAsignadoId, managementDe(l)], [dealLineal, null, 25000]);
  assert.equal((await pg.query<{ d: string | null }>(`select deal_asignado_id as d from projects where id = $1`, [lineal])).rows[0].d, null);
  await guardar({ projectId: lineal, dealId: null, personas: [] }); // quitarlo todo
});
await prueba('se puede pasar de lo cotizado: se guarda y lo que queda sale negativo', async () => {
  await guardar({ projectId: prog2, dealId: dealDos, rubros: [{ rubro: 'Management', monto: 8000 }], moneda: 'MXN', personas: unaPersona });
  const r = await resumen(dealDos);
  assert.deepEqual([r.deal.cotizado, r.asignado, r.disponible, estadoDeDeal(r)], [6000, 8000, -2000, 'excedido']);
});
await prueba('validaciones del deal asignado: sin monto, en otra moneda, sin Management, deal que no existe, sin Management cotizado o mal formado', async () => {
  const sinMonto = { projectId: prog2, dealId: dealUno, rubros: rubrosPorOmision(), moneda: null, personas: unaPersona }; // otro deal: no hay «el del deal» (sería toda la cotización)
  await assert.rejects(() => guardar(sinMonto), (e: unknown) => rechazadoPor('BAD_REQUEST')(e) && /cuánto Management/.test((e as Error).message));
  await assert.rejects(() => guardar({ ...sinMonto, rubros: [{ rubro: 'Management', monto: 0 }], moneda: 'MXN' }), rechazadoPor('BAD_REQUEST'));
  await assert.rejects(() => guardar({ ...sinMonto, rubros: [{ rubro: 'Management', monto: 5000 }], moneda: 'USD' }), (e: unknown) => rechazadoPor('BAD_REQUEST')(e) && /está en MXN/.test((e as Error).message));
  await assert.rejects(() => guardar({ ...sinMonto, rubros: [{ rubro: 'Moderación', monto: 5000 }], moneda: 'MXN' }), (e: unknown) => rechazadoPor('BAD_REQUEST')(e) && /rubro Management/.test((e as Error).message));
  await assert.rejects(() => guardar({ ...sinMonto, dealId: '00000000-0000-4000-8000-000000000000', rubros: [{ rubro: 'Management', monto: 5000 }], moneda: 'MXN' }), (e: unknown) => rechazadoPor('BAD_REQUEST')(e) && /ya no existe/.test((e as Error).message));
  await assert.rejects(() => guardar({ ...sinMonto, dealId: dealGama, rubros: [{ rubro: 'Management', monto: 5000 }], moneda: 'MXN' }), (e: unknown) => rechazadoPor('BAD_REQUEST')(e) && /no tiene Management cotizado/.test((e as Error).message));
  await assert.rejects(() => guardar({ ...sinMonto, dealId: 'no-es-un-id', rubros: [{ rubro: 'Management', monto: 5000 }], moneda: 'MXN' }), rechazadoPor('BAD_REQUEST'));
  // Nada de eso cambió el deal de nadie.
  assert.equal((await en('PROG-2')).dealAsignadoId, dealDos);
  assert.equal((await resumen(dealUno)).asignado, 15000 + 0); // PROG-1; PROG-2 se movió a Deal Chico
});
await prueba('si se borra el deal asignado, el proyecto vuelve a seguir a su deal vinculado (o a quedar sin deal) y conserva su reparto', async () => {
  await pg.query(`delete from deals where id = $1`, [dealDos]);
  const p = await en('PROG-2');
  assert.deepEqual([p.dealId, p.dealAsignadoId, p.dealNombre, p.rubros, p.personas.length], [null, null, undefined, [{ rubro: 'Management', monto: 8000 }], 1]);
  assert.ok(!(await leer()).deals.some((x: any) => x.dealId === dealDos));
});
await prueba('«quitar reparto» con el deal en null deja al proyecto como si nunca se le hubiera asignado uno', async () => {
  assert.deepEqual(await guardar({ projectId: prog1, dealId: null, personas: [] }), { ok: true, eliminado: true });
  const r = await leer();
  assert.equal(r.proyectos.find((x: any) => x.codigo === 'PROG-1'), undefined); // sin reparto y sin monto: otra vez un proyecto más por asignar
  const p = r.disponibles.find((x: any) => x.codigo === 'PROG-1');
  assert.deepEqual([p.dealId, p.dealAsignadoId, p.dealNombre], [null, null, undefined]);
  assert.deepEqual((await resumen(dealUno)).proyectos.map((x) => x.codigo), ['MADRE']);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
