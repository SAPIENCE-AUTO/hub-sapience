// Lógica pura de «subir un concepto como imagen» en Swipe: la comparten el servidor (que lee la imagen con IA y
// normaliza lo que contesta), la pantalla (que recorta y sube la ilustración) y las pruebas.

/** Mismos topes que createSwipeIdea / updateSwipeIdea. */
export const MAX_TITULO = 60;
export const MAX_DESCRIPCION = 180;

/** Lado más largo con el que se manda la imagen a la IA: más grande no lee mejor y sí cuesta más. */
export const LADO_MAX_PARA_IA = 1568;
/** Lado más largo de la ilustración que se guarda en la tarjeta. */
export const LADO_MAX_ILUSTRACION = 2048;

/** Caja de la ilustración como fracciones (0 a 1) del ancho y del alto de la imagen: sirve igual en la copia chica que se
 *  manda a la IA y en el original. */
export interface CajaIlustracion { x: number; y: number; w: number; h: number }

export interface LecturaConcepto {
  titulo: string;
  descripcion: string;
  /** La imagen traía texto, así que título y descripción salen de ahí. En false la IA los propuso por lo que se ve. */
  textoEnImagen: boolean;
  /** Dónde está la ilustración; null si la imagen no tiene ninguna (solo texto). */
  ilustracion: CajaIlustracion | null;
}

/** Qué pasó con la lectura de la IA al preparar un concepto. */
export type EstadoIA =
  | { estado: 'leido'; textoEnImagen: boolean; conIlustracion: boolean }
  | { estado: 'apagada' }
  | { estado: 'fallo'; motivo: string };

/** Un concepto en imagen, ya leído y con su ilustración subida: lo necesario para crear la idea. */
export interface ConceptoListo {
  titulo: string;
  descripcion: string;
  imagenUrl?: string;
  ia: EstadoIA;
}

/** Lo que conviene revisar de una idea recién creada desde una imagen (undefined si salió limpia). */
export function avisoDeConcepto(ia: EstadoIA): string | undefined {
  if (ia.estado === 'apagada') return 'Sin IA: pon el nombre y la descripción.';
  if (ia.estado === 'fallo') {
    const motivo = ia.motivo.trim().replace(/[.\s]+$/, '');
    return `${motivo ? `${motivo}. ` : ''}Pon el nombre y la descripción.`;
  }
  if (!ia.textoEnImagen) return 'No traía texto: nombre y descripción son por lo que se ve. Revísalos.';
  if (!ia.conIlustracion) return 'Solo traía texto: quedó sin ilustración.';
  return undefined;
}

/** Lo que contesta la IA tal cual: la caja en píxeles de la imagen que se le mandó. */
export interface LecturaCruda {
  titulo: string;
  descripcion: string;
  textoEnImagen: boolean;
  tieneIlustracion: boolean;
  ilustracion: { x1: number; y1: number; x2: number; y2: number };
}

const COMILLAS = /^["'“”‘’«»]+|["'“”‘’«»]+$/g;

/** Deja el texto en una sola línea, sin comillas de adorno, y de ≤ `max` caracteres: corta al final de una oración si hay
 *  una razonable y, si no, en una palabra con «…». */
export function ajustarTexto(texto: string, max: number): string {
  const limpio = (texto ?? '').replace(/\s+/g, ' ').trim().replace(COMILLAS, '').trim();
  if (limpio.length <= max) return limpio;
  const tramo = limpio.slice(0, max);
  const finOracion = Math.max(tramo.lastIndexOf('. '), tramo.lastIndexOf('! '), tramo.lastIndexOf('? '));
  if (finOracion >= max * 0.5) return tramo.slice(0, finOracion + 1);
  const corte = limpio.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  const base = espacio >= max * 0.5 ? corte.slice(0, espacio) : corte;
  return `${base.replace(/[\s,;:.\-–—]+$/, '')}…`;
}

/** Título de reserva cuando la IA no pudo leer la imagen: el nombre del archivo, sin extensión ni guiones. */
export function tituloDeArchivo(nombre: string): string {
  const sinExtension = (nombre ?? '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const legible = sinExtension.replace(/[_\-.]+/g, ' ').replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!legible) return 'Concepto';
  return ajustarTexto(legible.charAt(0).toUpperCase() + legible.slice(1), MAX_TITULO);
}

const REDONDEO = 10_000;
const redondea = (n: number) => Math.round(n * REDONDEO) / REDONDEO;
/** Una caja que cubre casi toda la imagen se toma como la imagen completa (no se recorta). */
const UMBRAL_COMPLETA = 0.97;
/** Una caja más chica que esto no es «la ilustración» sino un ícono o un logotipo. */
const LADO_MIN = 0.08;
const AREA_MIN = 0.03;

export const IMAGEN_COMPLETA: CajaIlustracion = { x: 0, y: 0, w: 1, h: 1 };

export function esImagenCompleta(caja: CajaIlustracion): boolean {
  return caja.w >= UMBRAL_COMPLETA && caja.h >= UMBRAL_COMPLETA;
}

/** Pasa la caja que dio la IA (píxeles de la imagen que vio) a fracciones. null si no es una caja creíble. */
export function cajaDesdePixeles(
  c: { x1: number; y1: number; x2: number; y2: number }, ancho: number, alto: number,
): CajaIlustracion | null {
  if (![c.x1, c.y1, c.x2, c.y2, ancho, alto].every(Number.isFinite) || ancho <= 0 || alto <= 0) return null;
  const clampX = (v: number) => Math.min(Math.max(v, 0), ancho);
  const clampY = (v: number) => Math.min(Math.max(v, 0), alto);
  const x1 = clampX(Math.min(c.x1, c.x2)), x2 = clampX(Math.max(c.x1, c.x2));
  const y1 = clampY(Math.min(c.y1, c.y2)), y2 = clampY(Math.max(c.y1, c.y2));
  const w = (x2 - x1) / ancho, h = (y2 - y1) / alto;
  if (w < LADO_MIN || h < LADO_MIN || w * h < AREA_MIN) return null;
  const caja = { x: redondea(x1 / ancho), y: redondea(y1 / alto), w: redondea(w), h: redondea(h) };
  return esImagenCompleta(caja) ? { ...IMAGEN_COMPLETA } : caja;
}

/** Convierte lo que contestó la IA en lo que usa la pantalla: textos dentro de los topes y la caja en fracciones. */
export function normalizarLectura(crudo: LecturaCruda, ancho: number, alto: number): LecturaConcepto {
  return {
    titulo: ajustarTexto(crudo.titulo, MAX_TITULO),
    descripcion: ajustarTexto(crudo.descripcion, MAX_DESCRIPCION),
    textoEnImagen: crudo.textoEnImagen,
    ilustracion: crudo.tieneIlustracion ? cajaDesdePixeles(crudo.ilustracion, ancho, alto) : null,
  };
}

/** Tamaño de la copia que se manda a la IA: el mismo dibujo con el lado largo a lo más `ladoMax`. */
export function dimensionesEscaladas(ancho: number, alto: number, ladoMax: number): { ancho: number; alto: number } {
  const escala = Math.min(1, ladoMax / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

/** Rectángulo en píxeles del original que hay que recortar para la caja, con una holgura (fracción del tamaño de la caja)
 *  por lado para no comerse el borde de la ilustración si la IA fue justa. */
export function rectDeRecorte(
  caja: CajaIlustracion, anchoReal: number, altoReal: number, holgura = 0.01,
): { sx: number; sy: number; sw: number; sh: number } {
  const hx = caja.w * holgura, hy = caja.h * holgura;
  const x1 = Math.max(0, caja.x - hx), y1 = Math.max(0, caja.y - hy);
  const x2 = Math.min(1, caja.x + caja.w + hx), y2 = Math.min(1, caja.y + caja.h + hy);
  const sx = Math.floor(x1 * anchoReal), sy = Math.floor(y1 * altoReal);
  const sw = Math.min(anchoReal, Math.ceil(x2 * anchoReal)) - sx;
  const sh = Math.min(altoReal, Math.ceil(y2 * altoReal)) - sy;
  return { sx, sy, sw: Math.max(1, sw), sh: Math.max(1, sh) };
}
