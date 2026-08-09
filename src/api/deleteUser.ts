import { z } from 'zod';
import { createEndpoint, ZiteError, Users, pool } from '../../server/compat';
import { getSupabaseAdmin } from '../../server/supabaseAdmin';

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

    const target = await Users.findOne({ id: input.id });
    if (!target) throw new ZiteError({ code: 'NOT_FOUND', message: 'Usuario no encontrado' });

    // Borra primero la cuenta de Supabase Auth: revoca el acceso de inmediato
    // aunque falle el borrado del registro de la app después. Sin esto, quien
    // se borra desde la app conserva su cuenta de auth.users y sigue pudiendo
    // autenticarse (el backend lo rechaza con NOT_PROVISIONED, pero el login
    // en sí sigue funcionando).
    if (target.email) {
      const { rows } = await pool.query('select id from auth.users where lower(email) = lower($1)', [target.email]);
      const authId = rows[0]?.id;
      if (authId) {
        const { error } = await getSupabaseAdmin().auth.admin.deleteUser(authId);
        if (error) {
          throw new ZiteError({ code: 'INTERNAL_ERROR', message: `No se pudo borrar la cuenta de Supabase Auth: ${error.message}` });
        }
      }
    }

    await Users.delete({ id: input.id });

    return { success: true };
  },
});
