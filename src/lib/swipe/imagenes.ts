// Imágenes de Swipe en el navegador: reconocer lo que se arrastra o se pega, achicar la copia que va a la IA, recortar
// la ilustración y subirla. Lo puro (cajas, tamaños, textos) vive en ./concepto y se prueba aparte.
import { ApiError, analizarConceptoSwipe } from 'zite-endpoints-sdk';
import { uploadFile } from 'zite-file-upload-sdk';
import {
  IMAGEN_COMPLETA, LADO_MAX_ILUSTRACION, LADO_MAX_PARA_IA, dimensionesEscaladas, esImagenCompleta, rectDeRecorte, tituloDeArchivo,
  type CajaIlustracion, type ConceptoListo, type EstadoIA, type LecturaConcepto,
} from './concepto';

/** Cada idea tiene que quedar lista en menos de 15 s: a la IA se le dan 10 y el resto es abrir, recortar y subir. */
export const TOPE_IA_MS = 10_000;
const CARPETA_SUBIDAS = 'swipe';
/** Una imagen que ya es chica y de un formato que todos abren se sube tal cual, sin volver a comprimirla. */
const PESO_MAX_SIN_REDUCIR = 1.5 * 1024 * 1024;
const TIPOS_SIN_REDUCIR = ['image/png', 'image/jpeg', 'image/webp'];

const EXTENSIONES = /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif)$/i;
export const esArchivoDeImagen = (f: File) => f.type.startsWith('image/') || (!f.type && EXTENSIONES.test(f.name));

/** Las imágenes de un arrastre o de un pegado. En un pegado la captura a veces viene como «item» y no en `files`. */
export function imagenesDe(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const archivos = Array.from(data.files ?? []).filter(esArchivoDeImagen);
  if (archivos.length > 0) return archivos;
  return Array.from(data.items ?? [])
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

/** Lo que se está arrastrando trae archivos (sirve para resaltar la zona antes de soltar, cuando aún no se pueden leer). */
export const traeArchivos = (data: DataTransfer | null | undefined) => !!data && Array.from(data.types ?? []).includes('Files');

/** El cursor está en un campo donde se escribe (un pegado de texto ahí es lo normal y no se toca). */
export function esCampoDeTexto(destino: EventTarget | null): boolean {
  return destino instanceof HTMLElement && (destino.tagName === 'INPUT' || destino.tagName === 'TEXTAREA' || destino.isContentEditable);
}
export const traeTexto = (data: DataTransfer | null | undefined) => !!data && Array.from(data.types ?? []).includes('text/plain') && data.getData('text/plain').trim() !== '';

export async function abrirImagen(archivo: File): Promise<ImageBitmap> {
  try {
    // 'from-image' respeta la orientación de las fotos de celular.
    return await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`No se pudo abrir «${archivo.name}» como imagen (¿es HEIC o está dañada?)`);
  }
}

type Rect = { sx: number; sy: number; sw: number; sh: number };

function dibujar(bitmap: ImageBitmap, rect: Rect, ladoMax: number): HTMLCanvasElement {
  const { ancho, alto } = dimensionesEscaladas(rect.sw, rect.sh, ladoMax);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar la imagen');
  ctx.fillStyle = '#ffffff'; // un PNG con transparencia saldría negro al pasarlo a JPEG
  ctx.fillRect(0, 0, ancho, alto);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, ancho, alto);
  return canvas;
}

const aBlob = (canvas: HTMLCanvasElement, tipo: string, calidad: number) =>
  new Promise<Blob>((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo preparar la imagen'))), tipo, calidad));

const aBase64 = (blob: Blob) =>
  new Promise<string>((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => mal(lector.error ?? new Error('No se pudo leer la imagen'));
    lector.readAsDataURL(blob);
  });

const nombreBase = (nombre: string) => nombre.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'imagen';

/** La copia que se manda a la IA: la imagen entera con el lado largo a lo más 1568 px, en JPEG. */
async function copiaParaIA(bitmap: ImageBitmap) {
  const canvas = dibujar(bitmap, { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height }, LADO_MAX_PARA_IA);
  return { imagen: await aBase64(await aBlob(canvas, 'image/jpeg', 0.85)), tipo: 'image/jpeg' as const, ancho: canvas.width, alto: canvas.height };
}

/** La ilustración lista para subir: la caja recortada del original o, si es toda la imagen, la imagen misma (reducida solo si es enorme). */
async function ilustracionParaSubir(bitmap: ImageBitmap, archivo: File, caja: CajaIlustracion | null): Promise<File> {
  const completa = !caja || esImagenCompleta(caja);
  if (completa && Math.max(bitmap.width, bitmap.height) <= LADO_MAX_ILUSTRACION && archivo.size <= PESO_MAX_SIN_REDUCIR && TIPOS_SIN_REDUCIR.includes(archivo.type)) {
    return archivo;
  }
  const rect = completa || !caja ? { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height } : rectDeRecorte(caja, bitmap.width, bitmap.height);
  const blob = await aBlob(dibujar(bitmap, rect, LADO_MAX_ILUSTRACION), 'image/jpeg', 0.92);
  return new File([blob], `${nombreBase(archivo.name)}.jpg`, { type: 'image/jpeg' });
}

async function subir(archivo: File): Promise<string> {
  const { fileUrl } = await uploadFile({ data: archivo, filename: archivo.name, folder: CARPETA_SUBIDAS });
  return fileUrl;
}

/** Sube una imagen como la ilustración de una idea (la vía manual, sin IA): una foto enorme se reduce, lo demás va tal cual. */
export async function subirIlustracion(archivo: File): Promise<string> {
  const bitmap = await abrirImagen(archivo);
  try {
    return await subir(await ilustracionParaSubir(bitmap, archivo, null));
  } finally {
    bitmap.close();
  }
}

function conTope<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((ok, mal) => {
    const reloj = setTimeout(() => {
      const error = new Error(`La IA tardó más de ${Math.round(ms / 1000)} s.`);
      error.name = 'TopeVencido';
      mal(error);
    }, ms);
    promesa.then((v) => { clearTimeout(reloj); ok(v); }, (e) => { clearTimeout(reloj); mal(e); });
  });
}

/**
 * Un concepto en imagen → lo necesario para crear la idea: la IA lee título y descripción y dice dónde está la
 * ilustración, se recorta del original y se sube. Si la IA está apagada, falla o pasa del tope, la idea sale igual con
 * la imagen entera como ilustración y el nombre del archivo como título, para que la persona escriba el texto.
 * Solo lanza si el archivo no se puede abrir como imagen o si falla la subida.
 */
export async function prepararConcepto(
  archivo: File, usarIA: boolean, alCambiarFase?: (fase: 'leyendo' | 'subiendo') => void, tope = TOPE_IA_MS,
): Promise<ConceptoListo> {
  const bitmap = await abrirImagen(archivo);
  try {
    let lectura: Omit<LecturaConcepto, 'ilustracion'> & { ilustracion?: CajaIlustracion } | null = null;
    let ia: EstadoIA = { estado: 'apagada' };
    if (usarIA) {
      alCambiarFase?.('leyendo');
      try {
        lectura = await conTope(analizarConceptoSwipe(await copiaParaIA(bitmap)), tope);
        ia = { estado: 'leido', textoEnImagen: !!lectura?.textoEnImagen, conIlustracion: !!lectura?.ilustracion };
      } catch (e) {
        lectura = null;
        // Solo se muestra el mensaje si ya viene en español (lo mandó el servidor o es el tope); un corte de red dice «Failed to fetch».
        const enEspanol = e instanceof ApiError || (e instanceof Error && e.name === 'TopeVencido');
        ia = { estado: 'fallo', motivo: enEspanol ? (e as Error).message : 'No se pudo consultar a la IA.' };
      }
    }
    // Leída y sin ilustración = una lámina de puro texto: la tarjeta queda sin imagen. Sin lectura, la imagen entera.
    const caja: CajaIlustracion | null = lectura ? lectura.ilustracion ?? null : { ...IMAGEN_COMPLETA };
    let imagenUrl: string | undefined;
    if (caja) {
      alCambiarFase?.('subiendo');
      imagenUrl = await subir(await ilustracionParaSubir(bitmap, archivo, caja));
    }
    return { titulo: lectura?.titulo || tituloDeArchivo(archivo.name), descripcion: lectura?.descripcion ?? '', imagenUrl, ia };
  } finally {
    bitmap.close();
  }
}
