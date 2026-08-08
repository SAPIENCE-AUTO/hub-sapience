import { z } from 'zod';
import { createEndpoint, Projects } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Retrieves the last saved recruitment analysis for a project/board from the database',
  inputSchema: z.object({
    projectCode: z.string(),
    boardName: z.string(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    analysis: z.any().optional(),
    savedAt: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const { projectCode, boardName } = input;

    const project = await Projects.findOne({
      filters: { projectCode },
      fields: ['id', 'lastAnalysisJson', 'lastAnalysisAt'],
    });

    if (!project?.lastAnalysisJson) {
      return { found: false };
    }

    try {
      const allAnalyses = JSON.parse(project.lastAnalysisJson);
      const analysis = allAnalyses[boardName];
      if (!analysis) return { found: false };
      return {
        found: true,
        analysis,
        savedAt: project.lastAnalysisAt ?? undefined,
      };
    } catch {
      return { found: false };
    }
  },
});
