import { z } from 'zod';
import { createEndpoint } from 'zite-integrations-backend-sdk';

const PROYECTOS_TEAM_ID = 'cf2d446a-aa33-4d18-bd97-5933e746ef8f';

export default createEndpoint({
  authenticated: true,
  description: 'Lists the "Proyectos" Microsoft Teams team and its channels via Graph API',
  inputSchema: z.object({}),
  outputSchema: z.object({
    teams: z.array(z.object({
      id: z.string(),
      displayName: z.string(),
      channels: z.array(z.object({
        id: z.string(),
        displayName: z.string(),
        webUrl: z.string().optional(),
      })),
    })),
  }),
  execute: async () => {
    const token = process.env.ZITE_MICROSOFTTEAMS_ACCESS_TOKEN;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const chRes = await fetch(`https://graph.microsoft.com/v1.0/teams/${PROYECTOS_TEAM_ID}/channels`, { headers });
    if (!chRes.ok) return { teams: [] };

    const chData = await chRes.json() as { value: Array<{ id: string; displayName: string; webUrl?: string }> };

    return {
      teams: [{
        id: PROYECTOS_TEAM_ID,
        displayName: 'Proyectos',
        channels: chData.value.map(ch => ({ id: ch.id, displayName: ch.displayName, webUrl: ch.webUrl })),
      }],
    };
  },
});
