import { z } from 'zod';
import { createEndpoint, Suppliers } from 'zite-integrations-backend-sdk';

function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export default createEndpoint({
  description: 'Generate or regenerate portal access token and password for a supplier',
  authenticated: true,
  inputSchema: z.object({ supplierId: z.string() }),
  outputSchema: z.object({
    token: z.string(),
    password: z.string(),
    portalUrl: z.string(),
  }),
  execute: async ({ input }) => {
    const token = generateUUID();
    const password = randomAlphanumeric(8);
    const appUrl = process.env.ZITE_APP_URL ?? '';

    await Suppliers.update({
      id: input.supplierId,
      record: { accessToken: token, portalPassword: password },
    });

    return {
      token,
      password,
      portalUrl: `${appUrl}/portal/${token}`,
    };
  },
});
