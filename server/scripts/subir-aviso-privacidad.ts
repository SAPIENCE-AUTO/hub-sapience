// Sube el aviso de privacidad que leen los participantes de los filtros (Tools → Formularios), a partir del
// Word que da Sapience. Lo convierte a títulos, párrafos y listas y lo deja en la carpeta pública del Hub
// (src/serverUtils/formularios/aviso.ts). Guarda además una copia con fecha de la versión anterior y de la nueva. No se ejecuta solo.
//
// Uso: cd server && npx tsx --env-file=../.env scripts/subir-aviso-privacidad.ts ~/Downloads/"Aviso de Privacidad AGC.docx"
import fs from 'node:fs';
import { avisoDeWord, guardarAviso } from '../../src/serverUtils/formularios/aviso';

async function main() {
  const ruta = process.argv[2];
  if (!ruta) throw new Error('Falta la ruta del Word del aviso.');
  const bloques = await avisoDeWord(fs.readFileSync(ruta));
  if (bloques.length < 3) throw new Error('El Word casi no tiene texto: ¿es el archivo correcto?');
  const { copias } = await guardarAviso(bloques);
  console.log(`✅ Aviso subido: ${bloques.length} bloques (${bloques.filter((b) => b.tipo === 'titulo').length} títulos).`);
  for (const c of copias) console.log(`   copia con fecha: ${c}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
