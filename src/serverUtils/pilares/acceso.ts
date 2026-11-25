import { ZiteError } from '../../../server/compat';

// Pilares (unidades de negocio): quién puede qué. Administrar el catálogo de pilares (crear, renombrar, desactivar), ver y capturar COSTOS por pilar y trabajar sobre muchos deals
// a la vez (la pantalla de Pilares) es de Owner o Socio. Repartir el INGRESO de un deal entre pilares lo puede hacer cualquiera que pueda editar deals.
// El candado real vive aquí, en el servidor; el de la pantalla y el del menú es cosmético.

/** `user` es el usuario del contexto del endpoint (trae el rol entre sus campos); desconocido o sin sesión no puede. */
export function puedeAdministrarPilares(user: unknown): boolean {
  const rol = (user as { role?: string | null } | null | undefined)?.role;
  return rol === 'Owner' || rol === 'Socio';
}

export function exigirAdministrarPilares(context: { user?: unknown }) {
  if (!puedeAdministrarPilares(context.user)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Solo Owner o Socio pueden administrar los pilares y ver sus costos' });
  }
}
