// Pruebas de mandar el NDA a varias personas a la vez (por grupo o por selección): a quién se puede mandar y quién viene marcado de entrada, y que el envío vaya
// de una en una, siga si una falla y se pueda detener. Solo la lógica (src/lib/nda.ts); no manda nada. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-nda-lote.ts
import assert from 'node:assert/strict';
import { clasificarParaLote, enviarEnLote } from '../../src/lib/nda';

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

const CORREO = 'ana@ejemplo.test';

await prueba('quien no tiene nada viene marcada para mandarle el NDA', () => {
  assert.deepEqual(clasificarParaLote({ correo: CORREO }), { puede: true, marcada: true });
  assert.deepEqual(clasificarParaLote({ correo: CORREO, ndaSent: false }), { puede: true, marcada: true });
});

await prueba('sin correo no se puede marcar (vacío, espacios o sin dato), aunque tenga la marca a mano', () => {
  for (const correo of [undefined, null, '', '   ']) {
    assert.deepEqual(clasificarParaLote({ correo, ndaSent: true }), { puede: false, marcada: false, motivo: 'sin-correo' });
  }
});

await prueba('quien ya firmó o rechazó no se puede marcar: otro NDA se manda de una en una desde su detalle', () => {
  assert.deepEqual(clasificarParaLote({ correo: CORREO }, { estado: 'firmado' }), { puede: false, marcada: false, motivo: 'firmado' });
  assert.deepEqual(clasificarParaLote({ correo: CORREO }, { estado: 'rechazado' }), { puede: false, marcada: false, motivo: 'rechazado' });
});

await prueba('quien ya tiene un NDA sin firmar (Enviado o Abrió) se puede marcar, pero viene sin marcar', () => {
  assert.deepEqual(clasificarParaLote({ correo: CORREO }, { estado: 'enviado' }), { puede: true, marcada: false, motivo: 'pendiente' });
  assert.deepEqual(clasificarParaLote({ correo: CORREO }, { estado: 'abierto' }), { puede: true, marcada: false, motivo: 'pendiente' });
});

await prueba('lo marcado a mano como enviado (sin liga) se puede marcar, pero viene sin marcar; con un envío con liga manda el envío', () => {
  assert.deepEqual(clasificarParaLote({ correo: CORREO, ndaSent: true }), { puede: true, marcada: false, motivo: 'marcado' });
  assert.deepEqual(clasificarParaLote({ correo: CORREO, ndaSent: true }, { estado: 'firmado' }), { puede: false, marcada: false, motivo: 'firmado' });
  assert.deepEqual(clasificarParaLote({ correo: CORREO, ndaSent: true }, { estado: 'enviado' }), { puede: true, marcada: false, motivo: 'pendiente' });
});

await prueba('el envío va de una en una y en orden, esperando a que termine cada una', async () => {
  const llamadas: string[] = [];
  let enCurso = 0;
  let maximo = 0;
  const r = await enviarEnLote(['a', 'b', 'c'], async (id) => {
    enCurso++; maximo = Math.max(maximo, enCurso);
    llamadas.push(id);
    await new Promise((res) => setTimeout(res, 5));
    enCurso--;
    return { success: true, message: `Mandado a ${id}` };
  });
  assert.deepEqual(llamadas, ['a', 'b', 'c']);
  assert.equal(maximo, 1);
  assert.deepEqual(r, [
    { id: 'a', ok: true, mensaje: 'Mandado a a' },
    { id: 'b', ok: true, mensaje: 'Mandado a b' },
    { id: 'c', ok: true, mensaje: 'Mandado a c' },
  ]);
});

await prueba('si una falla (respuesta de no enviado o error de red) las demás se siguen mandando y cada una cuenta su resultado', async () => {
  const llamadas: string[] = [];
  const r = await enviarEnLote(['a', 'b', 'c', 'd'], async (id) => {
    llamadas.push(id);
    if (id === 'b') return { success: false, message: 'Este participante no tiene correo.' };
    if (id === 'c') throw new Error('red caída');
    return { success: true, message: 'ok' };
  });
  assert.deepEqual(llamadas, ['a', 'b', 'c', 'd']);
  assert.deepEqual(r.map((x) => x.ok), [true, false, false, true]);
  assert.equal(r[1].mensaje, 'Este participante no tiene correo.');
  assert.equal(r[2].mensaje, 'No se pudo enviar. Inténtalo de nuevo.');
  assert.ok(!JSON.stringify(r).includes('red caída'), 'el detalle técnico del error no se le muestra a la persona');
});

await prueba('avisa el avance después de cada envío', async () => {
  const avances: [number, number][] = [];
  await enviarEnLote(['a', 'b', 'c'], async () => ({ success: true, message: '' }), { alAvanzar: (h, t) => avances.push([h, t]) });
  assert.deepEqual(avances, [[1, 3], [2, 3], [3, 3]]);
});

await prueba('al detener, lo que falta no se manda y queda anotado como omitido', async () => {
  const llamadas: string[] = [];
  let detenido = false;
  const r = await enviarEnLote(['a', 'b', 'c', 'd'], async (id) => {
    llamadas.push(id);
    if (id === 'b') detenido = true; // se pide detener mientras se manda la segunda
    return { success: true, message: 'ok' };
  }, { detener: () => detenido });
  assert.deepEqual(llamadas, ['a', 'b']);
  assert.deepEqual(r.map((x) => [x.id, x.ok, !!x.omitido]), [['a', true, false], ['b', true, false], ['c', false, true], ['d', false, true]]);
});

await prueba('sin nadie que mandar, no hace nada', async () => {
  let llamado = false;
  assert.deepEqual(await enviarEnLote([], async () => { llamado = true; return { success: true, message: '' }; }), []);
  assert.equal(llamado, false);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
