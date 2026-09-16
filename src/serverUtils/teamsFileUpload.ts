import { graphFetch } from '../../server/microsoft/graph';

// El link de Teams ya trae todo lo que Graph necesita para resolver drive/carpeta —
// mismo parseo que ya usa getProjectTeamsFiles.ts (formato confirmado en vivo):
//   https://teams.microsoft.com/l/channel/{channelId}/{nombre}?groupId={teamId}&tenantId=...
function parseChannelUrl(url: string): { teamId: string; channelId: string } | null {
  try {
    const u = new URL(url);
    const teamId = u.searchParams.get('groupId');
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('channel');
    const channelId = idx >= 0 ? decodeURIComponent(parts[idx + 1] ?? '') : null;
    if (!teamId || !channelId) return null;
    return { teamId, channelId };
  } catch {
    return null;
  }
}

/** Sube un archivo a una carpeta del canal de Teams del proyecto (misma carpeta que ya
 * crea createTeamsChannel.ts) y devuelve el webUrl. Crea la carpeta si no existe — canales
 * creados antes de que esa carpeta estuviera en FOLDER_NAMES no la tendrían.
 * Compartido entre Calendario (carpeta CALENDARIOS) y Timeline (carpeta TIMELINE) — antes
 * cada uno tenía su propia copia de esta lógica dentro de su propio endpoint. */
export async function uploadFileToTeamsChannel(
  channelUrl: string,
  folderName: string,
  filename: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const parsed = parseChannelUrl(channelUrl);
  if (!parsed) throw new Error('No se pudo interpretar el link del canal de Teams');

  const folderRes = await graphFetch(`https://graph.microsoft.com/v1.0/teams/${parsed.teamId}/channels/${parsed.channelId}/filesFolder`);
  if (!folderRes.ok) throw new Error(`Graph respondió ${folderRes.status} obteniendo la carpeta del canal`);
  const root = await folderRes.json() as { id: string; parentReference?: { driveId?: string } };
  const driveId = root.parentReference?.driveId;
  if (!driveId) throw new Error('La carpeta del canal no trae driveId');

  const childrenRes = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children?$top=200`);
  if (!childrenRes.ok) throw new Error(`Graph respondió ${childrenRes.status} listando las carpetas del canal`);
  const children = (await childrenRes.json()).value as Array<{ id: string; name: string; folder?: unknown }>;
  let folderId = children.find(c => c.folder && c.name === folderName)?.id;

  if (!folderId) {
    const createRes = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${root.id}/children`, {
      method: 'POST',
      body: JSON.stringify({ name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    });
    if (!createRes.ok) throw new Error(`No se pudo crear la carpeta ${folderName} (${createRes.status})`);
    folderId = (await createRes.json() as { id: string }).id;
  }

  const safeName = encodeURIComponent(filename);
  const uploadRes = await graphFetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${safeName}:/content`,
    {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: buffer,
    },
  );
  if (!uploadRes.ok) throw new Error(`Graph respondió ${uploadRes.status} subiendo el archivo`);
  const uploaded = await uploadRes.json() as { webUrl?: string };
  if (!uploaded.webUrl) throw new Error('Graph no devolvió una URL para el archivo subido');
  return uploaded.webUrl;
}
