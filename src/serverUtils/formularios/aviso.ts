import mammoth from 'mammoth';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';

// El aviso de privacidad que leen los participantes en el formulario («Leer el aviso de privacidad»). Sale del
// Word que da Sapience (hoy «Aviso de Privacidad AGC.docx») convertido a títulos, párrafos y listas, y vive en
// la carpeta pública del Hub (no en el código: trae datos de contacto de la empresa). Se cambia volviendo a
// correr scripts/subir-aviso-privacidad.ts con el Word nuevo.

export interface BloqueAviso { tipo: 'titulo' | 'parrafo' | 'lista'; texto: string }

const BUCKET = 'zite-uploads';
const RUTA = 'formularios-config/aviso-privacidad.json';

const sinEtiquetas = (html: string) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** El Word en bloques: los títulos del Word y los párrafos en mayúsculas cortos son títulos; los puntos de lista, lista. */
export async function avisoDeWord(buf: Buffer): Promise<BloqueAviso[]> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const bloques: BloqueAviso[] = [];
  for (const m of html.matchAll(/<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/g)) {
    const texto = sinEtiquetas(m[2]);
    if (!texto) continue;
    const titulo = m[1].startsWith('h') || (texto.length < 80 && texto === texto.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(texto));
    bloques.push({ tipo: m[1] === 'li' ? 'lista' : titulo ? 'titulo' : 'parrafo', texto });
  }
  return bloques;
}

export async function guardarAviso(bloques: BloqueAviso[]): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(BUCKET)
    .upload(RUTA, Buffer.from(JSON.stringify({ bloques, actualizado: new Date().toISOString() })), { contentType: 'application/json', upsert: true });
  if (error) throw new Error(`No se pudo guardar el aviso: ${error.message}`);
}

let recordado: { bloques: BloqueAviso[]; hasta: number } | null = null;

/** El aviso vigente (recordado 10 minutos). Vacío si todavía no se ha subido. */
export async function leerAviso(): Promise<BloqueAviso[]> {
  if (recordado && recordado.hasta > Date.now()) return recordado.bloques;
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(RUTA);
  const bloques = error || !data ? [] : (JSON.parse(await data.text()).bloques as BloqueAviso[]);
  recordado = { bloques, hasta: Date.now() + 10 * 60_000 };
  return bloques;
}
