// Quién usa las guías de tópicos. Por ahora solo Sergio, mientras se prueba (2026-10-26); para abrirlo a todo el equipo basta con
// `export const puedeVerGuias = (email?: string | null) => !!email`. El candado real está en el servidor (serverUtils/guias/acceso.ts);
// aquí solo se decide si se ve la pestaña.
export const GUIAS_EMAILS = ['sergio@sapience.com.mx'];

export const puedeVerGuias = (email?: string | null): boolean => !!email && GUIAS_EMAILS.includes(email.trim().toLowerCase());
