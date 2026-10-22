// Pruebas del orden manual de las filas de la lista de eventos (src/lib/ordenFilas.ts): cómo se ordena un grupo y qué números salen al soltar una fila.
// Funciones puras, sin base ni navegador. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-orden-filas.ts
import assert from 'node:assert/strict';
import { PASO_ORDEN, ordenarFilas, ordenTrasSoltar, quedaDondeEstaba } from '../../src/lib/ordenFilas';

let n = 0;
let fallas = 0;
function prueba(nombre: string, fn: () => void) {
  n++;
  try {
    fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}

const f = (id: string, rowOrder?: number | null) => ({ id, rowOrder });
const ids = (filas: { id: string }[]) => filas.map((x) => x.id);

prueba('un grupo que nadie ha arrastrado queda igual: mismo orden en que llegó (por fecha de creación)', () => {
  assert.deepEqual(ids(ordenarFilas([f('c'), f('a'), f('b')])), ['c', 'a', 'b']);
  assert.deepEqual(ids(ordenarFilas([f('c', null), f('a', undefined)])), ['c', 'a']);
});
prueba('las filas acomodadas a mano van por su número', () => {
  assert.deepEqual(ids(ordenarFilas([f('a', 3000), f('b', 1000), f('c', 2000)])), ['b', 'c', 'a']);
});
prueba('un evento nuevo (sin número) cae al final del grupo, no hasta arriba; los nuevos entre sí quedan en orden de llegada', () => {
  assert.deepEqual(ids(ordenarFilas([f('nuevo1'), f('a', 2000), f('nuevo2'), f('b', 1000)])), ['b', 'a', 'nuevo1', 'nuevo2']);
});
prueba('un número 0 cuenta como acomodado a mano (no se confunde con «sin número»)', () => {
  assert.deepEqual(ids(ordenarFilas([f('a'), f('b', 0)])), ['b', 'a']);
});
prueba('no modifica la lista que recibe', () => {
  const lista = [f('b', 2000), f('a', 1000)];
  ordenarFilas(lista);
  assert.deepEqual(ids(lista), ['b', 'a']);
});

prueba('soltar antes de otra fila: el grupo se renumera de 1000 en 1000 con la fila en su lugar nuevo', () => {
  const grupo = [f('a'), f('b'), f('c'), f('d')];
  const r = ordenTrasSoltar(grupo, grupo[3], { filaId: 'b', posicion: 'before' });
  assert.deepEqual(r, [{ id: 'a', rowOrder: 1000 }, { id: 'd', rowOrder: 2000 }, { id: 'b', rowOrder: 3000 }, { id: 'c', rowOrder: 4000 }]);
});
prueba('soltar después de otra fila', () => {
  const grupo = [f('a'), f('b'), f('c')];
  const r = ordenTrasSoltar(grupo, grupo[0], { filaId: 'b', posicion: 'after' });
  assert.deepEqual(ids(r), ['b', 'a', 'c']);
});
prueba('soltar sobre el encabezado: la fila va al final del grupo', () => {
  const grupo = [f('a', 1000), f('b', 2000), f('c', 3000)];
  assert.deepEqual(ids(ordenTrasSoltar(grupo, grupo[0], 'final')), ['b', 'c', 'a']);
});
prueba('al final queda DESPUÉS de los eventos que aún no tienen número (si no, quedaría a medias)', () => {
  const grupo = [f('a', 1000), f('b', 2000), f('nuevo')];
  assert.deepEqual(ids(ordenTrasSoltar(grupo, grupo[0], 'final')), ['b', 'nuevo', 'a']);
});
prueba('una fila de otro grupo se mete en el grupo de destino (que no la trae) en el lugar que se soltó', () => {
  const destino = [f('x', 1000), f('y', 2000)];
  const venida = f('z', 7000);
  const r = ordenTrasSoltar(destino, venida, { filaId: 'y', posicion: 'before' });
  assert.deepEqual(r, [{ id: 'x', rowOrder: 1000 }, { id: 'z', rowOrder: 2000 }, { id: 'y', rowOrder: 3000 }]);
  assert.deepEqual(ids(ordenTrasSoltar(destino, venida, 'final')), ['x', 'y', 'z']);
});
prueba('soltar en un grupo vacío: queda sola, con el primer número', () => {
  assert.deepEqual(ordenTrasSoltar([], f('z'), 'final'), [{ id: 'z', rowOrder: PASO_ORDEN }]);
});
prueba('si la fila destino ya no está (se borró mientras arrastraba), la fila va al final y no se pierde nadie', () => {
  const grupo = [f('a'), f('b')];
  const r = ordenTrasSoltar(grupo, f('c'), { filaId: 'fantasma', posicion: 'before' });
  assert.deepEqual(ids(r), ['a', 'b', 'c']);
});
prueba('el resultado tiene a todas las filas del grupo una sola vez, con números distintos y crecientes', () => {
  const grupo = [f('a', 5000), f('b', 100), f('c'), f('d', 100), f('e', 42)];
  const r = ordenTrasSoltar(grupo, grupo[2], { filaId: 'e', posicion: 'before' });
  assert.equal(r.length, grupo.length);
  assert.equal(new Set(ids(r)).size, grupo.length);
  assert.ok(r.every((x, i) => i === 0 || x.rowOrder > r[i - 1].rowOrder));
});

prueba('soltar una fila donde ya estaba no cambia nada (no hay nada que guardar)', () => {
  const grupo = [f('a', 1000), f('b', 2000), f('c', 3000)];
  assert.equal(quedaDondeEstaba(grupo, grupo[1], { filaId: 'a', posicion: 'after' }), true);
  assert.equal(quedaDondeEstaba(grupo, grupo[1], { filaId: 'c', posicion: 'before' }), true);
  assert.equal(quedaDondeEstaba(grupo, grupo[2], 'final'), true);
});
prueba('soltarla en otro lugar sí cambia', () => {
  const grupo = [f('a', 1000), f('b', 2000), f('c', 3000)];
  assert.equal(quedaDondeEstaba(grupo, grupo[0], 'final'), false);
  assert.equal(quedaDondeEstaba(grupo, grupo[2], { filaId: 'a', posicion: 'before' }), false);
});
prueba('una fila que viene de otro grupo nunca «queda donde estaba» en este', () => {
  assert.equal(quedaDondeEstaba([f('a'), f('b')], f('z'), 'final'), false);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
