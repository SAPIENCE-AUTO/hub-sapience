// «Lo meteríamos en Tools sólo para Sergio primero» (Sergio, 2026-10-21): se prueba antes de abrirlo al equipo.
// El candado real está en el servidor (serverUtils/formularios/acceso.ts); aquí solo decide si se ve la pestaña.
export const FORMULARIOS_ALLOWED_EMAILS = ['sergio@sapience.com.mx'];

export const puedeVerFormularios = (email?: string | null) =>
  !!email && FORMULARIOS_ALLOWED_EMAILS.includes(email.toLowerCase());
