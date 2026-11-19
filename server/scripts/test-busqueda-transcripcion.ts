// Pruebas de buscar texto dentro de una transcripción (src/lib/minutas/busquedaTranscripcion.ts): sin importar mayúsculas ni acentos (la ñ cuenta como letra aparte),
// coincidencias numeradas en orden a través de todos los turnos, coincidencias que cruzan palabras y que las posiciones del texto plegado sean las del original.
// Todo con texto inventado.
// uso: node server/node_modules/.bin/tsx server/scripts/test-busqueda-transcripcion.ts
import assert from 'node:assert/strict';
import { buscarEnTextos, marcarPalabras, plegar, posicionesDePalabras } from '../../src/lib/minutas/busquedaTranscripcion';

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

console.log('— Buscar en la transcripción —');

await prueba('no distingue mayúsculas ni acentos, pero la ñ es una letra aparte', () => {
  assert.equal(plegar('Reunión Ágil, CAFÉ ü'), 'reunion agil, cafe u');
  assert.equal(plegar('Año'), 'añ' + 'o');
  assert.notEqual(plegar('año'), plegar('ano'));
  assert.equal(buscarEnTextos(['La reunión fue ágil'], 'REUNION').total, 1);
  assert.equal(buscarEnTextos(['La reunion fue agil'], 'reunión ÁGIL').total, 0, 'dos palabras separadas por «fue» no son una frase');
  assert.equal(buscarEnTextos(['Este año cambió'], 'ano').total, 0);
  assert.equal(buscarEnTextos(['El ano'], 'año').total, 0);
});

await prueba('el texto plegado mide lo mismo que el original (para que una posición sirva en los dos), también con emojis y letras raras', () => {
  const muestras = ['', 'hola', 'ÁÉÍÓÚÜÑ áéíóúüñ', 'İstanbul ß ǅ ﬁ', 'áë', 'caf😀é 👨‍👩‍👧', 'Ὀδυσσεύς', '\n\t ¿Qué tal?'];
  for (const m of muestras) assert.equal(plegar(m).length, m.length, `cambió el largo de «${m}»`);
  const alfabeto = ['a', 'Á', 'é', 'Ñ', 'ñ', 'ü', ' ', '😀', 'İ', 'ß', '́', '1', ',', 'Z'];
  let semilla = 7;
  const azar = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 500; i++) {
    const s = Array.from({ length: Math.floor(azar() * 12) }, () => alfabeto[Math.floor(azar() * alfabeto.length)]).join('');
    assert.equal(plegar(s).length, s.length, `cambió el largo de ${JSON.stringify(s)}`);
    assert.equal(plegar(plegar(s)), plegar(s), 'plegar dos veces debe dar lo mismo');
  }
});

await prueba('cuenta las coincidencias de todos los turnos en orden y dice cuántas hay antes de cada turno', () => {
  const r = buscarEnTextos(['hola mundo hola', 'sin nada', 'Hola otra vez', 'HOLA'], 'hola');
  assert.equal(r.total, 4);
  assert.deepEqual(r.desde, [0, 2, 2, 3]);
  assert.deepEqual(r.porTexto[0], [{ inicio: 0, fin: 4 }, { inicio: 11, fin: 15 }]);
  assert.deepEqual(r.porTexto[1], []);
  assert.deepEqual(r.porTexto[3], [{ inicio: 0, fin: 4 }]);
});

await prueba('las coincidencias no se traslapan, y una consulta vacía, de espacios o con símbolos no truena', () => {
  assert.equal(buscarEnTextos(['aaa'], 'aa').total, 1);
  assert.equal(buscarEnTextos(['hola'], '').total, 0);
  assert.equal(buscarEnTextos(['hola'], '   ').total, 0);
  assert.equal(buscarEnTextos(['costo (a+b) *'], '(a+b)').total, 1, 'los símbolos se buscan tal cual, no como patrón');
  assert.equal(buscarEnTextos(['costo [x'], '[x').total, 1);
  assert.deepEqual(buscarEnTextos([], 'hola'), { porTexto: [], desde: [], total: 0 });
});

await prueba('espacios de más en lo escrito no impiden encontrar una frase', () => {
  assert.equal(buscarEnTextos(['buen día a todos'], ' buen   día ').total, 1);
  assert.equal(buscarEnTextos(['buen día a todos'], 'buen\tdía').total, 1);
});

await prueba('marca las palabras que tocan cada coincidencia (también las parciales y las frases de varias palabras) y la primera de cada una es el ancla', () => {
  const palabras = ['Buenos', 'días,', 'ya', 'hablamos', 'de', 'las', 'reuniones.'];
  const texto = palabras.join(' ');
  const pos = posicionesDePalabras(palabras);
  assert.deepEqual(pos[1], { inicio: 7, fin: 12 });
  const frase = buscarEnTextos([texto], 'DIAS, ya');
  const m1 = marcarPalabras(pos, frase.porTexto[0], frase.desde[0]);
  assert.deepEqual(m1.map((x) => x.coincide), [false, true, true, false, false, false, false]);
  assert.deepEqual(m1.filter((x) => x.ancla).map((x) => x.indice), [0]);
  const parcial = buscarEnTextos([texto], 'reunion');
  const m2 = marcarPalabras(pos, parcial.porTexto[0], 5);
  assert.deepEqual(m2[6], { coincide: true, indice: 5, ancla: true }, 'la palabra completa se marca aunque coincida solo una parte');
  const dos = buscarEnTextos(['sí sí no sí'], 'sí');
  const m3 = marcarPalabras(posicionesDePalabras(['sí', 'sí', 'no', 'sí']), dos.porTexto[0], 10);
  assert.deepEqual(m3.map((x) => x.indice), [10, 11, -1, 12]);
});

console.log(`\n${n - fallas} de ${n} pruebas ok`);
if (fallas) process.exit(1);
process.exit(0);
