// Pruebas de «subir un concepto como imagen» en Swipe: la lógica pura (src/lib/swipe/concepto.ts) y cómo se arma y se lee
// la solicitud a la IA (src/serverUtils/swipe/leerConcepto.ts), sin llamar a la API. Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-swipe-concepto.ts
import assert from 'node:assert/strict';
import {
  IMAGEN_COMPLETA, MAX_DESCRIPCION, MAX_TITULO, ajustarTexto, avisoDeConcepto, cajaDesdePixeles, dimensionesEscaladas,
  normalizarLectura, rectDeRecorte, tituloDeArchivo,
} from '../../src/lib/swipe/concepto';
import { enCola } from '../../src/lib/swipe/cola';
import { LecturaConceptoError, armarSolicitud, lecturaDeRespuesta } from '../../src/serverUtils/swipe/leerConcepto';

let n = 0;
let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  n++;
  try {
    fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// ── ajustarTexto ─────────────────────────────────────────────────────────────
prueba('un texto corto queda igual', () => {
  assert.equal(ajustarTexto('Café de olla frío', MAX_TITULO), 'Café de olla frío');
});
prueba('junta espacios y saltos de línea en una sola línea', () => {
  assert.equal(ajustarTexto('  Café   de\n olla\t frío ', MAX_TITULO), 'Café de olla frío');
});
prueba('quita las comillas de adorno de los extremos', () => {
  assert.equal(ajustarTexto('«Café de olla frío»', MAX_TITULO), 'Café de olla frío');
  assert.equal(ajustarTexto('"Bici de barrio"', MAX_TITULO), 'Bici de barrio');
});
prueba('texto vacío o indefinido da vacío', () => {
  assert.equal(ajustarTexto('', 10), '');
  assert.equal(ajustarTexto(undefined as unknown as string, 10), '');
});
prueba('si se pasa, corta al final de una oración cuando hay una razonable', () => {
  const t = 'Una bebida lista para llevar con canela y piloncillo. Se vende en botella de vidrio retornable y se anuncia como el sabor de casa.';
  const r = ajustarTexto(t, 80);
  assert.equal(r, 'Una bebida lista para llevar con canela y piloncillo.');
});
prueba('si no hay oración razonable, corta en una palabra y pone «…»', () => {
  const t = 'Bicicletas eléctricas en cada colonia con anclaje en las tiendas de la esquina y pago por minuto';
  const r = ajustarTexto(t, 50);
  assert.ok(r.endsWith('…'), r);
  assert.ok(r.length <= 50, `largo ${r.length}`);
  assert.ok(!r.slice(0, -1).endsWith(' '), 'sin espacio antes de los puntos');
  assert.ok(t.startsWith(r.slice(0, -1)), 'es un prefijo del original');
});
prueba('el resultado nunca pasa del tope, con cualquier largo', () => {
  const base = 'palabra '.repeat(80);
  for (const max of [10, 25, 60, 180]) assert.ok(ajustarTexto(base, max).length <= max, `max ${max}`);
  assert.ok(ajustarTexto('x'.repeat(500), 60).length <= 60);
});

// ── tituloDeArchivo ──────────────────────────────────────────────────────────
prueba('título de reserva: sin extensión, guiones ni número de copia', () => {
  assert.equal(tituloDeArchivo('cafe-de-olla_frio.png'), 'Cafe de olla frio');
  assert.equal(tituloDeArchivo('Bici compartida (1).JPG'), 'Bici compartida');
  assert.equal(tituloDeArchivo('IMG_2034.jpeg'), 'IMG 2034');
});
prueba('título de reserva: sin nada legible es «Concepto» y nunca pasa del tope', () => {
  assert.equal(tituloDeArchivo(''), 'Concepto');
  assert.equal(tituloDeArchivo('.png'), 'Concepto');
  assert.ok(tituloDeArchivo(`${'archivo-largo-'.repeat(20)}.png`).length <= MAX_TITULO);
});

// ── cajaDesdePixeles ─────────────────────────────────────────────────────────
prueba('caja normal: pasa de píxeles a fracciones', () => {
  assert.deepEqual(cajaDesdePixeles({ x1: 78, y1: 123, x2: 862, y2: 761 }, 1568, 882),
    { x: 0.0497, y: 0.1395, w: 0.5, h: 0.7234 });
});
prueba('caja que se sale de la imagen se recorta a la imagen', () => {
  const c = cajaDesdePixeles({ x1: -40, y1: 10, x2: 2000, y2: 500 }, 1000, 800)!;
  assert.equal(c.x, 0);
  assert.equal(c.w, 1);
  assert.equal(c.y, 0.0125);
});
prueba('esquinas al revés se ordenan', () => {
  assert.deepEqual(cajaDesdePixeles({ x1: 600, y1: 500, x2: 100, y2: 100 }, 1000, 1000), { x: 0.1, y: 0.1, w: 0.5, h: 0.4 });
});
prueba('una caja que cubre casi toda la imagen es la imagen completa', () => {
  assert.deepEqual(cajaDesdePixeles({ x1: 3, y1: 2, x2: 1566, y2: 880 }, 1568, 882), IMAGEN_COMPLETA);
  assert.deepEqual(cajaDesdePixeles({ x1: 0, y1: 0, x2: 1536, y2: 1024 }, 1536, 1024), IMAGEN_COMPLETA);
});
prueba('una caja diminuta (un logotipo) o vacía no es la ilustración', () => {
  assert.equal(cajaDesdePixeles({ x1: 100, y1: 100, x2: 160, y2: 150 }, 1568, 882), null);
  assert.equal(cajaDesdePixeles({ x1: 0, y1: 0, x2: 0, y2: 0 }, 1568, 882), null);
});
prueba('números inservibles dan null', () => {
  assert.equal(cajaDesdePixeles({ x1: NaN, y1: 0, x2: 10, y2: 10 }, 100, 100), null);
  assert.equal(cajaDesdePixeles({ x1: 0, y1: 0, x2: 10, y2: 10 }, 0, 100), null);
});

// ── normalizarLectura ────────────────────────────────────────────────────────
const cruda = {
  titulo: 'Café de olla frío', descripcion: 'Bebida lista para llevar con café de olla, canela y piloncillo.', textoEnImagen: true,
  tieneIlustracion: true, ilustracion: { x1: 100, y1: 100, x2: 600, y2: 500 },
};
prueba('lectura normal: textos y caja en fracciones', () => {
  assert.deepEqual(normalizarLectura(cruda, 1000, 800), {
    titulo: 'Café de olla frío', descripcion: 'Bebida lista para llevar con café de olla, canela y piloncillo.', textoEnImagen: true,
    ilustracion: { x: 0.1, y: 0.125, w: 0.5, h: 0.5 },
  });
});
prueba('sin ilustración: la caja se ignora aunque traiga números', () => {
  assert.equal(normalizarLectura({ ...cruda, tieneIlustracion: false }, 1000, 800).ilustracion, null);
});
prueba('los textos pasados de largo quedan dentro de los topes', () => {
  const l = normalizarLectura({ ...cruda, titulo: 'T'.repeat(200), descripcion: 'palabra '.repeat(100) }, 1000, 800);
  assert.ok(l.titulo.length <= MAX_TITULO);
  assert.ok(l.descripcion.length <= MAX_DESCRIPCION);
});

// ── avisoDeConcepto ──────────────────────────────────────────────────────────
prueba('aviso: una lectura limpia no avisa nada', () => {
  assert.equal(avisoDeConcepto({ estado: 'leido', textoEnImagen: true, conIlustracion: true }), undefined);
});
prueba('aviso: cada caso que pide revisión dice qué hacer', () => {
  assert.match(avisoDeConcepto({ estado: 'apagada' })!, /Sin IA/);
  assert.equal(avisoDeConcepto({ estado: 'fallo', motivo: 'La IA tardó más de 10 s.' }), 'La IA tardó más de 10 s. Pon el nombre y la descripción.');
  assert.equal(avisoDeConcepto({ estado: 'fallo', motivo: '' }), 'Pon el nombre y la descripción.');
  assert.match(avisoDeConcepto({ estado: 'leido', textoEnImagen: false, conIlustracion: true })!, /No traía texto/);
  assert.match(avisoDeConcepto({ estado: 'leido', textoEnImagen: true, conIlustracion: false })!, /Solo traía texto/);
});

// ── dimensionesEscaladas y rectDeRecorte ─────────────────────────────────────
prueba('copia para la IA: baja el lado largo y no agranda lo que ya es chico', () => {
  assert.deepEqual(dimensionesEscaladas(1920, 1080, 1568), { ancho: 1568, alto: 882 });
  assert.deepEqual(dimensionesEscaladas(1080, 1350, 1568), { ancho: 1080, alto: 1350 });
  assert.deepEqual(dimensionesEscaladas(4000, 1000, 2000), { ancho: 2000, alto: 500 });
  assert.deepEqual(dimensionesEscaladas(1, 1, 1568), { ancho: 1, alto: 1 });
});
prueba('recorte: la caja en píxeles del original, con un poco de holgura y sin salirse', () => {
  const r = rectDeRecorte({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, 2000, 1000, 0.01);
  assert.ok(r.sx <= 200 && r.sx + r.sw >= 1200, 'cubre la caja');
  assert.ok(r.sy <= 200 && r.sy + r.sh >= 600, 'cubre la caja en vertical');
  assert.ok(r.sw <= 0.5 * 2000 * 1.03 && r.sh <= 0.4 * 1000 * 1.03, 'la holgura es chica');
});
prueba('recorte: en los bordes se queda dentro de la imagen y con enteros', () => {
  const r = rectDeRecorte({ x: 0, y: 0, w: 0.5, h: 1 }, 1001, 777, 0.02);
  assert.equal(r.sx, 0);
  assert.equal(r.sy, 0);
  assert.ok(r.sy + r.sh <= 777);
  assert.ok(Number.isInteger(r.sw) && Number.isInteger(r.sh));
  assert.ok(r.sw >= 1 && r.sh >= 1);
});

// ── la solicitud a la IA ─────────────────────────────────────────────────────
prueba('solicitud: imagen en base64, esquema fijo y ningún ajuste que el modelo rechaza', () => {
  const s = armarSolicitud({ imagen: 'QUJD', tipo: 'image/jpeg', ancho: 1568, alto: 882 }) as unknown as Record<string, any>;
  const bloques = s.messages[0].content as Array<Record<string, any>>;
  assert.equal(bloques[0].type, 'image');
  assert.deepEqual(bloques[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
  assert.ok(String(bloques[1].text).includes('1568×882'), 'le dice el tamaño en píxeles');
  assert.equal(s.output_config.effort, 'low');
  assert.equal(s.output_config.format.type, 'json_schema');
  // Estos tres dan 400 en Sonnet 5.5 / Opus 5.5 / Fable 5.1: que nadie los vuelva a poner por costumbre.
  for (const prohibido of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) assert.ok(!(prohibido in s), prohibido);
  assert.ok(s.max_tokens >= 2000, 'cabe el razonamiento y la respuesta');
});
prueba('solicitud: el esquema pide todos sus campos y no admite otros', () => {
  const s = armarSolicitud({ imagen: 'QUJD', tipo: 'image/png', ancho: 10, alto: 10 }) as unknown as Record<string, any>;
  const esq = s.output_config.format.schema;
  assert.deepEqual([...esq.required].sort(), Object.keys(esq.properties).sort());
  assert.equal(esq.additionalProperties, false);
  assert.deepEqual([...esq.properties.ilustracion.required].sort(), ['x1', 'x2', 'y1', 'y2']);
});

// ── leer la respuesta de la IA ───────────────────────────────────────────────
const texto = (t: string) => ({ type: 'text' as const, text: t, citations: null });
const respuesta = (stop: string, ...content: unknown[]) => ({ stop_reason: stop, content } as never);
const motivo = (fn: () => unknown) => { try { fn(); return 'no falló'; } catch (e) { return e instanceof LecturaConceptoError ? e.motivo : `otro: ${(e as Error).message}`; } };

prueba('respuesta buena: se valida y se normaliza', () => {
  const l = lecturaDeRespuesta(respuesta('end_turn', texto(JSON.stringify(cruda))), 1000, 800);
  assert.equal(l.titulo, 'Café de olla frío');
  assert.deepEqual(l.ilustracion, { x: 0.1, y: 0.125, w: 0.5, h: 0.5 });
});
prueba('un bloque de razonamiento antes del texto no estorba', () => {
  const l = lecturaDeRespuesta(respuesta('end_turn', { type: 'thinking', thinking: '', signature: 'x' }, texto(JSON.stringify(cruda))), 1000, 800);
  assert.equal(l.textoEnImagen, true);
});
prueba('la IA se niega: motivo RECHAZADA', () => {
  assert.equal(motivo(() => lecturaDeRespuesta(respuesta('refusal'), 10, 10)), 'RECHAZADA');
});
prueba('respuesta cortada por largo: motivo INCOMPLETA', () => {
  assert.equal(motivo(() => lecturaDeRespuesta(respuesta('max_tokens', texto('{"titulo":"Ca')), 10, 10)), 'INCOMPLETA');
});
prueba('lo que no es JSON o no cumple el esquema: motivo INVALIDA', () => {
  assert.equal(motivo(() => lecturaDeRespuesta(respuesta('end_turn', texto('Claro, aquí está')), 10, 10)), 'INVALIDA');
  assert.equal(motivo(() => lecturaDeRespuesta(respuesta('end_turn', texto('{"titulo":"x"}')), 10, 10)), 'INVALIDA');
  assert.equal(motivo(() => lecturaDeRespuesta(respuesta('end_turn'), 10, 10)), 'INVALIDA');
});

// ── enCola: varias imágenes a la vez, respetando el orden de la lista ────────────────────────────────────────────────
const espera = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const pendientes: Promise<void>[] = [];
function pruebaAsync(nombre: string, fn: () => Promise<void>) {
  n++;
  pendientes.push(fn().then(
    () => console.log(`ok   ${nombre}`),
    (e) => { fallas++; console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`); },
  ));
}

pruebaAsync('cola: nunca corre más tareas a la vez que el límite y entrega los resultados en el orden pedido', async () => {
  const retardos = [30, 5, 20, 1, 15, 3, 25, 8];
  let activas = 0;
  let maximo = 0;
  const tareas = retardos.map((ms, i) => async () => {
    activas++;
    maximo = Math.max(maximo, activas);
    await espera(ms);
    activas--;
    return i;
  });
  const resultados = await Promise.all(enCola(tareas, 3));
  assert.deepEqual(resultados, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(maximo, 3);
});
pruebaAsync('cola: una tarea que falla no detiene a las demás', async () => {
  const tareas = [
    async () => 'a',
    async () => { await espera(5); throw new Error('boom'); },
    async () => 'c',
    () => { throw new Error('lanzó antes de devolver su promesa'); },
    async () => 'e',
  ] as Array<() => Promise<string>>;
  const r = await Promise.allSettled(enCola(tareas, 2));
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'rejected', 'fulfilled', 'rejected', 'fulfilled']);
  assert.equal((r[0] as PromiseFulfilledResult<string>).value, 'a');
  assert.equal((r[4] as PromiseFulfilledResult<string>).value, 'e');
});
pruebaAsync('cola: lista vacía, y un límite inválido se toma como 1', async () => {
  assert.deepEqual(enCola([], 3), []);
  let activas = 0;
  let maximo = 0;
  const tarea = async () => { activas++; maximo = Math.max(maximo, activas); await espera(2); activas--; };
  await Promise.all(enCola([tarea, tarea, tarea], 0));
  assert.equal(maximo, 1);
});

await Promise.all(pendientes);
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
