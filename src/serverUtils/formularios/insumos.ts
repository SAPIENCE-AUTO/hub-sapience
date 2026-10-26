import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pool, ZiteError } from '../../../server/compat';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';
import type { ArchivoInsumo, Insumos, ReunionInsumo } from '../../lib/formularios/generador';
import { BUCKET } from './storage';
import type { Contenido } from './claude';

// Insumos del generador de Filtros: lo que se sube (propuesta en PDF o PowerPoint, Word con un
// screener) y las reuniones de Notetaker. El PDF se guarda en la carpeta privada y la IA lo lee
// completo, con sus tablas e imágenes; del Word y del PowerPoint se guarda el texto. La muestra
// del proyecto (serverUtils/muestra/insumos.ts) además acepta imágenes (van a la carpeta privada
// y la IA las ve) y Excel (se guarda el texto, una fila por renglón).

// jszip viene con pptxgenjs (igual que en propuestas/construir.ts).
const requireCjs = createRequire(import.meta.url);
const JSZip = requireCjs(requireCjs.resolve('jszip', { paths: [path.dirname(requireCjs.resolve('pptxgenjs'))] }));

export const MAX_BYTES = 25 * 1024 * 1024;
/** Lo que se le manda a la IA en texto (notas, Word, PowerPoint y transcripciones juntos). Más que esto, se pide quitar algo. */
const MAX_CARACTERES = 600_000;

const entidades = (t: string) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Word → texto: párrafos en renglones y las tablas un renglón por fila, con « | » entre celdas. */
export async function textoDeWord(buf: Buffer): Promise<string> {
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const texto = value
    .replace(/<\/t[dh]>/g, ' | ')
    .replace(/<\/(p|h\d|li|tr)>/g, '\n')
    .replace(/<li>/g, '- ')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return entidades(texto).split('\n').map((l) => l.replace(/\s*\|\s*$/, '').trim()).filter(Boolean).join('\n');
}

/** Excel → texto: hoja por hoja, una fila por renglón con « | » entre celdas (a lo más 3 mil filas por hoja). */
export async function textoDeExcel(buf: Buffer): Promise<string> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buf as unknown as ArrayBuffer);
  const partes: string[] = [];
  libro.eachSheet((hoja) => {
    const filas: string[] = [];
    hoja.eachRow({ includeEmpty: false }, (fila) => {
      if (filas.length >= 3000) return;
      const celdas = (fila.values as unknown[]).slice(1).map((_, i) => fila.getCell(i + 1).text.trim());
      while (celdas.length && !celdas[celdas.length - 1]) celdas.pop();
      if (celdas.some(Boolean)) filas.push(celdas.join(' | '));
    });
    if (filas.length) partes.push(`Hoja «${hoja.name}»:\n${filas.join('\n')}`);
  });
  return partes.join('\n\n');
}

/** PowerPoint → texto, lámina por lámina, en su orden. */
export async function textoDePowerPoint(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const laminas = Object.keys(zip.files)
    .map((nombre) => ({ nombre, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(nombre)?.[1]) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);
  const partes: string[] = [];
  for (const { nombre, n } of laminas) {
    const xml: string = await zip.file(nombre).async('string');
    const parrafos = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((m) => entidades([...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('')).trim())
      .filter(Boolean);
    if (parrafos.length) partes.push(`Lámina ${n}:\n${parrafos.join('\n')}`);
  }
  return partes.join('\n\n');
}

/** Las imágenes que lee la IA (el navegador las convierte a JPEG antes de subirlas). */
const IMAGENES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type TipoImagen = (typeof IMAGENES)[number];

export function tipoDeArchivo(nombre: string, mime: string): ArchivoInsumo['tipo'] | undefined {
  if (mime === 'application/pdf' || /\.pdf$/i.test(nombre)) return 'pdf';
  if (/\.docx$/i.test(nombre) || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (/\.pptx$/i.test(nombre) || mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return 'pptx';
  if (/\.xlsx$/i.test(nombre) || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if ((IMAGENES as readonly string[]).includes(mime)) return 'imagen';
  return undefined;
}

const nombreSeguro = (nombre: string) => nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);

/**
 * Lee un archivo subido: el PDF y la imagen van a la carpeta privada; del Word, el PowerPoint y
 * el Excel se queda el texto. `carpeta`: el id del filtro (o «muestra-<proyecto>»).
 */
export async function leerArchivoInsumo(carpeta: string, id: string, nombre: string, mime: string, buf: Buffer): Promise<ArchivoInsumo> {
  if (buf.length > MAX_BYTES) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El archivo pesa más de 25 MB.' });
  const tipo = tipoDeArchivo(nombre, mime);
  if (!tipo) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Sube un PDF, un PowerPoint (.pptx), un Word (.docx), un Excel (.xlsx) o una imagen.' });
  if (tipo === 'pdf' || tipo === 'imagen') {
    if (tipo === 'imagen' && buf.length > 5 * 1024 * 1024) throw new ZiteError({ code: 'BAD_REQUEST', message: `«${nombre}» pesa más de 5 MB.` });
    const ruta = `insumos/${carpeta}/${id}-${nombreSeguro(nombre)}`;
    const contentType = tipo === 'pdf' ? 'application/pdf' : mime;
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(ruta, buf, { contentType, upsert: false });
    if (error) throw new ZiteError({ code: 'INTERNAL_ERROR', message: `No se pudo guardar «${nombre}»: ${error.message}` });
    return { id, nombre, tipo, ruta, ...(tipo === 'imagen' ? { mime } : {}) };
  }
  let texto = '';
  try {
    texto = tipo === 'docx' ? await textoDeWord(buf) : tipo === 'xlsx' ? await textoDeExcel(buf) : await textoDePowerPoint(buf);
  } catch {
    throw new ZiteError({ code: 'BAD_REQUEST', message: `No se pudo leer «${nombre}». ¿Está dañado o protegido?` });
  }
  if (!texto.trim()) throw new ZiteError({ code: 'BAD_REQUEST', message: `«${nombre}» no tiene texto que leer (¿son puras imágenes? Súbelo como PDF).` });
  return { id, nombre, tipo, texto, caracteres: texto.length };
}

export async function borrarArchivoInsumo(a: ArchivoInsumo): Promise<void> {
  if (!a.ruta) return;
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove([a.ruta]);
  if (error) console.error('[filtros] no se pudo borrar un insumo de Storage', error.message);
}

/** Al duplicar un filtro: sus PDF se copian a la carpeta del filtro nuevo (si uno no se puede copiar, se deja fuera). */
export async function copiarArchivosInsumo(archivos: ArchivoInsumo[], de: string, a: string): Promise<ArchivoInsumo[]> {
  const admin = getSupabaseAdmin().storage.from(BUCKET);
  const copias = await Promise.all(archivos.map(async (x) => {
    if (!x.ruta) return x;
    const ruta = x.ruta.replace(`insumos/${de}/`, `insumos/${a}/`);
    const { error } = await admin.copy(x.ruta, ruta);
    if (error) { console.error('[filtros] no se pudo copiar un insumo al duplicar', x.ruta, error.message); return null; }
    return { ...x, ruta };
  }));
  return copias.filter((x): x is ArchivoInsumo => !!x);
}

export async function borrarInsumosDeFormulario(formularioId: string): Promise<void> {
  const admin = getSupabaseAdmin().storage.from(BUCKET);
  const { data } = await admin.list(`insumos/${formularioId}`);
  if (data?.length) await admin.remove(data.map((f) => `insumos/${formularioId}/${f.name}`));
}

// ── Notetaker ────────────────────────────────────────────────────────────────
/** Reuniones con transcripción del proyecto o de su deal, las más recientes primero. */
export async function reunionesDelProyecto(proyectoId: string): Promise<(ReunionInsumo & { tipo?: string })[]> {
  const { rows } = await pool.query(
    `select m.id, m.subject, m.meeting_type, coalesce(m.meeting_start, m.created_at) as fecha
     from meeting_recordings m
     left join projects p on p.id = $1
     where (m.project_id = $1 or m.deal_id = p.deal_vinculado_id or m.deal_id = p.deal_asignado_id)
       and (coalesce(m.transcript, '') <> '' or m.transcript_data is not null)
     order by fecha desc
     limit 50`,
    [proyectoId],
  );
  return rows.map((r) => ({ id: r.id, titulo: r.subject || 'Reunión sin título', fecha: new Date(r.fecha).toISOString(), tipo: r.meeting_type ?? undefined }));
}

async function transcripciones(ids: string[]): Promise<{ titulo: string; fecha: string; texto: string }[]> {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `select id, subject, coalesce(meeting_start, created_at) as fecha, transcript, transcript_data from meeting_recordings where id = any($1::uuid[])`,
    [ids],
  );
  return rows.map((r) => {
    const frases = (r.transcript_data?.utterances ?? []) as { speaker: string; text: string }[];
    const texto = frases.length ? frases.map((f) => `${f.speaker}: ${f.text}`).join('\n') : String(r.transcript ?? '');
    return { titulo: r.subject || 'Reunión', fecha: new Date(r.fecha).toISOString().slice(0, 10), texto };
  });
}

async function archivoEnBase64(a: ArchivoInsumo): Promise<string> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(a.ruta!);
  if (error || !data) throw new ZiteError({ code: 'INTERNAL_ERROR', message: `No se pudo leer «${a.nombre}» de los insumos. Quítalo y vuelve a subirlo.` });
  return Buffer.from(await data.arrayBuffer()).toString('base64');
}

const NOMBRE_TIPO = { docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel' } as Record<string, string>;

/**
 * Los insumos como contenido para la IA: los PDF como documento y todo lo
 * demás en un solo texto. El último bloque lleva caché: las llamadas de una
 * misma generación (estructura y secciones) lo comparten.
 */
export async function contenidoDeInsumos(insumos: Insumos): Promise<Contenido> {
  const bloques: Contenido = [];
  for (const a of insumos.archivos.filter((x) => x.tipo === 'pdf' && x.ruta)) {
    bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await archivoEnBase64(a) }, title: a.nombre });
  }
  for (const a of insumos.archivos.filter((x) => x.tipo === 'imagen' && x.ruta)) {
    const media = (IMAGENES as readonly string[]).includes(a.mime ?? '') ? (a.mime as TipoImagen) : 'image/jpeg';
    bloques.push({ type: 'text', text: `Imagen «${a.nombre}»:` });
    bloques.push({ type: 'image', source: { type: 'base64', media_type: media, data: await archivoEnBase64(a) } });
  }
  const partes: string[] = [];
  if (insumos.notas?.trim()) partes.push(`NOTAS DEL EQUIPO:\n${insumos.notas.trim()}`);
  for (const a of insumos.archivos.filter((x) => x.texto)) partes.push(`ARCHIVO «${a.nombre}» (${NOMBRE_TIPO[a.tipo] ?? a.tipo}):\n${a.texto}`);
  for (const t of await transcripciones(insumos.reuniones.map((r) => r.id))) partes.push(`TRANSCRIPCIÓN DE LA REUNIÓN «${t.titulo}» (${t.fecha}):\n${t.texto}`);
  const pdfs = insumos.archivos.filter((x) => x.tipo === 'pdf').map((x) => `«${x.nombre}»`);
  if (pdfs.length) partes.unshift(`Van adjuntos como documento: ${pdfs.join(', ')}.`);
  const imagenes = insumos.archivos.filter((x) => x.tipo === 'imagen').map((x) => `«${x.nombre}»`);
  if (imagenes.length) partes.unshift(`Van adjuntas como imagen: ${imagenes.join(', ')}.`);
  const texto = partes.join('\n\n———\n\n') || '(Sin insumos: solo lo que se pide abajo.)';
  if (texto.length > MAX_CARACTERES) {
    throw new ZiteError({ code: 'BAD_REQUEST', message: 'Los insumos son demasiado largos para leerlos juntos. Quita alguna reunión o archivo y vuelve a intentar.' });
  }
  bloques.push({ type: 'text', text: `INSUMOS DEL ESTUDIO\n\n${texto}`, cache_control: { type: 'ephemeral' } });
  return bloques;
}

/** ¿Hay algo que leer? */
export const hayInsumos = (i: Insumos) => !!(i.notas?.trim() || i.archivos.length || i.reuniones.length || i.filtroBase);
