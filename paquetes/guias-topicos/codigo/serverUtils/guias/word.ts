import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
// El constructor vive en la skill (sirve igual desde Claude Code: scripts/construir_word.mjs).
import { construirWord, nombreWord } from './skill/scripts/word.mjs';
import type { EstadoGuia } from './types';

const PLANTILLA = path.join(import.meta.dirname, 'skill', 'assets', 'plantilla-guia.docx');
let plantilla: Buffer | null = null;

/** El Word de la guía (sobre la plantilla de Sapience), listo para mandarse como base64. */
export async function wordDeGuia(st: EstadoGuia): Promise<{ nombre: string; base64: string }> {
  plantilla ??= fs.readFileSync(PLANTILLA);
  const bytes = await construirWord({
    guia: { proyecto: st.proyecto, tipo: st.tipo, duracion: st.duracion, tema: st.tema, muestra: st.roadmap?.muestra ?? [], bloques: st.roadmap?.bloques ?? [], guia: st.guia },
    plantilla,
    JSZip,
  });
  return { nombre: nombreWord(st.proyecto), base64: Buffer.from(bytes).toString('base64') };
}
