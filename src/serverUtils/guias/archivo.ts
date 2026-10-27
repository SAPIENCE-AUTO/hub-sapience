import mammoth from 'mammoth';
import { ZiteError } from '../../../server/compat';

// Lee el archivo que se sube como roadmap o brief de una guía: Word (.docx), texto (.txt) o Markdown (.md). Lo que sale es texto plano para
// pegarlo en la pantalla y revisarlo; Claude lo recibe después como `fuente`.
export const MAX_BYTES_ARCHIVO = 10 * 1024 * 1024;
const MAX_CARACTERES = 200_000;

const entidades = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** El texto de una celda: sus párrafos y viñetas van separados por «; » (un objetivo tras otro en una sola línea). */
const textoDeCelda = (html: string) => entidades(html.replace(/<\/(p|li)>/g, '; ').replace(/<br\s*\/?>/g, '; ').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').replace(/(;\s*)+/g, '; ').replace(/;\s*$/, '').trim();

/** Una tabla del Word → un renglón por fila, con « | » entre celdas. */
function textoDeTabla(tabla: string): string {
  return [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((fila) => [...fila[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => textoDeCelda(c[1])).join(' | ').replace(/\s*\|\s*$/, '').trim())
    .filter(Boolean)
    .join('\n');
}

/** HTML de mammoth → texto: párrafos en renglones, viñetas con «- » y las tablas un renglón por fila (así llega un roadmap que estaba en tabla). */
export function htmlATexto(html: string): string {
  const tablas: string[] = [];
  const sinTablas = html.replace(/<table[\s\S]*?<\/table>/g, (t) => { tablas.push(textoDeTabla(t)); return `<p>\u0001${tablas.length - 1}\u0001</p>`; });
  const texto = entidades(sinTablas.replace(/<li>/g, '- ').replace(/<\/(p|h\d|li)>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, ''));
  return texto.replace(/\u0001(\d+)\u0001/g, (_, i) => tablas[Number(i)]).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

export async function textoDeWord(buf: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return htmlATexto(value);
}

export async function textoDeArchivo(nombre: string, buf: Buffer): Promise<string> {
  if (buf.length > MAX_BYTES_ARCHIVO) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El archivo pesa más de 10 MB.' });
  const ext = nombre.split('.').pop()?.toLowerCase() ?? '';
  let texto: string;
  if (ext === 'docx') {
    try {
      texto = await textoDeWord(buf);
    } catch {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'No se pudo leer el Word. Revisa que sea un .docx válido.' });
    }
  } else if (ext === 'txt' || ext === 'md') {
    texto = buf.toString('utf8');
  } else if (ext === 'doc') {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Los .doc viejos no se pueden leer: guárdalo como .docx.' });
  } else {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Solo se leen archivos Word (.docx), .txt o .md.' });
  }
  texto = texto.replace(/\r\n?/g, '\n').trim();
  if (!texto) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El archivo no tiene texto.' });
  return texto.slice(0, MAX_CARACTERES);
}
