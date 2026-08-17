import { z } from 'zod';
import { createEndpoint, Projects } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';

const FOLDER_NAMES = ['PROPUESTA', 'CALENDARIOS', 'TIMELINE', 'ENTREGABLES', 'MATERIALES', 'GRABACIONES', 'GUÍAS'];

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function createChannelFolders(teamId: string, channelId: string) {
  // Retry up to 3 times with 5s delay — SharePoint may take time to provision the channel folder
  let folderRoot: { id: string; parentReference?: { driveId?: string } } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await graphFetch(
      `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/filesFolder`,
    );
    if (res.ok) {
      folderRoot = await res.json();
      break;
    }
    if (attempt < 3) await sleep(5000);
  }

  if (!folderRoot) {
    console.log('Could not get channel filesFolder after 3 attempts — skipping folder creation');
    return;
  }

  const driveId = folderRoot.parentReference?.driveId;
  const itemId = folderRoot.id;

  if (!driveId || !itemId) {
    console.log('Missing driveId or itemId — skipping folder creation', { driveId, itemId });
    return;
  }

  for (const name of FOLDER_NAMES) {
    try {
      const r = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children`, {
        method: 'POST',
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
      });
      if (!r.ok) {
        const err = await r.text();
        console.log(`Failed to create folder "${name}": ${r.status} ${err}`);
      }
    } catch (e) {
      console.log(`Error creating folder "${name}":`, e);
    }
  }
}

export default createEndpoint({
  authenticated: true,
  description: 'Creates a new Teams channel directly via Microsoft Graph (with its standard folders) or links an existing one to a project',
  inputSchema: z.object({
    projectCode: z.string(),
    mode: z.enum(['create', 'link']),
    teamId: z.string().optional(),
    channelName: z.string().optional(),
    channelUrl: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    channelUrl: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const project = await Projects.findOne({ filters: { projectCode: input.projectCode } });
    if (!project) throw new Error(`Project not found: ${input.projectCode}`);

    let channelUrl: string;

    if (input.mode === 'create') {
      if (!input.channelName) throw new Error('channelName is required for create mode');
      if (!input.teamId) throw new Error('teamId is required for create mode');

      // Creación directa vía Graph — hasta agosto 2026 esto pasaba por un
      // webhook de n8n porque el registro de la app en Azure no tenía
      // ChannelSettings.ReadWrite.All. Ya se concedió ese permiso (aplicación,
      // con consentimiento de admin), así que ya no hace falta el intermediario.
      const createRes = await graphFetch(`https://graph.microsoft.com/v1.0/teams/${input.teamId}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: input.channelName,
          description: project.tematica ?? '',
          membershipType: 'standard',
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`No se pudo crear el canal en Teams (${createRes.status}): ${err}`);
      }

      const channel = await createRes.json() as { id: string; webUrl?: string };
      if (!channel.webUrl) throw new Error('Graph no devolvió una URL para el canal creado');
      channelUrl = channel.webUrl;

      createChannelFolders(input.teamId, channel.id).catch(e =>
        console.log('createChannelFolders error:', e)
      );
    } else {
      if (!input.channelUrl) throw new Error('channelUrl is required for link mode');
      channelUrl = input.channelUrl;
    }

    await Projects.update({
      id: project.id,
      record: { teamsChannelStatus: 'Listo', teamsChannelUrl: channelUrl },
    });

    return { success: true, channelUrl };
  },
});
