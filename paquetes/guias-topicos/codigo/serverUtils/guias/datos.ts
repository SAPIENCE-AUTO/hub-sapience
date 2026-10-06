import { GuiasTopicos, ZiteError } from '../../../server/compat';

export async function cargarGuia(id: string) {
  const g = await GuiasTopicos.findOne({ id });
  if (!g || g.deletedAt) throw new ZiteError({ code: 'NOT_FOUND', message: 'Guía no encontrada' });
  return g;
}

/** Borra quien la creó (o, si se quiere, un rol con permiso: ajústalo a los roles del Hub). */
export function puedeBorrar(context: { user?: { id?: string; role?: string } | null }, g: { createdBy?: unknown }) {
  const autor = Array.isArray(g.createdBy) ? g.createdBy[0] : g.createdBy;
  return autor === context.user?.id || ['Owner', 'Socio'].includes(context.user?.role ?? '');
}
