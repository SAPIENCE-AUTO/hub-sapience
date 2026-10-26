/**
 * El dominio donde contestan los participantes (pedido de Sergio, 2026-10-26):
 * sharpli.mx en lugar del dominio del Hub. Es el mismo sitio de Render, pero
 * ahí solo se carga el formulario (main.tsx), nunca el Hub, y el servidor solo
 * le contesta lo que el formulario usa (FORMULARIO_ENDPOINTS en server/index.ts).
 * Los enlaces que ya se mandaron con el dominio del Hub siguen funcionando.
 */
export const URL_FORMULARIOS = 'https://sharpli.mx';

/** Los nombres con los que se abre: sharpli.mx, www.sharpli.mx y, para probar en la Mac, sharpli.localhost. */
const DOMINIOS = new Set(['sharpli.mx', 'www.sharpli.mx', 'sharpli.localhost']);

export const esDominioDeFormularios = (hostname = window.location.hostname) => DOMINIOS.has(hostname);

/** El enlace que se manda a los participantes. En la Mac, el del Hub local (sharpli.mx aún no tiene los cambios). */
export const enlaceDeFormulario = (codigo: string) =>
  `${import.meta.env.DEV ? window.location.origin : URL_FORMULARIOS}/f/${codigo}`;
