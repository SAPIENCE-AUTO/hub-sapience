// Quién puede usar «Buscar gente». «Ahorita accesible sólo para Sergio, después lo abrimos a todos» (Sergio, 2026-11-13). Antes de esto estaba abierto a toda la organización, como Filtros.
// Para abrirlo a todos otra vez: `BUSCADOR_SOLO_PARA = null`. Es el ÚNICO cambio: el menú, la pantalla y el servidor leen esto.
// El candado real está en el servidor (serverUtils/busqueda/acceso.ts); el del menú y el de la pantalla son cosméticos.
export const BUSCADOR_SOLO_PARA: string[] | null = ['sergio@sapience.com.mx'];

/** ¿Este correo puede ver y usar «Buscar gente»? (Sin importar mayúsculas.) `solo` existe para poder probar las dos configuraciones: en el uso normal es la lista de arriba. */
export function puedeVerBuscador(email?: string | null, solo: string[] | null = BUSCADOR_SOLO_PARA): boolean {
  if (solo === null) return !!email; // abierto a toda la organización: cualquiera que entró al Hub
  return solo.includes((email ?? '').toLowerCase());
}
