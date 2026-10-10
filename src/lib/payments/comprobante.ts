// Lo que hace falta para mostrar un comprobante de pago dentro del detalle: saber qué tipo de archivo es (por sus
// primeros bytes, no por la extensión de la liga, que puede faltar o mentir) y cómo llamar a cada uno. Solo lógica;
// la descarga y el visor están en components/payments/VistaPreviaComprobante.

export type TipoArchivo = 'pdf' | 'imagen' | 'otro';

/** Un archivo adjunto a un pago, como lo guarda la base: su liga y, si se capturó, el nombre original. */
export interface Adjunto {
  url: string;
  filename?: string;
}

/** Hasta cuántos bytes se baja un comprobante para mostrarlo en la ventana; más grande, se ofrece abrirlo aparte. */
export const LIMITE_VISTA_PREVIA = 15 * 1024 * 1024;

/** Cuántos bytes del principio basta mirar para reconocer el tipo. */
export const BYTES_PARA_RECONOCER = 1024;

const empieza = (b: Uint8Array, firma: number[], desde = 0) => firma.every((v, i) => b[desde + i] === v);

/**
 * Qué tipo de archivo es, según sus primeros bytes. Devuelve también el tipo MIME real, para armar el archivo
 * temporal con el tipo correcto aunque el servidor lo haya mandado mal. Lo que no se pueda mostrar en el navegador
 * (Word, Excel, HEIC de iPhone, texto…) es «otro».
 */
export function reconoceArchivo(bytes: Uint8Array): { tipo: TipoArchivo; mime: string | null } {
  // Un PDF puede traer algo de basura antes de «%PDF» (la norma permite hasta 1024 bytes).
  const inicio = bytes.subarray(0, BYTES_PARA_RECONOCER);
  for (let i = 0; i + 3 < inicio.length; i++) {
    if (empieza(inicio, [0x25, 0x50, 0x44, 0x46], i)) return { tipo: 'pdf', mime: 'application/pdf' };
  }
  if (empieza(bytes, [0x89, 0x50, 0x4e, 0x47])) return { tipo: 'imagen', mime: 'image/png' };
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return { tipo: 'imagen', mime: 'image/jpeg' };
  if (empieza(bytes, [0x47, 0x49, 0x46, 0x38])) return { tipo: 'imagen', mime: 'image/gif' };
  if (empieza(bytes, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return { tipo: 'imagen', mime: 'image/webp' };
  return { tipo: 'otro', mime: null };
}

/** Cómo se llama cada comprobante en pantalla: «Comprobante» si es uno solo, «Comprobante 2» si hay varios. */
export function etiquetaComprobante(indice: number, total: number): string {
  return total > 1 ? `Comprobante ${indice + 1}` : 'Comprobante';
}

/** El nombre con el que se descarga: el original si se guardó (sin rutas raras) o uno armado con la ODC. */
export function nombreDeDescarga(adjunto: Adjunto, poNumber: string | undefined, indice: number, mime: string | null): string {
  const original = (adjunto.filename ?? '').split(/[\\/]/).pop()?.trim();
  if (original) return original;
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'bin';
  return `comprobante-${poNumber ?? 'pago'}${indice > 0 ? `-${indice + 1}` : ''}.${extension}`;
}
