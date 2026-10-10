// Pruebas de lo que el detalle de un pago necesita para mostrar su comprobante (src/lib/payments/comprobante.ts):
// reconocer el tipo de archivo por sus primeros bytes, y los nombres en pantalla y de descarga. Todos los datos son
// inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pagos-comprobante.ts
import assert from 'node:assert/strict';
import { etiquetaComprobante, nombreDeDescarga, reconoceArchivo } from '../../src/lib/payments/comprobante';

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

const bytes = (...v: number[]) => Uint8Array.from(v);
const texto = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

// ── reconocer el archivo ─────────────────────────────────────────────────────
prueba('PDF: empieza con %PDF', () => {
  assert.deepEqual(reconoceArchivo(texto('%PDF-1.4\n% prueba\n')), { tipo: 'pdf', mime: 'application/pdf' });
  assert.deepEqual(reconoceArchivo(texto('%PDF-1.7')), { tipo: 'pdf', mime: 'application/pdf' });
});
prueba('PDF con algo de basura antes del %PDF (la norma lo permite) sigue siendo PDF', () => {
  assert.equal(reconoceArchivo(texto('\n\n  %PDF-1.5\n')).tipo, 'pdf');
  assert.equal(reconoceArchivo(texto('x'.repeat(600) + '%PDF-1.5')).tipo, 'pdf');
});
prueba('un «%PDF» que aparece muy adentro de otro archivo no lo vuelve PDF', () => {
  assert.equal(reconoceArchivo(texto('x'.repeat(1500) + '%PDF-1.5')).tipo, 'otro');
});
prueba('imágenes: PNG, JPEG, GIF y WEBP', () => {
  assert.deepEqual(reconoceArchivo(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), { tipo: 'imagen', mime: 'image/png' });
  assert.deepEqual(reconoceArchivo(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10)), { tipo: 'imagen', mime: 'image/jpeg' });
  assert.deepEqual(reconoceArchivo(texto('GIF89a....')), { tipo: 'imagen', mime: 'image/gif' });
  assert.deepEqual(reconoceArchivo(texto('RIFF....WEBPVP8 ')), { tipo: 'imagen', mime: 'image/webp' });
});
prueba('RIFF que no es WEBP (p. ej. audio WAV) no es imagen', () => {
  assert.equal(reconoceArchivo(texto('RIFF....WAVEfmt ')).tipo, 'otro');
});
prueba('lo que el navegador no puede mostrar es «otro»: HEIC de iPhone, Word, texto, vacío', () => {
  assert.deepEqual(reconoceArchivo(texto('....ftypheic....')), { tipo: 'otro', mime: null });
  assert.deepEqual(reconoceArchivo(bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00)), { tipo: 'otro', mime: null }); // docx/xlsx son zip
  assert.deepEqual(reconoceArchivo(texto('hola, esto es texto')), { tipo: 'otro', mime: null });
  assert.deepEqual(reconoceArchivo(new Uint8Array(0)), { tipo: 'otro', mime: null });
  assert.deepEqual(reconoceArchivo(bytes(0x89, 0x50)), { tipo: 'otro', mime: null }); // PNG cortado a la mitad
});

// ── nombres ──────────────────────────────────────────────────────────────────
prueba('etiqueta: «Comprobante» si es uno, «Comprobante 1/2» si hay varios', () => {
  assert.equal(etiquetaComprobante(0, 1), 'Comprobante');
  assert.equal(etiquetaComprobante(0, 2), 'Comprobante 1');
  assert.equal(etiquetaComprobante(1, 2), 'Comprobante 2');
});
prueba('nombre de descarga: el original si existe, sin carpetas', () => {
  assert.equal(nombreDeDescarga({ url: 'u', filename: 'recibo_ejemplo.pdf' }, 'RI-01234', 0, 'application/pdf'), 'recibo_ejemplo.pdf');
  assert.equal(nombreDeDescarga({ url: 'u', filename: 'carpeta/otra\\recibo.png' }, 'RI-01234', 0, 'image/png'), 'recibo.png');
});
prueba('nombre de descarga sin original: armado con la ODC y la extensión real', () => {
  assert.equal(nombreDeDescarga({ url: 'u' }, 'RI-01234', 0, 'application/pdf'), 'comprobante-RI-01234.pdf');
  assert.equal(nombreDeDescarga({ url: 'u', filename: '  ' }, 'RI-01234', 1, 'image/jpeg'), 'comprobante-RI-01234-2.jpg');
  assert.equal(nombreDeDescarga({ url: 'u' }, undefined, 0, 'image/png'), 'comprobante-pago.png');
  assert.equal(nombreDeDescarga({ url: 'u' }, 'RI-01234', 0, null), 'comprobante-RI-01234.bin');
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
