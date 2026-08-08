import { z } from 'zod';
import { createEndpoint, ZiteError, Users } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Delete a user record. Admins only. Cannot delete yourself.',
  inputSchema: z.object({
    id: z.string(),
  }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    const u = context.user!;
    const isAdmin = u.role === 'Owner' || u.role === 'Socio' ||
      u.accessComercial === 'Administrar' ||
      u.accessOperacion === 'Administrar' ||
      u.accessAdmin === 'Administrar' ||
      u.accessFinanzas === 'Administrar' ||
      u.accessOtros === 'Administrar';

    if (!isAdmin) throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para eliminar usuarios' });
    if (input.id === u.id) throw new ZiteError({ code: 'FORBIDDEN', message: 'No puedes eliminar tu propio usuario' });

    await Users.delete({ id: input.id });

    return { success: true };
  },
});
