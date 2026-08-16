import { z } from 'zod';
import { createEndpoint, Projects } from '../../server/compat';
import { graphFetch } from '../../server/microsoft/graph';

// El link de Teams ya trae todo lo que Graph necesita — no hace falta guardar
// teamId/channelId aparte en Projects. Formato real (confirmado en vivo):
//   https://teams.microsoft.com/l/channel/{channelId}/{nombre}?groupId={teamId}&tenantId=...
// channelId va URL-encoded en el path (":" -> "%3A", "@" -> "%40").
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

interface DriveItem {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
}

async function listChildren(driveId: string, itemId: string): Promise<DriveItem[]> {
  const res = await graphFetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/children?$top=200`);
  if (!res.ok) throw new Error(`Graph respondió ${res.status} listando children de ${itemId}`);
  const body = await res.json();
  return body.value ?? [];
}

const FileOut = z.object({
  id: z.string(),
  name: z.string(),
  webUrl: z.string(),
  directUrl: z.string().optional(),
  modifiedAt: z.string().optional(),
  modifiedBy: z.string().optional(),
  size: z.number().optional(),
});

export default createEndpoint({
  authenticated: true,
  description: "Lists the files inside a project's Teams channel folders, read live from Microsoft Graph (no local copy)",
  inputSchema: z.object({ projectCode: z.string() }),
  outputSchema: z.object({
    linked: z.boolean(),
    driveId: z.string().optional(),
    folders: z.array(z.object({ name: z.string(), files: z.array(FileOut) })),
    looseFiles: z.array(FileOut),
    error: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const project = await Projects.findOne({ filters: { projectCode: input.projectCode } });
    const url = project?.teamsChannelUrl as string | undefined;
    if (!project || project.teamsChannelStatus !== 'Listo' || !url) {
      return { linked: false, folders: [], looseFiles: [] };
    }

    const parsed = parseChannelUrl(url);
    if (!parsed) return { linked: true, folders: [], looseFiles: [], error: 'No se pudo interpretar el link del canal de Teams' };

    try {
      const rootRes = await graphFetch(
        `https://graph.microsoft.com/v1.0/teams/${parsed.teamId}/channels/${parsed.channelId}/filesFolder`,
      );
      if (!rootRes.ok) throw new Error(`Graph respondió ${rootRes.status} obteniendo la carpeta del canal`);
      const root: DriveItem = await rootRes.json();
      const driveId = root.parentReference?.driveId;
      if (!driveId) throw new Error('La carpeta del canal no trae driveId');

      const topLevel = await listChildren(driveId, root.id);

      // El webUrl que Graph da por archivo a veces es la ruta directa en
      // SharePoint y a veces el visor Doc.aspx (?sourcedoc=...&action=edit)
      // — depende de si el archivo tiene sesión de coautoría reciente. Ese
      // visor funciona bien en el navegador, pero la app de escritorio
      // (ms-word/ms-powerpoint/ms-excel:ofe|u|...) no lo resuelve: llega el
      // link completo (ya no se corta, ver fix anterior) pero PowerPoint
      // responde "no pudo leer" esa URL — confirmado en vivo con un .pptx
      // real. root.webUrl (la carpeta del canal, ej. ".../Shared Documents/
      // TRIGO") sí es siempre la ruta directa, así que se arma la ruta del
      // archivo a mano a partir de ahí para tener un link que la app de
      // escritorio sí entienda, sin tocar el webUrl que ya funciona bien
      // para abrir en el navegador.
      const toFileOut = (it: DriveItem, folderName?: string): z.infer<typeof FileOut> => ({
        id: it.id,
        name: it.name,
        webUrl: it.webUrl,
        directUrl: `${root.webUrl}/${folderName ? `${encodeURIComponent(folderName)}/` : ''}${encodeURIComponent(it.name)}`,
        modifiedAt: it.lastModifiedDateTime,
        modifiedBy: it.lastModifiedBy?.user?.displayName,
        size: it.size,
      });

      const looseFiles = topLevel.filter((it) => !it.folder).map((it) => toFileOut(it));
      const subfolders = topLevel.filter((it) => it.folder);

      // Un solo nivel de subcarpetas (PROPUESTA, ENTREGABLES, etc.) — si alguna
      // trae a su vez sub-subcarpetas, sus archivos no se listan aquí (recorte
      // deliberado: la estructura real de los canales no baja más de un nivel).
      const folders = await Promise.all(
        subfolders.map(async (f) => {
          const children = await listChildren(driveId, f.id);
          return { name: f.name, files: children.filter((it) => !it.folder).map((it) => toFileOut(it, f.name)) };
        }),
      );

      folders.sort((a, b) => a.name.localeCompare(b.name));
      for (const f of folders) f.files.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''));
      looseFiles.sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''));

      return { linked: true, driveId, folders, looseFiles };
    } catch (e) {
      return { linked: true, folders: [], looseFiles: [], error: e instanceof Error ? e.message : 'Error consultando Microsoft Graph' };
    }
  },
});
