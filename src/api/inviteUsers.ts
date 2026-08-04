import { z } from 'zod';
import { createEndpoint, ZiteError, Users } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Invite/create users by email. Admins only. Uses upsert to avoid duplicates.',
  inputSchema: z.object({
    emails: z.array(z.string().email()),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    role: z.string().optional(),
    accessComercial: z.string().optional(),
    accessOperacion: z.string().optional(),
    accessAdmin: z.string().optional(),
    accessFinanzas: z.string().optional(),
    accessOtros: z.string().optional(),
  }),
  outputSchema: z.object({
    created: z.number(),
    skipped: z.number(),
    users: z.array(z.object({ id: z.string(), email: z.string() })),
  }),
  execute: async ({ input, context }) => {
    const u = context.user!;
    const isAdmin = u.role === 'Owner' || u.role === 'Socio' ||
      u.accessComercial === 'Administrar' ||
      u.accessOperacion === 'Administrar' ||
      u.accessAdmin === 'Administrar' ||
      u.accessFinanzas === 'Administrar' ||
      u.accessOtros === 'Administrar';

    if (!isAdmin) throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes permisos para agregar usuarios' });

    const uniqueEmails: string[] = [...new Set<string>(input.emails.map(e => e.trim().toLowerCase()))];

    // Check existing users to know how many are new
    const existing = await Users.findAll({ filters: { email: { in: uniqueEmails } } });
    const existingEmails = new Set(existing.records.map(r => r.email?.toLowerCase()));
    const skipped = existingEmails.size;

    const records: { email: string; firstName?: string; lastName?: string; role?: string; accessComercial?: string; accessOperacion?: string; accessAdmin?: string; accessFinanzas?: string; accessOtros?: string }[] = uniqueEmails.map(email => ({
      email,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.accessComercial ? { accessComercial: input.accessComercial } : {}),
      ...(input.accessOperacion ? { accessOperacion: input.accessOperacion } : {}),
      ...(input.accessAdmin ? { accessAdmin: input.accessAdmin } : {}),
      ...(input.accessFinanzas ? { accessFinanzas: input.accessFinanzas } : {}),
      ...(input.accessOtros ? { accessOtros: input.accessOtros } : {}),
    }));

    const result = await Users.bulkCreate({ records, matchOn: ['email'] });

    const users = result.records.map(r => ({
      id: r.id,
      email: (r.fields.email ?? '') as string,
    }));

    return {
      created: uniqueEmails.length - skipped,
      skipped,
      users,
    };
  },
});
