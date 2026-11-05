// Pruebas de las copias con fecha del aviso de privacidad (src/serverUtils/formularios/aviso.ts), con un almacén en memoria (no toca Storage).
// Lo que cuidan: que cada publicación deje guardada la versión anterior y la nueva con la fecha en que se publicaron, que una copia nunca se pise,
// que si la copia falla no se publique nada y que leerAviso devuelva siempre lo último publicado. Todo con textos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-aviso.ts
import assert from 'node:assert/strict';
import { guardarAviso, leerAviso, olvidarAviso, type AlmacenAviso, type BloqueAviso } from '../../src/serverUtils/formularios/aviso';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try { await fn(); console.log(`ok   ${nombre}`); } catch (e) { fallas++; console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`); }
}

function almacenEnMemoria(opciones: { fallaCopias?: boolean } = {}) {
  const archivos = new Map<string, string>();
  const almacen: AlmacenAviso = {
    leer: async (ruta) => archivos.get(ruta) ?? null,
    escribir: async (ruta, texto, sobrescribir) => {
      if (opciones.fallaCopias && ruta.includes('versiones')) throw new Error('Storage caído');
      if (!sobrescribir && archivos.has(ruta)) throw new Error('The resource already exists');
      archivos.set(ruta, texto);
    },
  };
  return { archivos, almacen };
}
const versiones = (a: Map<string, string>) => [...a.keys()].filter((k) => k.includes('aviso-privacidad-versiones/')).sort();
const v1: BloqueAviso[] = [{ tipo: 'titulo', texto: 'AVISO DE PRIVACIDAD' }, { tipo: 'parrafo', texto: 'Texto de ejemplo uno.' }];
const v2: BloqueAviso[] = [...v1, { tipo: 'titulo', texto: 'CONFIDENCIALIDAD DE LA PARTICIPACIÓN.' }, { tipo: 'parrafo', texto: 'Texto de ejemplo dos.' }];
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

await prueba('la primera publicación queda vigente y guarda su copia con la fecha en que se publicó', async () => {
  const { archivos, almacen } = almacenEnMemoria();
  const { copias } = await guardarAviso(v1, almacen);
  assert.equal(copias.length, 1);
  const vigente = JSON.parse(archivos.get('formularios-config/aviso-privacidad.json')!);
  assert.deepEqual(vigente.bloques, v1);
  assert.equal(versiones(archivos).length, 1);
  assert.ok(versiones(archivos)[0].includes(vigente.actualizado.replace(/[:.]/g, '-')), 'la copia lleva la fecha de publicación en el nombre');
  assert.equal(archivos.get(versiones(archivos)[0]), archivos.get('formularios-config/aviso-privacidad.json'), 'la copia es idéntica a lo publicado');
});

await prueba('al publicar una versión nueva se conservan la anterior y la nueva, cada una con su fecha', async () => {
  const { archivos, almacen } = almacenEnMemoria();
  await guardarAviso(v1, almacen);
  await espera(5);
  await guardarAviso(v2, almacen);
  const copias = versiones(archivos);
  assert.equal(copias.length, 2);
  const textos = copias.map((c) => JSON.parse(archivos.get(c)!).bloques.length).sort();
  assert.deepEqual(textos, [v1.length, v2.length]);
  assert.deepEqual(JSON.parse(archivos.get('formularios-config/aviso-privacidad.json')!).bloques, v2);
});

await prueba('una versión vigente de antes de que existieran las copias también se archiva antes de pisarla', async () => {
  const { archivos, almacen } = almacenEnMemoria();
  archivos.set('formularios-config/aviso-privacidad.json', JSON.stringify({ bloques: v1, actualizado: '2026-10-23T18:03:00.000Z' }));
  await guardarAviso(v2, almacen);
  assert.ok(archivos.has('formularios-config/aviso-privacidad-versiones/2026-10-23T18-03-00-000Z.json'), 'falta la copia de la versión anterior');
  assert.equal(versiones(archivos).length, 2);
  assert.deepEqual(JSON.parse(archivos.get('formularios-config/aviso-privacidad-versiones/2026-10-23T18-03-00-000Z.json')!).bloques, v1);
});

await prueba('volver a publicar el mismo texto no llena la carpeta de copias repetidas de lo anterior', async () => {
  const { archivos, almacen } = almacenEnMemoria();
  archivos.set('formularios-config/aviso-privacidad.json', JSON.stringify({ bloques: v1, actualizado: '2026-10-23T18:03:00.000Z' }));
  const { copias } = await guardarAviso(v1, almacen);
  assert.equal(copias.length, 1, 'solo la copia de la publicación nueva, no otra de la anterior (idéntica)');
});

await prueba('si la copia no se puede guardar, no se publica nada y lo vigente queda como estaba', async () => {
  const { archivos, almacen } = almacenEnMemoria({ fallaCopias: true });
  archivos.set('formularios-config/aviso-privacidad.json', JSON.stringify({ bloques: v1, actualizado: '2026-10-23T18:03:00.000Z' }));
  await assert.rejects(() => guardarAviso(v2, almacen), /No se pudo archivar el aviso/);
  assert.deepEqual(JSON.parse(archivos.get('formularios-config/aviso-privacidad.json')!).bloques, v1);
});

await prueba('leerAviso devuelve vacío si todavía no hay aviso, lo recuerda un rato y se actualiza al publicar', async () => {
  const { archivos, almacen } = almacenEnMemoria();
  olvidarAviso();
  assert.deepEqual(await leerAviso(almacen), []);
  olvidarAviso();
  await guardarAviso(v2, almacen);
  assert.deepEqual(await leerAviso(almacen), v2);
  archivos.set('formularios-config/aviso-privacidad.json', JSON.stringify({ bloques: v1, actualizado: '2026-10-23T18:03:00.000Z' }));
  assert.deepEqual(await leerAviso(almacen), v2, 'lo recordado no cambia solo');
  await guardarAviso(v1, almacen);
  assert.deepEqual(await leerAviso(almacen), v1, 'al publicar se olvida lo recordado');
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
process.exit(fallas ? 1 : 0);
