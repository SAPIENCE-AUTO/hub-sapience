import { z } from 'zod';
import { createEndpoint } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'List all Fillout forms for the connected account',
  inputSchema: z.object({}),
  outputSchema: z.object({
    forms: z.array(z.object({
      formId: z.string(),
      name: z.string(),
    })),
  }),
  execute: async () => {
    const apiKey = process.env.ZITE_FILLOUT_API_KEY ?? '';
    if (!apiKey) throw new Error('Fillout API key not configured');

    const res = await fetch('https://api.fillout.com/v1/api/forms', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Error al obtener formularios: ${res.status}`);

    const data = await res.json();
    const raw: unknown[] = Array.isArray(data) ? data : (data.forms ?? []);

    return {
      forms: raw.map((f: any) => ({
        formId: String(f.formId ?? f.id ?? ''),
        name: String(f.name ?? f.title ?? 'Sin nombre'),
        tags: Array.isArray(f.tags) ? f.tags as string[] : [],
      })).filter(f => f.formId && f.tags.includes('form')),
    };
  },
});
