// Pruebas del módulo «Pagos de análisis / management»: las reglas del reparto (src/lib/pagosManagement), y los endpoints de punta a punta contra una
// base en memoria (PGlite) con el esquema real: de dónde sale el monto de management de un deal, guardar y leer repartos, validaciones, acceso solo
// para Sergio y qué pasa si todavía no existen las tablas. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-management.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import {
  MAX_PERSONAS, acumuladoPorPersona, enPeriodo, estadoReparto, leerMonto, leerPorcentaje, montoDe, montosDe, normalizarNombre, partesIguales, porcentajeDeMonto,
  presupuestoDe, repartirMonto, sumaPorcentajes, textoNumero, totalesPorMoneda, validarReparto, type PersonaReparto, type ProyectoManagement,
} from '../../src/lib/pagosManagement/reparto';
import {
  baseDe, conBase, conMonto, conPartesIguales, conPorcentaje, filaVacia, filasDe, personasDe, presupuestoAGuardar, recalcular, type FilaReparto,
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
await prueba('presupuestoDe: vale el que se puso a mano y, si no, el del deal (un 0 puesto a mano también cuenta)', () => {
  assert.equal(presupuestoDe({ presupuesto: null, montoDeal: 25000 }), 25000);
  assert.equal(presupuestoDe({ presupuesto: 40000, montoDeal: 25000 }), 40000);
  assert.equal(presupuestoDe({ presupuesto: 0, montoDeal: 25000 }), 0);
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
await prueba('leerPorcentaje: acepta punto, coma y %; vacío es «sin porcentaje»; fuera de 0–100 no vale', () => {
  assert.equal(leerPorcentaje('33.33'), 33.33);
  assert.equal(leerPorcentaje('33,33'), 33.33);
  assert.equal(leerPorcentaje('33%'), 33);
  assert.equal(leerPorcentaje(' 50 % '), 50);
  assert.equal(leerPorcentaje('12.34567'), 12.34567);
  assert.equal(leerPorcentaje('12.3456789'), 12.345679);
  assert.equal(leerPorcentaje('100'), 100);
  assert.equal(leerPorcentaje('0'), 0);
  assert.equal(leerPorcentaje(''), null);
  for (const malo of ['101', '-1', 'abc', '1e2', '5.5.5', 'NaN']) assert.equal(leerPorcentaje(malo), undefined, malo);
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
await prueba('validarReparto: un reparto bien armado, incompleto o vacío vale', () => {
  assert.equal(validarReparto([interna('u1', 'Ana', 60), externa('Luis', 40)]), null);
  assert.equal(validarReparto([interna('u1', 'Ana', 50)]), null); // se completa después
  assert.equal(validarReparto([]), null); // solo el presupuesto
  assert.equal(validarReparto(partesIguales(3).map((p, i) => interna(`u${i}`, `P${i}`, p))), null);
});
await prueba('validarReparto: dice qué está mal en palabras llanas', () => {
  assert.equal(validarReparto([{ userId: null, nombre: 'Ana', externo: false, porcentaje: 50 }]), 'Elige a la persona de cada renglón.');
  assert.equal(validarReparto([externa('   ', 50)]), 'Escribe el nombre de la persona externa.');
  assert.match(validarReparto([interna('u1', 'Ana', 30), interna('u1', 'Ana', 30)])!, /«Ana» está dos veces/);
  assert.match(validarReparto([externa('Luis  Pérez', 30), externa('luis perez', 30)])!, /dos veces en el reparto/);
  assert.match(validarReparto([interna('u1', 'Ana', 0)])!, /porcentaje mayor a cero para Ana/);
  assert.match(validarReparto([interna('u1', 'Ana', Number.NaN)])!, /mayor a cero/);
  assert.equal(validarReparto([interna('u1', 'Ana', 100.5)]), 'Un porcentaje no puede pasar de 100.');
  assert.equal(validarReparto([interna('u1', 'Ana', 70), externa('Luis', 30.5)]), 'Los porcentajes suman 100.5 % y no pueden pasar de 100 %.');
  assert.match(validarReparto(Array.from({ length: MAX_PERSONAS + 1 }, (_, i) => interna(`u${i}`, `P${i}`, 1)))!, /más de 30 personas/);
});

// ── acumulado, totales y periodo ─────────────────────────────────────────────
const proyecto = (p: Partial<ProyectoManagement> & { codigo: string }): ProyectoManagement => ({
  repartoId: 'r', projectId: 'p', montoDeal: 0, montoDealConMarkup: 0, monedaDeal: 'MXN', presupuesto: null, moneda: 'MXN', personas: [], eliminado: false, ...p,
});
const PROYECTOS = [
  proyecto({ codigo: 'ALFA', cliente: 'Cliente Uno', inicio: '2026-03-01', montoDeal: 35000, personas: [interna('u1', 'Ana Prueba', 50), interna('u2', 'Beto Prueba', 30), externa('Luis Externo', 20)] }),
  proyecto({ codigo: 'BETA', inicio: '2026-08-10', montoDeal: 25000, presupuesto: 10000, personas: [interna('u1', 'Ana Prueba', 100)] }),
  proyecto({ codigo: 'GAMA', inicio: '2025-01-15', montoDeal: 700, monedaDeal: 'USD', moneda: 'USD', personas: [interna('u1', 'Ana Prueba', 50), externa('luis  externo', 50)] }),
  proyecto({ codigo: 'DELTA', montoDeal: 5000 }),
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
await prueba('totalesPorMoneda: lo presupuestado y lo repartido, cada moneda por su lado', () => {
  const t = totalesPorMoneda(PROYECTOS);
  assert.deepEqual(t.presupuestado, { MXN: 35000 + 10000 + 5000, USD: 700, EUR: 0 });
  assert.deepEqual(t.repartido, { MXN: 45000, USD: 700, EUR: 0 });
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
  const tres = proyecto({ codigo: 'TRES', inicio: '2026-05-01', montoDeal: 20000, personas: [interna('u1', 'Ana Prueba', 33.333334), interna('u2', 'Beto Prueba', 33.333333), externa('Luis Externo', 33.333333)] });
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
  const tres = proyecto({ codigo: 'TRES', montoDeal: 20000, personas: [interna('u1', 'Ana', 33.333334), interna('u2', 'Beto', 33.333333), externa('Luis', 33.333333)] });
  const filas = filasDe(tres);
  assert.deepEqual(campos(filas), [['33.333334', '6666.67'], ['33.333333', '6666.67'], ['33.333333', '6666.66']]);
  assert.deepEqual(filas.map((f) => [f.tipo, f.userId, f.nombre]), [['interno', 'u1', 'Ana'], ['interno', 'u2', 'Beto'], ['externo', null, 'Luis']]);
  // Con un presupuesto puesto a mano, los montos salen de ese.
  assert.deepEqual(campos(filasDe({ ...tres, presupuesto: 30000 })).map((c) => c[1]), ['10000', '10000', '10000']);
});
await prueba('filas: baseDe usa lo escrito o, vacío, el del deal; lo que no es un monto no vale', () => {
  assert.equal(baseDe('', 25000), 25000);
  assert.equal(baseDe('30,000', 25000), 30000);
  assert.equal(baseDe('abc', 25000), undefined);
});
await prueba('filas: personasDe ignora los renglones vacíos, deja pasar un porcentaje de más y marca como NaN lo que no es un número', () => {
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
  assert.equal(validarReparto([p[3]]), 'Un porcentaje no puede pasar de 100.');
});
await prueba('filas: presupuestoAGuardar es null si vale el del deal (vacío o igual, en la misma moneda) y el monto escrito si no', () => {
  const deal = { montoDeal: 25000, monedaDeal: 'MXN' as const };
  assert.deepEqual(presupuestoAGuardar('', 'MXN', deal), { presupuesto: null, moneda: null });
  assert.deepEqual(presupuestoAGuardar('25000', 'MXN', deal), { presupuesto: null, moneda: null });
  assert.deepEqual(presupuestoAGuardar('25,000', 'MXN', deal), { presupuesto: null, moneda: null });
  assert.deepEqual(presupuestoAGuardar('25000', 'USD', deal), { presupuesto: 25000, moneda: 'USD' });
  assert.deepEqual(presupuestoAGuardar('30,000', 'MXN', deal), { presupuesto: 30000, moneda: 'MXN' });
  assert.deepEqual(presupuestoAGuardar('0', 'MXN', { montoDeal: 0, monedaDeal: 'MXN' }), { presupuesto: null, moneda: null });
  assert.deepEqual(presupuestoAGuardar('0', 'MXN', deal), { presupuesto: 0, moneda: 'MXN' });
  assert.ok('error' in presupuestoAGuardar('abc', 'MXN', deal));
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

// Deal de ALFA (MXN): dos líneas de Management que cuentan (25,000 + 2×5,000), y cuatro que no: otro rubro, excluida del presupuesto, con costo 0,
// y toda una cotización no incluida (o sin marcar).
const dealAlfa = await deal('Deal Alfa', 'MXN 🇲🇽');
const cAlfa = await cotizacion(dealAlfa, true);
await linea(cAlfa, 'Management', 'Management Cuali', 1, 1, 25000, 37500);
await linea(cAlfa, 'Management', 'Management Fase 2', 2, 1, 5000, 15000, true);
await linea(cAlfa, 'Moderación', 'Moderación', 1, 1, 8000, 12000);
await linea(cAlfa, 'Management', 'Excluida', 1, 1, 99999, 99999, false);
await linea(cAlfa, 'Management', 'Sin costo', 1, 1, 0, 0);
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
const guardar = (entrada: Record<string, unknown>) => savePagosManagementReparto.run({ presupuesto: null, moneda: null, personas: [], ...entrada } as any, sergio);
const proyecto_ = async (codigo: string) => (await leer()).proyectos.find((p: any) => p.codigo === codigo);

await prueba('sin las tablas: se pueden ver los proyectos con su monto del deal, y guardar dice qué falta', async () => {
  const r = await leer();
  assert.equal(r.sinTablas, true);
  assert.deepEqual(r.proyectos.map((p: any) => p.codigo), ['BETA', 'ALFA', 'EPSILON']);
  assert.deepEqual(r.proyectos.map((p: any) => p.repartoId), [null, null, null]);
  await assert.rejects(() => guardar({ projectId: alfa, personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 50 }] }), (e: unknown) => e instanceof ZiteError && /add-pagos-management-tables/.test(e.message));
  await assert.rejects(() => guardar({ projectId: alfa }), (e: unknown) => e instanceof ZiteError && /add-pagos-management-tables/.test(e.message));
});

await pg.exec(ddl!);

await prueba('solo Sergio: otra persona y quien no ha entrado reciben «no autorizado» en los dos endpoints', async () => {
  for (const contexto of [otra, sinSesion]) {
    const codigo = contexto.user ? 'FORBIDDEN' : 'UNAUTHORIZED';
    await assert.rejects(() => getPagosManagement.run({}, contexto), rechazadoPor(codigo));
    await assert.rejects(() => savePagosManagementReparto.run({ projectId: alfa, presupuesto: null, moneda: null, personas: [] }, contexto), rechazadoPor(codigo));
  }
});
await prueba('el monto de management del deal es el de la pestaña Presupuesto: solo líneas del rubro, de cotizaciones incluidas, con costo y no excluidas', async () => {
  const r = await leer();
  assert.equal(r.sinTablas, false);
  const alfa_ = r.proyectos.find((p: any) => p.codigo === 'ALFA');
  assert.deepEqual([alfa_.montoDeal, alfa_.montoDealConMarkup, alfa_.monedaDeal, alfa_.moneda, alfa_.presupuesto], [35000, 52500, 'MXN', 'MXN', null]);
  const beta_ = r.proyectos.find((p: any) => p.codigo === 'BETA');
  assert.deepEqual([beta_.montoDeal, beta_.monedaDeal, beta_.moneda], [700, 'USD', 'USD']);
  assert.deepEqual([alfa_.nombre, alfa_.cliente, alfa_.estado, alfa_.inicio, alfa_.dealNombre], ['ALFA completo', 'Cliente Uno', 'En curso', '2026-03-01', 'Deal Alfa']);
});
await prueba('los proyectos con management van del más reciente al más viejo, y el resto queda disponible para agregarlo a mano', async () => {
  const r = await leer();
  assert.deepEqual(r.proyectos.map((p: any) => p.codigo), ['BETA', 'ALFA', 'EPSILON']);
  // GAMA (su deal solo tiene Moderación) y DELTA (sin deal ni fecha, al final).
  assert.deepEqual(r.disponibles.map((p: any) => p.codigo), ['GAMA', 'DELTA']);
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
  assert.equal(p.presupuesto, null);
  assert.deepEqual(p.personas.map((x: any) => [x.userId, x.nombre, x.externo, x.porcentaje]), [[ana, 'Ana Prueba', false, 50], [beto, 'Beto Prueba', false, 30], [null, 'Luis Externo', true, 20]]);
  assert.ok(p.repartoId);
  assert.deepEqual((await leer()).externos, ['Luis Externo']);
});
await prueba('guardar de nuevo reemplaza el reparto (una sola fila por proyecto) y un presupuesto a mano manda sobre el del deal', async () => {
  await guardar({ projectId: alfa, presupuesto: 40000, moneda: 'MXN', personas: [{ userId: carla, nombre: 'Carla', externo: false, porcentaje: 100 }] });
  const p = await proyecto_('ALFA');
  assert.deepEqual([p.presupuesto, p.moneda, p.montoDeal], [40000, 'MXN', 35000]);
  assert.deepEqual(p.personas.map((x: any) => [x.nombre, x.porcentaje]), [['Carla Prueba', 100]]);
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_proyectos where project_id = $1`, [alfa])).rows[0].n), 1);
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_personas`)).rows[0].n), 1);
});
await prueba('la moneda solo vale con un presupuesto a mano: sin él se usa la del deal', async () => {
  await guardar({ projectId: beta, presupuesto: null, moneda: 'EUR', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 60 }] });
  const p = await proyecto_('BETA');
  assert.deepEqual([p.presupuesto, p.moneda, p.monedaDeal], [null, 'USD', 'USD']);
  await guardar({ projectId: beta, presupuesto: 15000, moneda: 'MXN', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 60 }] });
  assert.deepEqual([(await proyecto_('BETA')).presupuesto, (await proyecto_('BETA')).moneda], [15000, 'MXN']);
  await guardar({ projectId: beta, presupuesto: 15000, moneda: null, personas: [] });
  assert.equal((await proyecto_('BETA')).moneda, 'MXN');
});
await prueba('un presupuesto en cero puesto a mano se conserva (no se confunde con «el del deal»)', async () => {
  await guardar({ projectId: beta, presupuesto: 0, moneda: 'USD', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 100 }] });
  const p = await proyecto_('BETA');
  assert.deepEqual([p.presupuesto, p.moneda], [0, 'USD']);
  await guardar({ projectId: beta, presupuesto: null, moneda: null, personas: [] });
});
await prueba('quitar todo (sin presupuesto a mano y sin personas) borra el reparto y el proyecto vuelve a «sin repartir»', async () => {
  assert.deepEqual(await guardar({ projectId: alfa, personas: [] }), { ok: true, eliminado: true });
  const p = await proyecto_('ALFA');
  assert.deepEqual([p.repartoId, p.presupuesto, p.personas], [null, null, []]);
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_personas where reparto_id is not null`)).rows[0].n), 0);
  assert.deepEqual(await guardar({ projectId: alfa, personas: [] }), { ok: true, eliminado: true }); // otra vez, sin nada que borrar
});
await prueba('un proyecto sin management en su deal se agrega a mano con un presupuesto: sale de «disponibles» y entra a la lista', async () => {
  await guardar({ projectId: gama, presupuesto: 5000, moneda: 'MXN', personas: [] });
  const r = await leer();
  assert.deepEqual(r.disponibles.map((p: any) => p.codigo), ['DELTA']);
  const p = r.proyectos.find((x: any) => x.codigo === 'GAMA');
  assert.deepEqual([p.montoDeal, p.presupuesto, p.personas], [0, 5000, []]);
  assert.ok(p.repartoId);
  await guardar({ projectId: gama, personas: [] }); // quitarlo
  assert.deepEqual((await leer()).disponibles.map((p: any) => p.codigo), ['GAMA', 'DELTA']);
});
await prueba('validaciones del servidor: porcentajes que pasan de 100, personas repetidas, usuario que no existe, nombre vacío y datos mal formados', async () => {
  const ana_ = (porcentaje: number) => ({ userId: ana, nombre: 'Ana', externo: false, porcentaje });
  const casos: Array<[string, Record<string, unknown>]> = [
    ['suma 100.5', { personas: [ana_(60), { userId: beto, nombre: 'Beto', externo: false, porcentaje: 40.5 }] }],
    ['repetida', { personas: [ana_(30), ana_(30)] }],
    ['externa repetida', { personas: [{ userId: null, nombre: 'Luis', externo: true, porcentaje: 30 }, { userId: null, nombre: 'LUIS ', externo: true, porcentaje: 30 }] }],
    ['usuario inexistente', { personas: [{ userId: '00000000-0000-4000-8000-000000000000', nombre: 'Nadie', externo: false, porcentaje: 50 }] }],
    ['externa sin nombre', { personas: [{ userId: null, nombre: '  ', externo: true, porcentaje: 50 }] }],
    ['interna sin usuario', { personas: [{ userId: null, nombre: 'Ana', externo: false, porcentaje: 50 }] }],
    ['porcentaje 0', { personas: [ana_(0)] }],
    ['porcentaje 101', { personas: [ana_(101)] }],
    ['presupuesto negativo', { presupuesto: -1, personas: [] }],
    ['moneda inventada', { presupuesto: 100, moneda: 'JPY', personas: [] }],
    ['proyecto mal formado', { projectId: 'no-es-un-id', personas: [ana_(50)] }],
  ];
  for (const [nombre, extra] of casos) await assert.rejects(() => guardar({ projectId: alfa, ...extra }), rechazadoPor('BAD_REQUEST'), nombre);
  await assert.rejects(() => guardar({ projectId: '00000000-0000-4000-8000-000000000000', personas: [ana_(50)] }), rechazadoPor('NOT_FOUND'));
  // Nada de eso dejó basura.
  assert.equal(Number((await pg.query<{ n: number }>(`select count(*)::int as n from pagos_management_proyectos where project_id = $1`, [alfa])).rows[0].n), 0);
});
await prueba('si algo falla a medias no queda un reparto a medias (la transacción se deshace)', async () => {
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
  await assert.rejects(() => guardar({ projectId: alfa, presupuesto: 99999, moneda: 'MXN', personas: [{ userId: beto, nombre: 'Beto', externo: false, porcentaje: 10 }] }), /falla simulada/);
  (pool as any).connect = async () => ({ query: q, release: () => {} });
  assert.deepEqual(enviado.filter((s) => s === 'begin' || s === 'rollback' || s === 'commit'), ['begin', 'rollback']);
  assert.deepEqual(await proyecto_('ALFA'), antes);
  await guardar({ projectId: alfa, personas: [] });
});
await prueba('si se elimina un proyecto con reparto, el reparto se conserva con el código que tenía', async () => {
  await guardar({ projectId: epsilon, presupuesto: 9000, moneda: 'MXN', personas: [{ userId: ana, nombre: 'Ana', externo: false, porcentaje: 100 }] });
  await pg.query(`delete from projects where id = $1`, [epsilon]);
  const r = await leer();
  const huerfano = r.proyectos.find((p: any) => p.codigo === 'EPSILON');
  assert.deepEqual([huerfano.eliminado, huerfano.projectId, huerfano.presupuesto, huerfano.personas.map((x: any) => x.nombre)], [true, null, 9000, ['Ana Prueba']]);
  assert.deepEqual(r.proyectos.filter((p: any) => !p.eliminado).map((p: any) => p.codigo), ['BETA', 'ALFA']);
});
await prueba('si se borra un usuario, su reparto sigue con el nombre que tenía al repartir', async () => {
  await guardar({ projectId: alfa, personas: [{ userId: carla, nombre: 'Carla', externo: false, porcentaje: 100 }] });
  await pg.query(`delete from users where id = $1`, [carla]);
  const p = await proyecto_('ALFA');
  assert.deepEqual(p.personas.map((x: any) => [x.userId, x.nombre, x.externo]), [[null, 'Carla Prueba', false]]);
  assert.deepEqual((await leer()).usuarios.map((u: any) => u.nombre), ['Ana Prueba', 'Beto Prueba']);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
