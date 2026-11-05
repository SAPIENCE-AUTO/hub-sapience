import mammoth from 'mammoth';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';

// El aviso de privacidad que leen los participantes en el formulario («Leer el aviso de privacidad»). Sale del
// Word que da Sapience (hoy «Aviso de Privacidad AGC.docx») convertido a títulos, párrafos y listas, y vive en
// la carpeta pública del Hub (no en el código: trae datos de contacto de la empresa). Se cambia volviendo a
// correr scripts/subir-aviso-privacidad.ts con el Word nuevo.
// Cada vez que se publica, la versión que estaba vigente y la nueva se guardan con la fecha en que se publicaron
// (carpeta aviso-privacidad-versiones): el filtro solo guarda que la persona «aceptó», no qué texto, y con esas copias
// se puede probar qué aviso (y qué condiciones de confidencialidad) estaba vigente cuando aceptó.

export interface BloqueAviso { tipo: 'titulo' | 'parrafo' | 'lista'; texto: string }

const BUCKET = 'zite-uploads';
const RUTA = 'formularios-config/aviso-privacidad.json';
const CARPETA_VERSIONES = 'formularios-config/aviso-privacidad-versiones';

/** Donde vive el aviso (Storage del Hub). Las pruebas lo cambian por uno en memoria. */
export interface AlmacenAviso {
  /** El texto guardado, o null si no existe. */
  leer(ruta: string): Promise<string | null>;
  /** Con `sobrescribir: false` falla si ya existe (así una copia con fecha nunca se pisa). */
  escribir(ruta: string, texto: string, sobrescribir: boolean): Promise<void>;
}

const almacenStorage: AlmacenAviso = {
  async leer(ruta) {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(ruta);
    return error || !data ? null : await data.text();
  },
  async escribir(ruta, texto, sobrescribir) {
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(ruta, Buffer.from(texto), { contentType: 'application/json', upsert: sobrescribir });
    if (error) throw new Error(error.message);
  },
};

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

/** Guarda una copia con la fecha en que se publicó esa versión. Si ya estaba guardada, no hace nada. */
async function archivarVersion(almacen: AlmacenAviso, texto: string, publicado: string | undefined): Promise<string> {
  const ruta = `${CARPETA_VERSIONES}/${(publicado ?? 'sin-fecha').replace(/[:.]/g, '-')}.json`;
  try {
    await almacen.escribir(ruta, texto, false);
  } catch (e) {
    if (!/already exists|duplicate/i.test((e as Error).message)) throw new Error(`No se pudo archivar el aviso: ${(e as Error).message}`);
  }
  return ruta;
}

/**
 * Publica el aviso. Antes de pisarlo guarda la versión que estaba vigente (con la fecha en que se publicó) y, ya publicado, la nueva:
 * si la copia no se puede guardar, no se publica nada. Devuelve las rutas de las copias.
 */
export async function guardarAviso(bloques: BloqueAviso[], almacen: AlmacenAviso = almacenStorage): Promise<{ copias: string[] }> {
  const copias: string[] = [];
  const previo = await almacen.leer(RUTA);
  if (previo) {
    let anterior: { bloques?: BloqueAviso[]; actualizado?: string } = {};
    try { anterior = JSON.parse(previo); } catch { /* ilegible: se archiva tal cual con «sin-fecha» */ }
    if (JSON.stringify(anterior.bloques) !== JSON.stringify(bloques)) copias.push(await archivarVersion(almacen, previo, anterior.actualizado));
  }
  const publicado = new Date().toISOString();
  const texto = JSON.stringify({ bloques, actualizado: publicado });
  try {
    await almacen.escribir(RUTA, texto, true);
  } catch (e) {
    throw new Error(`No se pudo guardar el aviso: ${(e as Error).message}`);
  }
  copias.push(await archivarVersion(almacen, texto, publicado));
  recordado = null;
  return { copias };
}

let recordado: { bloques: BloqueAviso[]; hasta: number } | null = null;

/** Para las pruebas: olvida el aviso recordado. */
export const olvidarAviso = () => { recordado = null; };

/** El aviso vigente (recordado 10 minutos). Vacío si todavía no se ha subido. */
export async function leerAviso(almacen: AlmacenAviso = almacenStorage): Promise<BloqueAviso[]> {
  if (recordado && recordado.hasta > Date.now()) return recordado.bloques;
  const texto = await almacen.leer(RUTA);
  const bloques = texto ? (JSON.parse(texto).bloques as BloqueAviso[]) : [];
  recordado = { bloques, hasta: Date.now() + 10 * 60_000 };
  return bloques;
}
