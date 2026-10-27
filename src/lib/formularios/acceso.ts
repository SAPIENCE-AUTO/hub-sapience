// Filtros y la Muestra, para toda la organización (Sergio, 2026-10-26): cualquiera que entra al Hub. Antes
// fue solo para Sergio («lo meteríamos en Tools sólo para Sergio primero», 2026-10-21), mientras se probaba.
// El candado real está en el servidor (serverUtils/formularios/acceso.ts); aquí solo decide si se ven las pestañas.
export const puedeVerFormularios = (email?: string | null) => !!email;
