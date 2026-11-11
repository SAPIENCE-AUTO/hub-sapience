// Prueba de los colores de «Por reclutador» y de su evolución para quien no distingue algunos colores (daltonismo). Esta pantalla la tiene que poder leer quien no distingue algunos colores: un color
// nuevo o cambiado no se da por bueno a ojo ni comparándolo solo con su vecino; se mide contra TODOS los demás de su gráfica. El verde que tuvo «Nuevas» hasta el 2026-11-10 se confundía
// con los cafés de en medio (distancia 5.5 de 8) y no se había medido. La simulación y la distancia son las de la skill dataviz: transformaciones de Machado, Oliveira y Fernandes
// (2009) con severidad 1.0 (daltonismo total de un tipo, el peor caso) y distancia OKLab x100; 8 o más se distingue bien, entre 6 y 8 apenas, y menos de 6 se confunde.
// Son colores inventados para nada: no toca la base ni la red.
// uso: node server/node_modules/.bin/tsx server/scripts/test-colores-reclutadores.ts
import assert from 'node:assert/strict';
import { AZUL, ROJO } from '../../src/components/indicadores/colores';
import {
  COLORES_REPETIDA, COLORES_TRAMOS_EVOLUCION, COLOR_COMPARTIDO, COLOR_ENTRARON_ELEGIBLES, COLOR_ENTRARON_NO_ELEGIBLES, COLOR_NUEVA, COLOR_PCT_ENTRO, COLOR_PCT_NO_ELEGIBLES, COLOR_PCT_REPETIDAS,
} from '../../src/components/indicadores/reclutadoresColores';

type Tipo = 'protan' | 'deutan' | 'tritan' | undefined;
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const aLineal = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const simular = (rgb: number[], tipo: Tipo): number[] => {
  if (!tipo) return rgb;
  const m = MACHADO[tipo];
  return m.map((fila) => Math.max(0, Math.min(1, fila[0] * rgb[0] + fila[1] * rgb[1] + fila[2] * rgb[2])));
};
const oklab = ([r, g, b]: number[]): number[] => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const distancia = (a: string, b: string, tipo?: Tipo): number => {
  const x = oklab(simular(aLineal(a), tipo)), y = oklab(simular(aLineal(b), tipo));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
const claridad = (hex: string): number => oklab(aLineal(hex))[0];
const luminancia = (hex: string): number => { const [r, g, b] = aLineal(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a: string, b: string): number => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** La peor distancia entre dos colores para el daltonismo rojo-verde (el más común), para el azul-amarillo y para quien ve todo. */
const peor = (a: string, b: string) => ({ rojoVerde: Math.min(distancia(a, b, 'protan'), distancia(a, b, 'deutan')), azulAmarillo: distancia(a, b, 'tritan'), normal: distancia(a, b) });
/** Todas las parejas de una lista, con su peor distancia; devuelve la más baja de cada tipo y cuál pareja es. */
function masCercanas(colores: string[]) {
  let rv = { d: Infinity, par: '' }, aa = { d: Infinity, par: '' }, no = { d: Infinity, par: '' };
  for (let i = 0; i < colores.length; i++) for (let j = i + 1; j < colores.length; j++) {
    const p = peor(colores[i], colores[j]), par = `${colores[i]} y ${colores[j]}`;
    if (p.rojoVerde < rv.d) rv = { d: p.rojoVerde, par };
    if (p.azulAmarillo < aa.d) aa = { d: p.azulAmarillo, par };
    if (p.normal < no.d) no = { d: p.normal, par };
  }
  return { rv, aa, no };
}

let n = 0;
let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  n++;
  try { fn(); console.log(`ok   ${nombre}`); } catch (e) { fallas++; console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`); }
}

prueba('la medición misma: un verde y un rojo clásicos se confunden con daltonismo rojo-verde y se distinguen sin él (si esto falla, la prueba no mide bien)', () => {
  const p = peor('#00A000', '#C04000');
  assert.ok(p.normal > 20, `sin daltonismo deberían verse distintos: ${p.normal.toFixed(1)}`);
  assert.ok(p.rojoVerde < 15, `con daltonismo rojo-verde deberían acercarse mucho: ${p.rojoVerde.toFixed(1)}`);
  assert.ok(distancia('#336699', '#336699') < 0.001);
});

prueba('«Nuevas» se distingue de cada tono de la barra (repetidas y contacto compartido), para el daltonismo rojo-verde y el azul-amarillo', () => {
  for (const otro of [...COLORES_REPETIDA, COLOR_COMPARTIDO]) {
    const p = peor(COLOR_NUEVA, otro);
    assert.ok(p.rojoVerde >= 8, `«Nuevas» ${COLOR_NUEVA} contra ${otro}: ${p.rojoVerde.toFixed(1)} con daltonismo rojo-verde (se piden 8)`);
    assert.ok(p.azulAmarillo >= 8, `«Nuevas» ${COLOR_NUEVA} contra ${otro}: ${p.azulAmarillo.toFixed(1)} con daltonismo azul-amarillo (se piden 8)`);
    assert.ok(p.normal >= 15, `«Nuevas» ${COLOR_NUEVA} contra ${otro}: ${p.normal.toFixed(1)} sin daltonismo (se piden 15)`);
  }
});

prueba('el verde de antes (#257E55) no pasaba esa misma medición: la prueba habría detectado el problema', () => {
  const contraCafes = COLORES_REPETIDA.map((c) => peor('#257E55', c).rojoVerde);
  assert.ok(Math.min(...contraCafes) < 6, `lo peor era ${Math.min(...contraCafes).toFixed(1)}`);
});

prueba('«Nuevas» se lee sobre fondo blanco (contraste de 3 a 1 o más) y no se parece al azul de «elegibles» ni al rojo de «no elegibles» a simple vista', () => {
  assert.ok(contraste(COLOR_NUEVA, '#ffffff') >= 3, contraste(COLOR_NUEVA, '#ffffff').toFixed(2));
  assert.ok(peor(COLOR_NUEVA, AZUL[2]).normal >= 10, peor(COLOR_NUEVA, AZUL[2]).normal.toFixed(1));
  assert.ok(peor(COLOR_NUEVA, ROJO[3]).normal >= 15, peor(COLOR_NUEVA, ROJO[3]).normal.toFixed(1));
});

prueba('la rampa de repetidas va de claro a oscuro sin saltos ni vueltas, y su tono más claro se ve sobre blanco (2 a 1 o más)', () => {
  const L = COLORES_REPETIDA.map(claridad);
  for (let i = 1; i < L.length; i++) assert.ok(L[i - 1] - L[i] >= 0.06, `paso ${i} a ${i + 1}: ${(L[i - 1] - L[i]).toFixed(3)} de diferencia de claridad (se piden 0.06)`);
  assert.ok(contraste(COLORES_REPETIDA[0], '#ffffff') >= 2, contraste(COLORES_REPETIDA[0], '#ffffff').toFixed(2));
});

prueba('el daltonismo no desordena la rampa de repetidas: sigue yendo de claro a oscuro', () => {
  for (const tipo of ['protan', 'deutan', 'tritan'] as const) {
    const L = COLORES_REPETIDA.map((c) => oklab(simular(aLineal(c), tipo))[0]);
    for (let i = 1; i < L.length; i++) assert.ok(L[i - 1] > L[i], `${tipo}: el paso ${i} a ${i + 1} no baja`);
  }
});

prueba('los vecinos de cada barra apilada de la evolución se distinguen (los que quedan pegados): nuevas, tramos de repetidas y contacto compartido', () => {
  const apilado = [COLOR_NUEVA, ...COLORES_TRAMOS_EVOLUCION, COLOR_COMPARTIDO];
  for (let i = 1; i < apilado.length; i++) {
    const p = peor(apilado[i - 1], apilado[i]);
    assert.ok(p.rojoVerde >= 8 && p.azulAmarillo >= 8 && p.normal >= 8, `${apilado[i - 1]} junto a ${apilado[i]}: ${p.rojoVerde.toFixed(1)} rojo-verde, ${p.azulAmarillo.toFixed(1)} azul-amarillo, ${p.normal.toFixed(1)} normal`);
  }
});

prueba('«entraron siendo elegibles» y «no elegibles» (apilados) se distinguen con cualquier tipo de daltonismo', () => {
  const p = peor(COLOR_ENTRARON_ELEGIBLES, COLOR_ENTRARON_NO_ELEGIBLES);
  assert.ok(p.rojoVerde >= 8 && p.azulAmarillo >= 8 && p.normal >= 15, `${p.rojoVerde.toFixed(1)} rojo-verde, ${p.azulAmarillo.toFixed(1)} azul-amarillo, ${p.normal.toFixed(1)} normal`);
});

prueba('las tres líneas de la calidad se distinguen entre sí (todas contra todas, porque se cruzan) con cualquier tipo de daltonismo', () => {
  const m = masCercanas([COLOR_PCT_REPETIDAS, COLOR_PCT_NO_ELEGIBLES, COLOR_PCT_ENTRO]);
  assert.ok(m.rv.d >= 8, `rojo-verde: ${m.rv.par} a ${m.rv.d.toFixed(1)}`);
  assert.ok(m.aa.d >= 8, `azul-amarillo: ${m.aa.par} a ${m.aa.d.toFixed(1)}`);
  assert.ok(m.no.d >= 15, `sin daltonismo: ${m.no.par} a ${m.no.d.toFixed(1)}`);
});

prueba('todos los colores de las gráficas se ven sobre fondo blanco (contraste de 3 a 1 o más), salvo el gris del contacto compartido y el ámbar más claro, que siempre llevan texto al lado', () => {
  for (const c of [COLOR_NUEVA, COLORES_TRAMOS_EVOLUCION[1], COLORES_TRAMOS_EVOLUCION[2], COLORES_TRAMOS_EVOLUCION[3], COLOR_ENTRARON_ELEGIBLES, COLOR_ENTRARON_NO_ELEGIBLES, COLOR_PCT_REPETIDAS, COLOR_PCT_NO_ELEGIBLES, COLOR_PCT_ENTRO]) {
    assert.ok(contraste(c, '#ffffff') >= 3, `${c}: ${contraste(c, '#ffffff').toFixed(2)}`);
  }
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
