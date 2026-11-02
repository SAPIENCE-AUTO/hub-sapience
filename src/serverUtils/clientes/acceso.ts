import { ZiteError } from '../../../server/compat';

// Catálogo de clientes (razones sociales, condiciones de cobro y contactos): mismo criterio que Cobranza — Owner o nivel de compra Finanzas.
// El candado real vive aquí, en el servidor; el del menú y la página (Layout, ClientesPage) es cosmético.
export function exigirAccesoClientes(context: { user?: { email?: string } | null }) {
  const user = (context.user ?? {}) as { role?: string; purchaseLevel?: string };
  const role = user.role;
  const level = user.purchaseLevel ?? 'Creador';
  if (role !== 'Owner' && level !== 'Finanzas') {
    throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para ver ni editar el catálogo de clientes' });
  }
}
