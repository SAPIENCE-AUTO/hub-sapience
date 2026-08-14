import { z } from 'zod';
import { createEndpoint, Projects } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Unlinks a Teams channel from a project',
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input }) => {
    const project = await Projects.findOne({ filters: { projectCode: input.projectCode } });
    if (!project) throw new Error(`Project not found: ${input.projectCode}`);
    // teamsChannelStatus solo acepta null o 'Pendiente'/'Creando'/'Listo'/'Error'
    // (ver users_departamento_chk-style CHECK en schema.sql) — '' truena el guardado.
    await Projects.update({
      id: project.id,
      record: { teamsChannelStatus: null, teamsChannelUrl: null },
    });
    return { success: true };
  },
});
