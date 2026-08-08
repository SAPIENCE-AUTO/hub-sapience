import { z } from 'zod';
import { createEndpoint, Users } from '../../server/compat';

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;   // 5 min — for activeEmails compat
const PRESENCE_WINDOW_MS = 30 * 60 * 1000; // 30 min — for granular status

export default createEndpoint({
  authenticated: true,
  description: 'Returns presence data for users active in the last 30 minutes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    activeEmails: z.array(z.string()),
    users: z.array(z.object({
      email: z.string(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      profilePhoto: z.string().optional(),
      lastSeenAt: z.string().optional(),
      activeChannel: z.string().nullable().optional(),
    })),
  }),
  execute: async () => {
    const cutoff30 = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
    const cutoff5  = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();

    const { records } = await Users.findAll({
      filters: { lastActiveAt: { gt: new Date(cutoff30) } },
      fields: ['email', 'lastActiveAt', 'activeChannel', 'firstName', 'lastName', 'profilePhoto'],
    });

    const r = records as Array<Record<string, unknown>>;

    const users = r
      .filter(rec => rec.email && rec.lastActiveAt)
      .map(rec => ({
        email: rec.email as string,
        firstName: rec.firstName as string | undefined,
        lastName: rec.lastName as string | undefined,
        profilePhoto: rec.profilePhoto as string | undefined,
        lastSeenAt: rec.lastActiveAt as string,
        activeChannel: rec.activeChannel as string | null ?? null,
      }));

    const activeEmails = users
      .filter(u => u.lastSeenAt > cutoff5)
      .map(u => u.email);

    return { activeEmails, users };
  },
});
