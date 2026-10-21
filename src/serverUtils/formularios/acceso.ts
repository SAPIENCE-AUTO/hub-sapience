import { ZiteError } from '../../../server/compat';
import { puedeVerFormularios } from '../../lib/formularios/acceso';

// El candado real de Tools → Formularios vive aquí; el de la pestaña (ProjectToolsTab) es cosmético.
// Mismo criterio que Conciliación (serverUtils/conciliacion/acceso.ts).
export function exigirAccesoFormularios(context: { user?: { email?: string } | null }) {
  if (!puedeVerFormularios(context.user?.email)) {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'Los formularios todavía no están habilitados para tu usuario.' });
  }
}
