import { z } from 'zod';
import { createEndpoint, Users, RubroAssignments } from 'zite-integrations-backend-sdk';

const RUBROS_LIST = [
  'Reclutamiento e incentivos',
  'Moderación',
  'Management',
  'Logística y operación',
  'Back office',
] as const;

export default createEndpoint({
  authenticated: true,
  description: 'Get the user assigned to each quotation rubro, plus the full user list',
  inputSchema: z.object({}),
  outputSchema: z.object({
    assignments: z.array(z.object({
      id: z.string().optional(),
      rubro: z.string(),
      assignedUserId: z.string().optional(),
      assignedUserName: z.string().optional(),
      assignedUserEmail: z.string().optional(),
    })),
    users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
  }),
  execute: async () => {
    const [{ records: dbAssignments }, { records: allUsers }] = await Promise.all([
      RubroAssignments.findAll({ limit: 20 }),
      Users.findAll({ limit: 300, fields: ['id', 'email', 'firstName', 'lastName'] }),
    ]);

    const userById = new Map(allUsers.map(u => [u.id, u]));

    const assignments = RUBROS_LIST.map(rubro => {
      const found = dbAssignments.find(a => a.rubro === rubro);
      const assignedUserId = found
        ? ((Array.isArray(found.assignedUser) ? found.assignedUser[0] : found.assignedUser) as string | undefined)
        : undefined;
      const user = assignedUserId ? userById.get(assignedUserId) : undefined;
      return {
        id: found?.id,
        rubro,
        assignedUserId,
        assignedUserName: user
          ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || undefined)
          : undefined,
        assignedUserEmail: user?.email || undefined,
      };
    });

    return {
      assignments,
      users: allUsers.map(u => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
        email: u.email || '',
      })),
    };
  },
});
