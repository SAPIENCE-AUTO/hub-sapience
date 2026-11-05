// Qué puede llamar el navegador desde el dominio de los participantes (sharpli.mx, ver src/lib/formularios/dominio.ts y docs/filtros.md).
// Ese sitio solo sirve lo que ven los participantes (el formulario de Filtros y la página para firmar el NDA); desde ahí el navegador solo puede llamar los servicios de esas dos pantallas.
// Va aparte de ZITE_APP_URL (el front del Hub, que sí puede llamar todo) porque esa variable también arma enlaces de vistas compartidas y correos de ODC.
// Sacado de server/index.ts para poder probarlo (server/scripts/test-nda.ts): si una pantalla de participantes llama un servicio que no está aquí, solo falla en producción, en silencio, por CORS.

export const FORMULARIO_ORIGINS = ['https://sharpli.mx', 'https://www.sharpli.mx'];

export const FORMULARIO_ENDPOINTS = new Set([
  // formulario de Filtros
  'getFormularioPublico', 'submitFormularioRespuesta', 'getAvisoPrivacidad',
  'getCodigoPostal', 'sugerirDireccion', 'detalleDireccion', 'upload',
  // página para firmar el NDA (/nda/:token): ver, firmar y rechazar con la liga personal
  'getNDAPublic', 'signNDA', 'rejectNDA',
]);

/** El origen que CORS deja pasar para llamar al servicio `nombre`, o null si no. `hub` son los orígenes del front del Hub (ZITE_APP_URL). */
export function origenPermitido(origin: string, nombre: string, hub: string[]): string | null {
  if (hub.includes(origin)) return origin;
  if (FORMULARIO_ORIGINS.includes(origin) && FORMULARIO_ENDPOINTS.has(nombre)) return origin;
  return null;
}
