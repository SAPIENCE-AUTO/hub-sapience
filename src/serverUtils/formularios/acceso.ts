import { ZiteError } from '../../../server/compat';
import { puedeVerFormularios } from '../../lib/formularios/acceso';

// El candado real de Filtros y la Muestra vive aquí; el de las pestañas es cosmético. Desde el 2026-10-26 deja
// pasar a toda la organización (cualquier usuario del Hub); si se vuelve a acotar, se acota en puedeVerFormularios.
export function exigirAccesoFormularios(context: { user?: { email?: string } | null }) {
  if (!puedeVerFormularios(context.user?.email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Filtros no está habilitado para tu usuario.' });
  }
}
