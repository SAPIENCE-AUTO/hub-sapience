// Pruebas de la lógica de la pantalla de guías de tópicos (src/lib/guias/): topes que valida el servidor, cómo se aplica el roadmap que devuelve la IA, qué se conserva de lo
// ya escrito, el texto para copiar y la descarga del Word. Funciones puras con datos inventados; no toca la base ni la IA.
// uso: node server/node_modules/.bin/tsx server/scripts/test-guias-ui.ts
import assert from 'node:assert/strict';
import {
  BLOQUE_WARM_UP, DURACION_MAX, DURACION_MIN, MAX_BLOQUES, aplicarRoadmapIA, acotarBloque, acotarEstado, base64ABlob, conMuestra, duracionValida, guiaAlineada, guiaTexto,
  leerEstado, minutosFaltan, perfilesDe, proyectoPrellenado, renglones, roadmapListo, roadmapManual, TIPO_WORD,
} from '../../src/lib/guias/texto';
import { estadoVacio, minutosRoadmap, realinearGuia } from '../../src/lib/guias/types';
import type { BloqueGuia, EstadoGuia } from '../../src/lib/guias/types';

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

const bloque = (nombre: string, minutos: number, objetivos: string[] = ['Entender algo']) => ({ nombre, minutos, objetivos });
const escrito = (moderador: string): BloqueGuia => ({ moderador, secciones: [{ subtema: 'Primeras impresiones', preguntas: ['¿Qué opinan?'], notas: [] }] });
const base = (o: Partial<EstadoGuia> = {}): EstadoGuia => ({ ...estadoVacio(), proyecto: 'Marca Demo – Estudio', duracion: 60, ...o });
const conRoadmap = (bloques: ReturnType<typeof bloque>[], guia: (BloqueGuia | null)[] = [], o: Partial<EstadoGuia> = {}): EstadoGuia =>
  base({ roadmap: { muestra: [], bloques }, guia: bloques.map((_, i) => guia[i] ?? null), ...o });

await prueba('la duración vale entre 15 y 480 minutos enteros', () => {
  assert.equal(DURACION_MIN, 15);
  assert.equal(DURACION_MAX, 480);
  for (const bien of [15, 60, 120, 480]) assert.equal(duracionValida(bien), true, String(bien));
  for (const mal of [0, 14, 481, 90.5, NaN]) assert.equal(duracionValida(mal), false, String(mal));
});

await prueba('renglones: acota cuántos y de qué largo, pero no quita los vacíos (el cursor no brinca)', () => {
  assert.deepEqual(renglones('a\n\nb\n', 10, 10), ['a', '', 'b', '']);
  assert.deepEqual(renglones('1\n2\n3\n4', 2, 10), ['1', '2']);
  assert.deepEqual(renglones('abcdefghij', 5, 4), ['abcd']);
});

await prueba('perfilesDe: un perfil por renglón, sin vacíos, a lo más 20 de 500 caracteres', () => {
  assert.deepEqual(perfilesDe('  Mamás de 25 a 35  \n\n   \nPapás'), ['Mamás de 25 a 35', 'Papás']);
  assert.equal(perfilesDe(Array.from({ length: 30 }, (_, i) => `p${i}`).join('\n')).length, 20);
  assert.equal(perfilesDe('x'.repeat(900))[0].length, 500);
});

await prueba('el proyecto se prellena con «marca – estudio», sin repetir la marca si ya viene en el nombre', () => {
  assert.equal(proyectoPrellenado({ client: 'Marca Demo', fullName: 'Diagnóstico de empaque', projectCode: 'DEMO-01' }), 'Marca Demo – Diagnóstico de empaque');
  assert.equal(proyectoPrellenado({ client: 'Marca Demo', fullName: 'Marca Demo: diagnóstico', projectCode: 'DEMO-01' }), 'Marca Demo: diagnóstico');
  assert.equal(proyectoPrellenado({ client: null, fullName: 'Solo el estudio', projectCode: 'X' }), 'Solo el estudio');
  assert.equal(proyectoPrellenado({ client: 'Solo marca', fullName: '', projectCode: 'X' }), 'Solo marca');
  assert.equal(proyectoPrellenado({ projectCode: 'DEMO-01' }), 'DEMO-01');
  assert.equal(proyectoPrellenado({}), '');
  assert.equal(proyectoPrellenado({ client: 'a', fullName: 'b'.repeat(400) }).length, 300);
});

await prueba('la muestra se cambia en el texto y, si ya hay roadmap, también en su carátula', () => {
  const sin = conMuestra(base(), 'Un perfil');
  assert.equal(sin.muestraText, 'Un perfil');
  assert.equal(sin.roadmap, null);
  const con = conMuestra(conRoadmap([bloque('Warm up', 5)]), 'Uno\n\n  Dos  ');
  assert.equal(con.muestraText, 'Uno\n\n  Dos  ');
  assert.deepEqual(con.roadmap?.muestra, ['Uno', 'Dos']);
});

await prueba('leerEstado: una guía vieja, incompleta o rara se completa y queda consistente', () => {
  const vacio = leerEstado(null);
  assert.deepEqual(vacio, estadoVacio());
  const raro = leerEstado({ modo: 'brief', duracion: 5000, roadmap: { bloques: [bloque('A', 10), bloque('B', 20)] }, guia: [escrito('hola')], supuestos: 'no es lista' });
  assert.equal(raro.modo, 'brief');
  assert.equal(raro.duracion, DURACION_MAX);
  assert.equal(raro.guia.length, 2);
  assert.equal(raro.guia[0]?.moderador, 'hola');
  assert.equal(raro.guia[1], null);
  assert.deepEqual(raro.supuestos, []);
  assert.deepEqual(raro.roadmap?.muestra, []);
  assert.equal(leerEstado({ roadmap: { bloques: 'nada' } }).roadmap, null);
  // una guía guardada antes de que existiera el roadmap pegado no lo trae: queda vacío; y si lo trae, se conserva
  assert.equal(raro.roadmapText, '');
  assert.equal(leerEstado({ roadmapText: '1 | Warm up | 5 min' }).roadmapText, '1 | Warm up | 5 min');
});

await prueba('acotarEstado deja el estado dentro de los topes del servidor y no cambia lo que ya cabe', () => {
  const normal = conRoadmap([bloque('Warm up', 5), bloque('Central', 55)], [escrito('hola'), null], { tema: 'un tema', muestraText: 'perfil' });
  assert.deepEqual(acotarEstado(normal), normal);
  assert.deepEqual(acotarEstado(acotarEstado(normal)), acotarEstado(normal));

  const largo = 'x'.repeat(5000);
  const excedido = conRoadmap(
    Array.from({ length: 25 }, (_, i) => ({ nombre: largo, minutos: i === 0 ? 9999 : 5.4, objetivos: Array.from({ length: 20 }, () => largo) })),
    [{ moderador: largo, secciones: Array.from({ length: 30 }, () => ({ subtema: largo, intro: largo, preguntas: [largo, { texto: largo, sub: Array.from({ length: 40 }, () => largo) }], notas: [largo] })) }],
    { proyecto: largo, duracion: 5, tema: largo, estimulos: largo, notas: largo, muestraText: largo, briefText: 'b'.repeat(70_000), roadmapText: 'r'.repeat(70_000), supuestos: Array.from({ length: 30 }, () => largo) },
  );
  const a = acotarEstado(excedido);
  assert.equal(a.proyecto.length, 300);
  assert.equal(a.duracion, DURACION_MIN);
  assert.equal(a.muestraText.length, 4000);
  assert.equal(a.briefText.length, 60_000);
  assert.equal(a.roadmapText.length, 60_000);
  assert.equal(a.roadmap?.bloques.length, MAX_BLOQUES);
  assert.equal(a.roadmap?.bloques[0].nombre.length, 200);
  assert.equal(a.roadmap?.bloques[0].minutos, 600);
  assert.equal(a.roadmap?.bloques[1].minutos, 5);
  assert.equal(a.roadmap?.bloques[0].objetivos.length, 15);
  assert.equal(a.roadmap?.bloques[0].objetivos[0].length, 500);
  assert.equal(a.supuestos.length, 20);
  assert.equal(a.guia.length, MAX_BLOQUES);
  const g = a.guia[0]!;
  assert.equal(g.moderador.length, 3000);
  assert.equal(g.secciones.length, 20);
  assert.equal(g.secciones[0].subtema.length, 300);
  assert.equal(g.secciones[0].intro?.length, 2000);
  const q = g.secciones[0].preguntas[1];
  assert.ok(typeof q !== 'string' && q.sub.length === 30 && q.sub[0].length === 500 && q.texto.length === 2000);
  assert.equal(acotarBloque(null), null);
});

await prueba('acotarEstado cumple el esquema del servidor (si ya está en src/serverUtils/guias)', async () => {
  const modulo = await import('../../src/serverUtils/guias/esquemas').catch(() => null);
  if (!modulo) { console.log('       (omitida: todavía no existe src/serverUtils/guias/esquemas.ts)'); return; }
  const largo = 'y'.repeat(6000);
  const sucio = conRoadmap(
    Array.from({ length: 22 }, () => ({ nombre: largo, minutos: 7.7, objetivos: Array.from({ length: 18 }, () => largo) })),
    [{ moderador: largo, secciones: [{ subtema: largo, preguntas: [largo], notas: [largo] }] }],
    { duracion: 3, proyecto: largo, briefText: 'b'.repeat(80_000), roadmapText: 'r'.repeat(80_000) },
  );
  const r = modulo.EstadoGuiaZ.safeParse(acotarEstado(sucio));
  assert.equal(r.success, true, r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3)));
  const vacia = modulo.EstadoGuiaZ.safeParse(acotarEstado(estadoVacio()));
  assert.equal(vacia.success, true);
});

await prueba('guiaAlineada: un lugar por bloque, null donde no hay nada escrito', () => {
  const s = { ...conRoadmap([bloque('A', 5), bloque('B', 5), bloque('C', 5)]), guia: [escrito('a')] as (BloqueGuia | null)[] };
  const g = guiaAlineada(s);
  assert.equal(g.length, 3);
  assert.equal(g[0]?.moderador, 'a');
  assert.equal(g[1], null);
  assert.equal(guiaAlineada(base()).length, 0);
});

await prueba('realinearGuia: lo escrito se conserva solo en los bloques que quedaron igual', () => {
  const antes = conRoadmap([bloque('Warm up', 5), bloque('Central', 40), bloque('Cierre', 15)], [escrito('uno'), escrito('dos'), escrito('tres')]);
  const igual = realinearGuia(antes, [bloque('Warm up', 5), bloque('Central', 40), bloque('Cierre', 15)]);
  assert.deepEqual(igual.map((g) => g?.moderador), ['uno', 'dos', 'tres']);
  const cambiado = realinearGuia(antes, [bloque('Warm up', 5), bloque('Central', 45), bloque('Cierre', 10)]);
  assert.deepEqual(cambiado.map((g) => g?.moderador ?? null), ['uno', null, null]);
  const movido = realinearGuia(antes, [bloque('Cierre', 15), bloque('Warm up', 5)]);
  assert.deepEqual(movido.map((g) => g?.moderador), ['tres', 'uno']);
  const objetivos = realinearGuia(antes, [bloque('Warm up', 5, ['Otro objetivo'])]);
  assert.deepEqual(objetivos, [null]);
});

await prueba('roadmapManual: el warm up de 5 minutos y un bloque en blanco con el resto', () => {
  const m = roadmapManual(base({ duracion: 90, muestraText: 'Perfil A\nPerfil B', supuestos: ['algo'], guia: [escrito('x')] }));
  assert.equal(m.roadmap?.bloques.length, 2);
  assert.deepEqual(m.roadmap?.bloques[0], BLOQUE_WARM_UP);
  assert.notEqual(m.roadmap?.bloques[0].objetivos, BLOQUE_WARM_UP.objetivos);
  assert.deepEqual(m.roadmap?.bloques[1], { nombre: '', minutos: 85, objetivos: [] });
  assert.deepEqual(m.roadmap?.muestra, ['Perfil A', 'Perfil B']);
  assert.deepEqual(m.guia, [null, null]);
  assert.deepEqual(m.supuestos, []);
  assert.equal(roadmapManual(base({ duracion: 15 })).roadmap?.bloques[1].minutos, 10);
});

await prueba('roadmapListo y minutosFaltan: hay bloques, todos con nombre, y se ve cuánto falta o sobra', () => {
  assert.equal(roadmapListo(base()), false);
  assert.equal(roadmapListo(conRoadmap([])), false);
  assert.equal(roadmapListo(conRoadmap([bloque('A', 30), bloque('  ', 30)])), false);
  assert.equal(roadmapListo(conRoadmap([bloque('A', 30), bloque('B', 30)])), true);
  assert.equal(minutosFaltan(conRoadmap([bloque('A', 30), bloque('B', 20)])), 10);
  assert.equal(minutosFaltan(conRoadmap([bloque('A', 40), bloque('B', 30)])), -10);
  assert.equal(minutosFaltan(conRoadmap([bloque('A', 30), bloque('B', 30)])), 0);
  assert.equal(minutosRoadmap([bloque('A', 30), bloque('B', 20)]), 50);
});

await prueba('aplicarRoadmapIA al proponer: pone los bloques y supuestos, conserva lo escrito que quedó igual y respeta lo que la persona ya escribió', () => {
  const antes = conRoadmap([bloque('Warm up', 5), bloque('Central', 55)], [escrito('uno'), escrito('dos')], { modo: 'tema', muestraText: 'Mi perfil', proyecto: 'Mi proyecto', duracion: 60 });
  const res = {
    roadmap: { muestra: ['Perfil de la IA'], bloques: [bloque('Warm up', 5), bloque('Evaluación', 45), bloque('Cierre', 10)] },
    supuestos: ['Se evalúa a ciegas'], proyecto: 'Nombre de la IA', duracion: 90,
  };
  const d = aplicarRoadmapIA(antes, res, 'proponer');
  assert.deepEqual(d.roadmap?.bloques.map((b) => b.nombre), ['Warm up', 'Evaluación', 'Cierre']);
  assert.deepEqual(d.guia.map((g) => g?.moderador ?? null), ['uno', null, null]);
  assert.deepEqual(d.supuestos, ['Se evalúa a ciegas']);
  assert.equal(d.proyecto, 'Mi proyecto');
  assert.equal(d.duracion, 60);
  assert.deepEqual(d.roadmap?.muestra, ['Perfil de la IA']);
  assert.equal(d.muestraText, 'Perfil de la IA');
  assert.equal(d.guia.length, d.roadmap?.bloques.length);
});

await prueba('aplicarRoadmapIA: la duración la define el roadmap que se lee o el ajuste que se pide; el proyecto solo si estaba vacío; sin muestra de la IA se queda la de la persona', () => {
  const res = { roadmap: { bloques: [bloque('Warm up', 5), bloque('Central', 85)] }, supuestos: [], proyecto: 'Nombre leído', duracion: 90 };
  const leer = aplicarRoadmapIA(base({ modo: 'roadmap', proyecto: '', duracion: 120, muestraText: 'Mi muestra' }), res, 'proponer');
  assert.equal(leer.duracion, 90);
  assert.equal(leer.proyecto, 'Nombre leído');
  assert.equal(leer.muestraText, 'Mi muestra');
  assert.deepEqual(leer.roadmap?.muestra, ['Mi muestra']);
  const ajustar = aplicarRoadmapIA(conRoadmap([bloque('A', 60)], [], { modo: 'brief', duracion: 60 }), { ...res, duracion: 90 }, 'ajustar');
  assert.equal(ajustar.duracion, 90);
  const brief = aplicarRoadmapIA(base({ modo: 'brief', duracion: 120 }), res, 'proponer');
  assert.equal(brief.duracion, 120);
  const invalida = aplicarRoadmapIA(base({ modo: 'roadmap', duracion: 120 }), { ...res, duracion: 7 }, 'proponer');
  assert.equal(invalida.duracion, 120);
  const sinNumero = aplicarRoadmapIA(base({ modo: 'roadmap', duracion: 120 }), { roadmap: res.roadmap, supuestos: [] }, 'proponer');
  assert.equal(sinNumero.duracion, 120);
});

await prueba('guiaTexto: título, tipo, tema, muestra y cada bloque con su moderador, preguntas, opciones y notas; lo sin escribir lo dice y las negritas se quitan', () => {
  const s = conRoadmap([bloque('Warm up', 5), bloque('Central', 55)], [{
    moderador: 'Gracias por venir',
    secciones: [
      { subtema: 'Ejercicio individual', intro: 'Anoten **sin comentar**', preguntas: ['¿Qué tan llamativo?', { texto: 'Díganme qué valoran:', sub: ['Empaque', 'Sabor'] }], notas: ['El moderador rota el orden'] },
    ],
  }, null], { tema: 'Compra de pañales', muestraText: 'Mamás de 25 a 35' });
  const t = guiaTexto('Guía de prueba', s);
  const l = t.split('\n');
  assert.equal(l[0], 'Guía de prueba');
  assert.equal(l[1], 'Sesión de grupo · 60 min.');
  assert.ok(t.includes('Tema: Compra de pañales'));
  assert.ok(t.includes('Muestra:\n- Mamás de 25 a 35'));
  assert.ok(t.includes('1. Warm up (5 min.)\nModerador: Gracias por venir'));
  assert.ok(t.includes('• ¿Qué tan llamativo?'));
  assert.ok(t.includes('• Díganme qué valoran:\n   – Empaque\n   – Sabor'));
  assert.ok(t.includes('Nota: El moderador rota el orden'));
  assert.ok(t.includes('Anoten sin comentar'));
  assert.ok(!t.includes('**'));
  assert.ok(t.includes('2. Central (55 min.)\n(Bloque por escribir)'));
  assert.ok(t.endsWith('Cierre y agradecimientos.'));
});

await prueba('base64ABlob: el archivo sale con los mismos bytes y el tipo del Word', async () => {
  const original = Uint8Array.from([80, 75, 3, 4, 0, 255, 128, 10, 13, 65]);
  const blob = base64ABlob(Buffer.from(original).toString('base64'));
  assert.equal(blob.type, TIPO_WORD);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original);
  assert.equal(base64ABlob('').size, 0);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
