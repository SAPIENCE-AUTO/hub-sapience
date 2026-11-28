// Pruebas de la búsqueda de las listas de Pagos de management (src/lib/pagosManagement/buscador.ts): personas y deals que se encuentran escribiendo parte del
// nombre, sin importar acentos ni mayúsculas ni el orden de las palabras. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-buscador.ts
import assert from 'node:assert/strict';
import { filtrarOpciones, normalizarBusqueda, type OpcionBuscable } from '../../src/lib/pagosManagement/buscador';

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

const persona = (valor: string, texto: string, extra?: string, deshabilitada?: boolean): OpcionBuscable => ({ valor, texto, extra, deshabilitada });
const EQUIPO: OpcionBuscable[] = [
  persona('u:1', 'Aguilara Soto', 'Operación'),
  persona('u:2', 'Claudio Laracuente', 'Análisis'),
  persona('u:3', 'Claudina Ibarra', 'Moderación'),
  persona('u:4', 'Mónica Núñez', 'Análisis'),
  persona('u:5', 'Juan José Niño', undefined, true),
  persona('u:6', 'Rosa Elena Vargas', 'Operación'),
];
const valores = (r: { items: OpcionBuscable[] }) => r.items.map((o) => o.valor);

await prueba('normalizarBusqueda: sin acentos, sin mayúsculas, con los espacios en uno solo', () => {
  assert.equal(normalizarBusqueda('  MÓNICA   Núñez '), 'monica nunez');
  assert.equal(normalizarBusqueda(''), '');
  assert.equal(normalizarBusqueda('   '), '');
});

await prueba('sin texto salen todas, en su orden, y el total es el de la lista', () => {
  for (const vacio of ['', '   ']) {
    const r = filtrarOpciones(EQUIPO, vacio);
    assert.deepEqual(valores(r), ['u:1', 'u:2', 'u:3', 'u:4', 'u:5', 'u:6']);
    assert.equal(r.total, 6);
  }
});

await prueba('parte del nombre: «clau» encuentra a Claudio y a Claudina y a nadie más', () => {
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'clau')), ['u:2', 'u:3']);
});

await prueba('sin importar acentos ni mayúsculas: «monica» encuentra a «Mónica» y «NUNEZ» a «Núñez»', () => {
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'monica')), ['u:4']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'NUNEZ')), ['u:4']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'mÓnIcA')), ['u:4']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'nino')), ['u:5'], 'la ñ se busca con n');
});

await prueba('con varias palabras salen solo las que traen TODAS, en cualquier orden y con espacios de más', () => {
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'clau lar')), ['u:2']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'laracuente claudio')), ['u:2']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, '   clau     lara  ')), ['u:2']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'claudio monica')), []);
});

await prueba('también se busca en el extra (el departamento) aunque no sea parte del nombre', () => {
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'analisis')), ['u:2', 'u:4']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'claudio analisis')), ['u:2']);
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'moderacion')), ['u:3']);
});

await prueba('primero las que tienen una palabra que EMPIEZA con lo escrito, y luego las que solo lo traen por dentro (cada grupo en su orden)', () => {
  // «lara»: en «Aguilara Soto» está por dentro; en «Claudio Laracuente» es una palabra que empieza así. Aunque la primera va antes en la lista, sale después.
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'lara')), ['u:2', 'u:1']);
  // «ni»: «Mónica» lo trae por dentro («mo-ni-ca») y «Niño» tiene una palabra que empieza con «ni»; aunque Mónica va antes en la lista, sale después.
  assert.deepEqual(valores(filtrarOpciones(EQUIPO, 'ni')), ['u:5', 'u:4']);
});

await prueba('lo deshabilitado se ve en los resultados con su marca (no se quita de la lista)', () => {
  const r = filtrarOpciones(EQUIPO, 'juan');
  assert.deepEqual(valores(r), ['u:5']);
  assert.equal(r.items[0].deshabilitada, true);
});

await prueba('sin coincidencias no sale nada y el total es cero', () => {
  const r = filtrarOpciones(EQUIPO, 'zzz');
  assert.deepEqual(r, { items: [], total: 0 });
});

await prueba('lo que se escribe es texto, no una expresión: paréntesis, corchetes y signos no truenan ni coinciden con todo', () => {
  const deals: OpcionBuscable[] = [persona('d:1', 'Programa Norte (vinculado)', 'Cliente Uno'), persona('d:2', 'Programa Sur', 'Cliente Dos')];
  assert.deepEqual(valores(filtrarOpciones(deals, '(vinc')), ['d:1']);
  assert.deepEqual(valores(filtrarOpciones(deals, '(')), ['d:1'], 'el paréntesis solo coincide con el texto que lo trae');
  for (const raro of ['[', '.*', '\\', '+', '?']) assert.deepEqual(valores(filtrarOpciones(deals, raro)), [], raro);
});

await prueba('deals: se encuentran por nombre o por cliente, con las palabras en cualquier orden', () => {
  const deals: OpcionBuscable[] = [
    persona('d:1', 'Programa Norte', 'Cervecería Uno'),
    persona('d:2', 'Programa Sur', 'Cervecería Dos'),
    persona('d:3', 'Estudio de Mercado', 'Lácteos Tres'),
  ];
  assert.deepEqual(valores(filtrarOpciones(deals, 'cerveceria')), ['d:1', 'd:2']);
  assert.deepEqual(valores(filtrarOpciones(deals, 'dos cerveceria')), ['d:2']);
  assert.deepEqual(valores(filtrarOpciones(deals, 'lacteos estudio')), ['d:3']);
  assert.deepEqual(valores(filtrarOpciones(deals, 'programa')), ['d:1', 'd:2']);
});

await prueba('el límite recorta lo que se devuelve pero el total sigue siendo el de todas las que coinciden', () => {
  const muchas = Array.from({ length: 300 }, (_, i) => persona(`d:${i}`, `Deal ${i}`, i % 2 ? 'Cliente Par' : 'Cliente Impar'));
  const sin = filtrarOpciones(muchas, '');
  assert.equal(sin.total, 300);
  assert.equal(sin.items.length, 300);
  const recortado = filtrarOpciones(muchas, '', 100);
  assert.deepEqual([recortado.items.length, recortado.total], [100, 300]);
  const buscado = filtrarOpciones(muchas, 'deal 29', 5);
  assert.equal(buscado.total, 13, '29, 129, 229 y del 290 al 299');
  assert.equal(buscado.items.length, 5);
  // primero las que tienen una palabra que EMPIEZA con «29» (el 29 y del 290 al 299); el 129 y el 229 lo traen por dentro y van al final
  assert.deepEqual(valores(buscado), ['d:29', 'd:290', 'd:291', 'd:292', 'd:293']);
  assert.deepEqual(valores(filtrarOpciones(muchas, 'deal 29')).slice(-2), ['d:129', 'd:229']);
});

await prueba('no modifica la lista que recibe', () => {
  const copia = EQUIPO.map((o) => ({ ...o }));
  filtrarOpciones(EQUIPO, 'lara');
  assert.deepEqual(EQUIPO, copia);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
