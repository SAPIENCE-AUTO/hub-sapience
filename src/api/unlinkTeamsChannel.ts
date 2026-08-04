import { z } from 'zod';
import { createEndpoint, Projects } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Unlinks a Teams channel from a project',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const project = await Projects.findOne({ filters: { projectCode: input.projectCode } });
    if (!project) throw new Error(`Project not found: ${input.projectCode}`);
    await Projects.update({
      id: project.id,
      record: { teamsChannelStatus: '', teamsChannelUrl: '' },
    });
    return { success: true };
  },
});
