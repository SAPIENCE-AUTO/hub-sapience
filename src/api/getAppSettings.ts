import { z } from 'zod';
import { createEndpoint, AppSettings } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Get global app settings including default visible pages',
  inputSchema: z.object({}),
  outputSchema: z.object({
    defaultVisiblePages: z.array(z.string()),
    settingId: z.string().optional(),
  }),
  execute: async () => {
    const record = await AppSettings.findOne({ filters: { settingKey: 'default' } });
    return {
      defaultVisiblePages: record?.defaultVisiblePages ?? [],
      settingId: record?.id,
    };
  },
});
