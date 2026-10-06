#!/usr/bin/env node
// Construye el Word de una guía: node scripts/construir_word.mjs guia.json salida.docx
// guia.json tiene la forma de assets/ejemplo_guia.json.
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { construirWord, nombreWord } from './word.mjs';

const [entrada, salida] = process.argv.slice(2);
if (!entrada) {
  console.error('Uso: node scripts/construir_word.mjs guia.json [salida.docx]');
  process.exit(1);
}
const guia = JSON.parse(await readFile(entrada, 'utf8'));
const plantilla = await readFile(new URL('../assets/plantilla-guia.docx', import.meta.url));
const destino = salida || nombreWord(guia.proyecto);
await writeFile(destino, await construirWord({ guia, plantilla, JSZip }));
const faltan = (guia.bloques ?? guia.roadmap?.bloques ?? []).filter((_, i) => !(guia.guia ?? [])[i]).length;
console.log(`Listo: ${destino}${faltan ? ` (${faltan} bloque(s) sin escribir salen como «Bloque por escribir»)` : ''}`);
