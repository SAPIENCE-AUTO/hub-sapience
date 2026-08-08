import { z } from 'zod';
import { createEndpoint, ZiteError, AppSettings } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Save global app settings (default visible pages). Requires admin access.',
  inputSchema: z.object({
    settingId: z.string().optional(),
    defaultVisiblePages: z.array(z.string()),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    const u = context.user!;
    const isAdmin =
      u.role === 'Owner' || u.role === 'Socio' ||
      u.accessComercial === 'Administrar' ||
      u.accessOperacion === 'Administrar' ||
      u.accessAdmin === 'Administrar' ||
      u.accessFinanzas === 'Administrar' ||
      u.accessOtros === 'Administrar';

    if (!isAdmin)
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para guardar configuración' });

    if (input.settingId) {
      await AppSettings.update({
        id: input.settingId,
        record: { defaultVisiblePages: input.defaultVisiblePages },
      });
      return { success: true, id: input.settingId };
    } else {
      const created = await AppSettings.create({
        record: { settingKey: 'default', defaultVisiblePages: input.defaultVisiblePages },
      });
      return { success: true, id: created.id };
    }
  },
});
