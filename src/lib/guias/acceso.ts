// Las guías de tópicos las usa todo el equipo (Sergio, 2026-10-26): cualquiera que entra al Hub. Antes fue solo para Sergio, mientras se probaba.
// El candado real está en el servidor (serverUtils/guias/acceso.ts); aquí solo se decide si se ve la pestañita «Guías» dentro de Tools.
// Si se vuelve a acotar, se acota aquí.
export const puedeVerGuias = (email?: string | null): boolean => !!email;
