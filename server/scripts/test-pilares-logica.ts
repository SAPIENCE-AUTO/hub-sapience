// Pruebas de la lógica pura del reparto de un deal entre pilares (src/lib/pilares): estados, porcentajes calculados a partir de montos en pesos, reparto parejo exacto al centavo,
// reajuste al precio, elegir y quitar pilares, lectura de montos escritos a mano y reconocimiento del texto viejo de «Tipo de proyecto». Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pilares-logica.ts
import assert from 'node:assert/strict';
import {
  completarConLoQueFalta, estadoReparto, ingresoEfectivo, ponerPilares, porcentajes, redondear, reajustarAlPrecio, repartoParejo, resumenTexto, sumar, type FilaReparto,
} from '../../src/lib/pilares/reparto';
import { formatoMonto, formatoPorcentaje, leerMonto, monedaCorta, montoParaEditar } from '../../src/lib/pilares/dinero';
import { normalizar, sugerirDesdeTexto, type PilarDelCatalogo } from '../../src/lib/pilares/sugerencias';

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

const f = (pilarId: string, precio: number | null, costo: number | null = null): FilaReparto => ({ pilarId, precio, costo });
const suma = (xs: number[]) => redondear(xs.reduce((s, x) => s + x, 0));

// ── Estado del reparto ──────────────────────────────────────────────────────

prueba('sin pilares: sin clasificar', () => {
  assert.deepEqual(estadoReparto([], 300_000), { estado: 'sin-clasificar', asignado: 0, falta: 0, sobra: 0 });
});

prueba('un solo pilar: listo, y cuenta el precio del deal aunque no tenga monto (o aunque el precio cambie)', () => {
  assert.deepEqual(estadoReparto([f('a', null)], 300_000), { estado: 'listo', asignado: 300_000, falta: 0, sobra: 0 });
  assert.deepEqual(estadoReparto([f('a', 111)], 450_000), { estado: 'listo', asignado: 450_000, falta: 0, sobra: 0 });
  assert.equal(estadoReparto([f('a', null)], null).estado, 'listo');
});

prueba('varios pilares que suman el precio: listo; con $1 de diferencia todavía; con más, incompleto o excedido', () => {
  assert.equal(estadoReparto([f('a', 210_000), f('b', 90_000)], 300_000).estado, 'listo');
  assert.equal(estadoReparto([f('a', 210_000), f('b', 89_999.5)], 300_000).estado, 'listo');
  assert.equal(estadoReparto([f('a', 210_000), f('b', 90_001)], 300_000).estado, 'listo');
  assert.deepEqual(estadoReparto([f('a', 210_000), f('b', 80_000)], 300_000), { estado: 'incompleto', asignado: 290_000, falta: 10_000, sobra: 0 });
  assert.deepEqual(estadoReparto([f('a', 210_000), f('b', 100_000)], 300_000), { estado: 'excedido', asignado: 310_000, falta: 0, sobra: 10_000 });
});

prueba('varios pilares sin montos todavía: incompleto por todo el precio', () => {
  assert.deepEqual(estadoReparto([f('a', null), f('b', null)], 300_000), { estado: 'incompleto', asignado: 0, falta: 300_000, sobra: 0 });
});

prueba('varios pilares y el deal sin precio (o en cero): sin precio, no se puede validar', () => {
  assert.equal(estadoReparto([f('a', 5), f('b', 6)], null).estado, 'sin-precio');
  assert.equal(estadoReparto([f('a', 5), f('b', 6)], 0).estado, 'sin-precio');
  assert.equal(estadoReparto([f('a', 5), f('b', 6)], undefined).estado, 'sin-precio');
});

prueba('las sumas son exactas al centavo (0.1 + 0.2 no da 0.30000000000000004)', () => {
  assert.equal(sumar([f('a', 0.1), f('b', 0.2)], 'precio'), 0.3);
  assert.equal(sumar([f('a', 4.35), f('b', 1.15)], 'precio'), 5.5, '4.35 × 100 no es entero en flotantes: se redondea a centavos antes de sumar');
  assert.equal(sumar([f('a', 0.57), f('b', 0.57), f('c', 0.57)], 'precio'), 1.71);
  assert.equal(estadoReparto([f('a', 0.1), f('b', 0.2)], 0.3).estado, 'listo');
});

// ── Porcentajes ─────────────────────────────────────────────────────────────

prueba('porcentajes de ingreso y de costo a partir de los montos (70/30 sobre $300,000; costos 120 y 40 mil)', () => {
  const p = porcentajes([f('a', 210_000, 120_000), f('b', 90_000, 40_000)], 300_000);
  assert.deepEqual(p, [{ precio: 70, costo: 75 }, { precio: 30, costo: 25 }]);
});

prueba('un solo pilar es 100 % del ingreso aunque no tenga monto; su costo es 100 % si lo tiene', () => {
  assert.deepEqual(porcentajes([f('a', null, 50_000)], 300_000), [{ precio: 100, costo: 100 }]);
  assert.deepEqual(porcentajes([f('a', null)], null), [{ precio: 100, costo: null }]);
});

prueba('un pilar sin costo capturado no tiene porcentaje de costo; si ninguno lo tiene, tampoco', () => {
  assert.deepEqual(porcentajes([f('a', 150, 60), f('b', 150, null)], 300), [{ precio: 50, costo: 100 }, { precio: 50, costo: null }]);
  assert.deepEqual(porcentajes([f('a', 150), f('b', 150)], 300).map(x => x.costo), [null, null]);
});

prueba('un porcentaje que no es redondo sale con un decimal (un tercio = 33.3)', () => {
  assert.deepEqual(porcentajes([f('a', 100), f('b', 100), f('c', 100)], 300).map(x => x.precio), [33.3, 33.3, 33.3]);
});

prueba('sin precio del deal, los porcentajes se calculan contra lo repartido; sin nada repartido, no hay porcentaje', () => {
  assert.deepEqual(porcentajes([f('a', 30), f('b', 10)], null).map(x => x.precio), [75, 25]);
  assert.deepEqual(porcentajes([f('a', null), f('b', null)], null).map(x => x.precio), [null, null]);
});

prueba('si lo repartido no llega al precio, los porcentajes son contra el precio (el resto es lo que falta)', () => {
  assert.deepEqual(porcentajes([f('a', 150_000), f('b', 90_000)], 300_000).map(x => x.precio), [50, 30]);
});

prueba('ingreso efectivo: con un pilar, el precio del deal; con varios, lo capturado (vacío = 0)', () => {
  assert.deepEqual(ingresoEfectivo([f('a', null)], 80), [80]);
  assert.deepEqual(ingresoEfectivo([f('a', 10), f('b', null)], 80), [10, 0]);
});

// ── Reparto parejo y reajuste ───────────────────────────────────────────────

prueba('reparto parejo: cien pesos entre tres da 33.34, 33.33 y 33.33 y suma exacto', () => {
  assert.deepEqual(repartoParejo(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(suma(repartoParejo(100, 3)), 100);
  assert.deepEqual(repartoParejo(300_000, 2), [150_000, 150_000]);
  assert.deepEqual(repartoParejo(0.01, 3), [0.01, 0, 0]);
  assert.deepEqual(repartoParejo(10, 0), []);
  for (const [total, k] of [[1234.57, 7], [999_999.99, 4], [0.07, 5], [88_888.88, 9]] as const) assert.equal(suma(repartoParejo(total, k)), total, `${total} entre ${k}`);
});

prueba('reajustar al precio nuevo conserva las proporciones y suma exacto; los costos no se tocan', () => {
  const r = reajustarAlPrecio([f('a', 210_000, 1), f('b', 90_000, 2)], 400_000);
  assert.deepEqual(r, [f('a', 280_000, 1), f('b', 120_000, 2)]);
  const raro = reajustarAlPrecio([f('a', 1), f('b', 1), f('c', 1)], 100);
  assert.equal(suma(raro.map(x => x.precio as number)), 100);
  assert.deepEqual(raro.map(x => x.precio), [33.34, 33.33, 33.33]);
  const desigual = reajustarAlPrecio([f('a', 7), f('b', 3)], 1000.01);
  assert.equal(suma(desigual.map(x => x.precio as number)), 1000.01);
});

prueba('reajustar sin ningún monto reparte parejo; con precio inválido no cambia nada', () => {
  assert.deepEqual(reajustarAlPrecio([f('a', null), f('b', null)], 101).map(x => x.precio), [50.5, 50.5]);
  assert.deepEqual(reajustarAlPrecio([f('a', 5)], 0), [f('a', 5)]);
  assert.deepEqual(reajustarAlPrecio([], 100), []);
});

prueba('completar con lo que falta pone en esa fila el resto del precio, y nunca menos de cero', () => {
  assert.deepEqual(completarConLoQueFalta([f('a', 200_000), f('b', null)], 1, 300_000).map(x => x.precio), [200_000, 100_000]);
  assert.deepEqual(completarConLoQueFalta([f('a', 400_000), f('b', null)], 1, 300_000).map(x => x.precio), [400_000, 0]);
  assert.deepEqual(completarConLoQueFalta([f('a', 1)], 5, 300), [f('a', 1)]);
  assert.deepEqual(completarConLoQueFalta([f('a', 1), f('b', 2)], 0, null), [f('a', 1), f('b', 2)]);
});

// ── Elegir y quitar pilares ─────────────────────────────────────────────────

const ORDEN = ['cuali', 'cuanti', 'digital', 'estrategia'];

prueba('elegir un pilar: una fila sin monto (su ingreso es el precio)', () => {
  assert.deepEqual(ponerPilares([], ['digital'], 300_000, ORDEN), [f('digital', null)]);
});

prueba('elegir dos pilares con precio: arranca parejo; los costos y el orden del catálogo se respetan', () => {
  assert.deepEqual(ponerPilares([], ['digital', 'cuali'], 300_000, ORDEN), [f('cuali', 150_000), f('digital', 150_000)]);
});

prueba('agregar un pilar a un reparto ya capturado conserva lo capturado y el nuevo entra sin monto', () => {
  const antes = [f('cuali', 210_000, 5), f('digital', 90_000, 6)];
  const despues = ponerPilares(antes, ['cuali', 'digital', 'cuanti'], 300_000, ORDEN);
  assert.deepEqual(despues, [f('cuali', 210_000, 5), f('cuanti', null), f('digital', 90_000, 6)]);
  assert.equal(estadoReparto(despues, 300_000).estado, 'listo', 'suma lo mismo: el nuevo vale cero hasta que se le ponga monto');
});

prueba('quitar pilares hasta quedar uno borra su monto (ya vale todo el precio); quitar todos deja vacío', () => {
  assert.deepEqual(ponerPilares([f('cuali', 210_000, 5), f('digital', 90_000)], ['cuali'], 300_000, ORDEN), [f('cuali', null, 5)]);
  assert.deepEqual(ponerPilares([f('cuali', 1)], [], 300_000, ORDEN), []);
});

prueba('elegir dos pilares sin precio del deal: quedan sin monto (no hay con qué repartir parejo)', () => {
  assert.deepEqual(ponerPilares([], ['cuali', 'digital'], null, ORDEN), [f('cuali', null), f('digital', null)]);
});

prueba('un pilar repetido o desconocido no rompe el orden', () => {
  assert.deepEqual(ponerPilares([], ['digital', 'digital', 'nuevo'], null, ORDEN).map(x => x.pilarId), ['digital', 'nuevo']);
});

prueba('resumen en texto: nombres unidos con «+», sin repetir ni vacíos', () => {
  assert.equal(resumenTexto(['Cualitativo', 'Digital']), 'Cualitativo + Digital');
  assert.equal(resumenTexto(['Cualitativo', ' Cualitativo ', '']), 'Cualitativo');
  assert.equal(resumenTexto([]), '');
});

// ── Montos escritos a mano ──────────────────────────────────────────────────

prueba('leer montos: pesos, comas de miles, espacios y decimales; vacío es null; basura es NaN', () => {
  assert.equal(leerMonto(''), null);
  assert.equal(leerMonto('   '), null);
  assert.equal(leerMonto(null), null);
  assert.equal(leerMonto('$1,234.50'), 1234.5);
  assert.equal(leerMonto('1234.5'), 1234.5);
  assert.equal(leerMonto('1 234'), 1234);
  assert.equal(leerMonto('1\u00a0234'), 1234, 'con espacio duro');
  assert.equal(leerMonto('1,234'), 1234);
  assert.equal(leerMonto('1,234,567.89'), 1_234_567.89);
  assert.equal(leerMonto('0'), 0);
  assert.equal(leerMonto('12.345'), 12.35);
  assert.equal(leerMonto('1,5'), 1.5);
  assert.equal(leerMonto('1,50'), 1.5);
  assert.equal(leerMonto('$'), null, 'solo el signo de pesos es lo mismo que nada');
  assert.equal(leerMonto('.5'), 0.5);
  assert.equal(leerMonto('12.'), 12);
  for (const malo of ['abc', '-5', '1e5', '1.2.3', '.', '12a', '1,2,3', '1234,567', '1,234,56']) assert.ok(Number.isNaN(leerMonto(malo)), malo);
  assert.equal(leerMonto('999999999999'), 999_999_999_999);
  assert.ok(Number.isNaN(leerMonto('1000000000000')));
});

prueba('escribir montos: pesos con comas, otra moneda con su clave, rayas donde falta', () => {
  assert.equal(formatoMonto(1234.5), '$1,234.5');
  assert.equal(formatoMonto(300_000), '$300,000');
  assert.equal(formatoMonto(1000, 'USD'), 'USD 1,000');
  assert.equal(formatoMonto(-50), '-$50');
  assert.equal(formatoMonto(null), '—');
  assert.equal(formatoMonto(Number.NaN), '—');
  assert.equal(formatoPorcentaje(70), '70%');
  assert.equal(formatoPorcentaje(33.3), '33.3%');
  assert.equal(formatoPorcentaje(null), '—');
  assert.equal(montoParaEditar(1234.5), '1234.5');
  assert.equal(montoParaEditar(1000), '1000');
  assert.equal(montoParaEditar(12.3), '12.3');
  assert.equal(montoParaEditar(null), '');
  assert.equal(monedaCorta('MXN 🇲🇽'), 'MXN');
  assert.equal(monedaCorta('USD 🇺🇸'), 'USD');
  assert.equal(monedaCorta(undefined), 'MXN');
  assert.equal(monedaCorta('eur'), 'EUR');
});

prueba('lo que se escribe y se lee de vuelta da lo mismo', () => {
  for (const x of [0, 1, 99.99, 1234.5, 300_000, 1_234_567.89]) assert.equal(leerMonto(montoParaEditar(x)), x);
});

// ── Reconocer el texto viejo ────────────────────────────────────────────────

const CAT: PilarDelCatalogo[] = [
  { id: 'cuali', nombre: 'Cualitativo' }, { id: 'cuanti', nombre: 'Cuantitativo' }, { id: 'digital', nombre: 'Digital' }, { id: 'estrategia', nombre: 'Estrategia' },
];
const ids = (t: string, cat = CAT) => sugerirDesdeTexto(t, cat)?.pilarIds ?? null;

prueba('un pilar escrito de varias formas: Cuali, CUALITATIVO, cualitativo con espacios', () => {
  for (const t of ['Cuali', 'Cualitativo', 'CUALITATIVO', ' cualitativo ', 'cualitativa', 'Cualitativos']) assert.deepEqual(ids(t), ['cuali'], t);
  assert.deepEqual(ids('Digital'), ['digital']);
  assert.deepEqual(ids('Cuantitativo'), ['cuanti']);
  assert.deepEqual(ids('Cuanti'), ['cuanti']);
  assert.deepEqual(ids('Estrategia'), ['estrategia']);
  assert.deepEqual(ids('Estratégia'), ['estrategia'], 'con acento de más');
  assert.equal(sugerirDesdeTexto('Cuali', CAT)?.mixta, false);
});

prueba('varios pilares nombrados: «+», «y», o solo separados por espacio; sale en el orden del catálogo', () => {
  assert.deepEqual(ids('Cuali + Digital'), ['cuali', 'digital']);
  assert.deepEqual(ids('Cualitativo Digital'), ['cuali', 'digital']);
  assert.deepEqual(ids('Cualitativo + digital'), ['cuali', 'digital']);
  assert.deepEqual(ids('Cuali y cuanti'), ['cuali', 'cuanti']);
  assert.deepEqual(ids('Cuali cuanti'), ['cuali', 'cuanti']);
  assert.deepEqual(ids('Cualitativo y Cuantitativo'), ['cuali', 'cuanti']);
  assert.deepEqual(ids('Cuali + estrategia'), ['cuali', 'estrategia']);
  assert.deepEqual(ids('Cuali + estrategia + digital'), ['cuali', 'digital', 'estrategia']);
  assert.deepEqual(ids('Digital + Cuali'), ['cuali', 'digital'], 'el orden del texto no manda');
  assert.equal(sugerirDesdeTexto('Cuali + Digital', CAT)?.mixta, true);
  assert.deepEqual(sugerirDesdeTexto('Cuali + Digital', CAT)?.nombres, ['Cualitativo', 'Digital']);
  assert.deepEqual(ids('Cuali y Cuali'), ['cuali'], 'un pilar repetido cuenta una vez');
});

prueba('lo que no es un pilar no se adivina: el nombre del campo, «Otro», un tema, vacío', () => {
  for (const t of ['Tipo de proyecto', 'Otro', 'Entendimiento de Consumidor', '', '   ', 'xyz', 'Cuali + Sharpli', 'Cualitativo presencial']) assert.equal(ids(t), null, t);
  assert.equal(sugerirDesdeTexto(null, CAT), null);
  assert.equal(sugerirDesdeTexto(undefined, CAT), null);
});

prueba('un pilar creado después se reconoce por su propio nombre y convive con los de arranque', () => {
  const cat = [...CAT, { id: 'talks', nombre: 'Talks' }, { id: 'ux', nombre: 'Investigación UX' }];
  assert.deepEqual(ids('Talks', cat), ['talks']);
  assert.deepEqual(ids('Cuali + talks', cat), ['cuali', 'talks']);
  assert.deepEqual(ids('Cualitativo UX', cat), ['cuali', 'ux'], 'una palabra del nombre del pilar basta');
  assert.equal(ids('Talks', CAT), null, 'sin ese pilar en el catálogo no se reconoce');
});

prueba('un pilar desactivado o renombrado: si se quita del catálogo ya no se sugiere', () => {
  const sinDigital = CAT.filter(p => p.id !== 'digital');
  assert.equal(ids('Cuali + Digital', sinDigital), null);
  assert.deepEqual(ids('Cuali', sinDigital), ['cuali']);
});

prueba('normalizar quita acentos y mayúsculas', () => {
  assert.equal(normalizar('  ESTRATÉGICA  '), 'estrategica');
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
