import { ZiteError } from '../../../server/compat';
import { puedeVerBuscador } from '../../lib/busqueda/acceso';

// El candado real de «Buscar gente» vive aquí; el del menú y el de la pantalla es cosmético. Quién entra se decide en
// lib/busqueda/acceso.ts (hoy solo Sergio, mismo criterio que la conciliación bancaria y los indicadores). Lo usan los tres endpoints del buscador.
export function exigirAccesoBuscador(context: { user?: { email?: string } | null }) {
  if (!puedeVerBuscador(context.user?.email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Buscar gente no está habilitado para tu usuario.' });
  }
}
