// Pruebas de lo que el detalle de un pago muestra de su ODC (src/lib/payments/odc.ts): el texto de cantidad de cada
// concepto, cuántos conceptos se ven con la lista cerrada y la conversión del PDF de base64 a un archivo del navegador.
// Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-odc.ts
import assert from 'node:assert/strict';
import { base64ABlob, conceptosVisibles, detalleCantidad, CONCEPTOS_CON_LISTA_CERRADA, CONCEPTOS_QUE_CABEN } from '../../src/lib/payments/odc';

const sinNbsp = (s: string) => s.replace(/ /g, ' '); // Intl separa «USD» de la cifra con un espacio no separable

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// ── cantidad de cada concepto ────────────────────────────────────────────────
await prueba('concepto con varias piezas: «4 × $750»', () => {
  assert.equal(sinNbsp(detalleCantidad({ quantity: 4, unitPrice: 750, total: 3000 }, 'MXN')), '4 × $750');
  assert.equal(sinNbsp(detalleCantidad({ quantity: 4, unitPrice: 750, total: 3000 })), '4 × $750'); // sin moneda cuenta como pesos
  assert.equal(sinNbsp(detalleCantidad({ quantity: 3, unitPrice: 120, total: 360 }, 'USD')), '3 × USD 120');
});
await prueba('centavos solo si los hay, y cantidades con decimales o miles', () => {
  assert.equal(sinNbsp(detalleCantidad({ quantity: 2, unitPrice: 450.5, total: 901 }, 'MXN')), '2 × $450.50');
  assert.equal(sinNbsp(detalleCantidad({ quantity: 1.5, unitPrice: 1000, total: 1500 }, 'MXN')), '1.5 × $1,000');
  assert.equal(sinNbsp(detalleCantidad({ quantity: 1200, unitPrice: 10, total: 12000 }, 'MXN')), '1,200 × $10');
});
await prueba('una sola pieza por el mismo monto no dice nada (ni «1 × $3,000»)', () => {
  assert.equal(detalleCantidad({ quantity: 1, unitPrice: 3000, total: 3000 }, 'MXN'), '');
  assert.equal(detalleCantidad({ quantity: 1, unitPrice: -500, total: -500 }, 'MXN'), ''); // un descuento
});
await prueba('una pieza con precio distinto al total sí lo aclara', () => {
  assert.equal(sinNbsp(detalleCantidad({ quantity: 1, unitPrice: 2500, total: 3000 }, 'MXN')), '1 × $2,500');
});

// ── lista de conceptos ───────────────────────────────────────────────────────
const lista = (k: number) => Array.from({ length: k }, (_, i) => ({ id: `c${i + 1}` }));
await prueba('hasta 6 conceptos se ven completos', () => {
  for (const k of [0, 1, 4, CONCEPTOS_QUE_CABEN]) {
    const r = conceptosVisibles(lista(k), false);
    assert.equal(r.visibles.length, k);
    assert.equal(r.ocultos, 0);
  }
});
await prueba('una lista larga se cierra en 4 y dice cuántos quedan', () => {
  const r = conceptosVisibles(lista(11), false);
  assert.equal(r.visibles.length, CONCEPTOS_CON_LISTA_CERRADA);
  assert.deepEqual(r.visibles.map(c => c.id), ['c1', 'c2', 'c3', 'c4']);
  assert.equal(r.ocultos, 7);
  assert.equal(conceptosVisibles(lista(7), false).ocultos, 3);
});
await prueba('abierta, la lista larga se ve completa y en su orden', () => {
  const r = conceptosVisibles(lista(11), true);
  assert.equal(r.visibles.length, 11);
  assert.equal(r.ocultos, 0);
  assert.equal(r.visibles[10].id, 'c11');
});
await prueba('no modifica la lista original', () => {
  const l = lista(8);
  const copia = l.map(c => c.id);
  conceptosVisibles(l, false).visibles.pop();
  conceptosVisibles(l, true).visibles.reverse();
  assert.deepEqual(l.map(c => c.id), copia);
});

// ── PDF de la ODC ────────────────────────────────────────────────────────────
const textoPdf = '%PDF-1.4\n% archivo de prueba\n%%EOF\n';
const b64 = Buffer.from(textoPdf, 'latin1').toString('base64');
await prueba('el PDF en base64 vuelve a ser el mismo archivo, con su tipo', async () => {
  const blob = base64ABlob(b64);
  assert.equal(blob.type, 'application/pdf');
  assert.equal(blob.size, textoPdf.length);
  assert.equal(await blob.text(), textoPdf);
});
await prueba('acepta el encabezado «data:» y saltos de línea dentro del base64', async () => {
  const partido = b64.replace(/(.{12})/g, '$1\n');
  assert.equal(await base64ABlob(`data:application/pdf;base64,${partido}`).text(), textoPdf);
});
await prueba('bytes que no son texto sobreviven completos (un PDF real trae binarios)', async () => {
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80, 0x0a, 0x7f]);
  const blob = base64ABlob(Buffer.from(bytes).toString('base64'));
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});
await prueba('un base64 inválido truena en vez de abrir un archivo roto', () => {
  assert.throws(() => base64ABlob('esto no es base64 %%%'));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
