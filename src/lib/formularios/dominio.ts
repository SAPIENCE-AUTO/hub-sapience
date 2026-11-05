/**
 * El dominio donde contestan los participantes (pedido de Sergio, 2026-10-26):
 * sharpli.mx en lugar del dominio del Hub. Es el mismo sitio de Render, pero
 * ahí solo se cargan las pantallas de los participantes (main.tsx → SoloFormularios):
 * el formulario y, desde nov 2026, la página para firmar el NDA (/nda/:token); nunca
 * el Hub. El servidor solo le contesta lo que esas pantallas usan (FORMULARIO_ENDPOINTS
 * en server/corsFormularios.ts). Los enlaces que ya se mandaron con el dominio del Hub
 * siguen funcionando. El enlace del NDA lo arma el servidor (serverUtils/nda/servicio.ts).
 */
export const URL_FORMULARIOS = 'https://sharpli.mx';

/** Los nombres con los que se abre: sharpli.mx, www.sharpli.mx y, para probar en la Mac, sharpli.localhost. */
const DOMINIOS = new Set(['sharpli.mx', 'www.sharpli.mx', 'sharpli.localhost']);

export const esDominioDeFormularios = (hostname = window.location.hostname) => DOMINIOS.has(hostname);

/** El enlace que se manda a los participantes. En la Mac, el del Hub local (sharpli.mx aún no tiene los cambios). */
export const enlaceDeFormulario = (codigo: string) =>
  `${import.meta.env.DEV ? window.location.origin : URL_FORMULARIOS}/f/${codigo}`;
