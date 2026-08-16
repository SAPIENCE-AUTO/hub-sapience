import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';

// createLink es idempotente para el mismo (type, scope): si ya existe un link
// de ese tipo sobre el archivo, Graph regresa el mismo en vez de crear otro —
// seguro de llamar cada vez que alguien le da "Copiar link", no acumula permisos.
async function createLink(driveId: string, itemId: string, scope: 'anonymous' | 'organization') {
  const res = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/createLink`, {
    method: 'POST',
    body: JSON.stringify({ type: 'view', scope }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.link?.webUrl as string | undefined;
}

export default createEndpoint({
  authenticated: true,
  description: 'Creates (or reuses) a view-only sharing link for a Teams file — anonymous if the tenant allows it, org-restricted otherwise',
  inputSchema: z.object({ driveId: z.string(), itemId: z.string() }),
  outputSchema: z.object({ url: z.string(), scope: z.enum(['anonymous', 'organization']) }),
  execute: async ({ input }) => {
    // Primero intenta un link público (sin login) — si la política de SharePoint
    // del tenant no permite links anónimos, Graph responde con error y se cae
    // al link restringido a la organización, que siempre funciona.
    const anon = await createLink(input.driveId, input.itemId, 'anonymous');
    if (anon) return { url: anon, scope: 'anonymous' as const };

    const org = await createLink(input.driveId, input.itemId, 'organization');
    if (org) return { url: org, scope: 'organization' as const };

    throw new Error('Microsoft Graph no pudo generar un link para compartir este archivo');
  },
});
