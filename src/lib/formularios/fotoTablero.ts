import type { FotoSubida } from './tipos';

/**
 * Las fotos de un filtro en el tablero de Reclutamiento (pedido de Sergio,
 * 2026-10-26): van en una columna «Archivo», como las de Fillout, pero como
 * viven en una carpeta privada la celda guarda una referencia
 * («hubfoto:<ruta>») y el Hub pide un enlace temporal al abrirla
 * (firmarFotosFormulario, solo con sesión). Con varias, una lista en JSON,
 * igual que las celdas de varios archivos.
 */
export const PREFIJO_FOTO = 'hubfoto:';
export const esFotoDeFiltro = (url: string) => url.startsWith(PREFIJO_FOTO);
export const rutaDeFoto = (url: string) => url.slice(PREFIJO_FOTO.length);

export function fotosParaTablero(valor: unknown): string | undefined {
  const fotos = (Array.isArray(valor) ? valor : []).filter((x): x is FotoSubida => typeof x?.ruta === 'string');
  if (!fotos.length) return undefined;
  const refs = fotos.map((f) => `${PREFIJO_FOTO}${f.ruta}`);
  return refs.length === 1 ? refs[0] : JSON.stringify(refs);
}

/** «1 foto», «3 fotos»: lo que decía la celda antes de que se vieran las fotos (se cambia sola). */
export const esConteoDeFotos = (texto: string) => /^\d+ fotos?$/.test(texto.trim());
