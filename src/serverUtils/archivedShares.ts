import { pool } from '../../server/compat';
import { archiveBlobSasUrl, uploadArchiveBlob } from '../../server/azure/blobSas';

// Alcances de los links de cliente del archivo de grabaciones
// (archived_file_shares): un video, o todo lo archivado bajo una ruta de
// SharePoint (carpeta o proyecto). Compartido por create/get/getShared*.

export type ShareScope = 'file' | 'folder' | 'project';

export interface ScopedFile {
  id: string;
  fileName: string;
  sharepointPath: string;
  blobName: string;
  sizeBytes: number;
  contentType?: string;
  originalModifiedAt?: string;
}

/**
 * Archivos dentro de un alcance. Por prefijo se compara con left() en vez de
 * LIKE para no tener que escapar % y _ en nombres de carpeta.
 */
export async function filesInScope(scope: { archivedFileId?: string | null; pathPrefix?: string | null }): Promise<ScopedFile[]> {
  const r = scope.archivedFileId
    ? await pool.query(
        `select id, file_name, sharepoint_path, blob_name, size_bytes::float8 as size_bytes, content_type, original_modified_at
           from archived_files where id = $1`,
        [scope.archivedFileId],
      )
    : await pool.query(
        `select id, file_name, sharepoint_path, blob_name, size_bytes::float8 as size_bytes, content_type, original_modified_at
           from archived_files
          where left(sharepoint_path, length($1) + 1) = $1 || '/'
          order by sharepoint_path`,
        [scope.pathPrefix],
      );
  return r.rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    sharepointPath: row.sharepoint_path,
    blobName: row.blob_name,
    sizeBytes: row.size_bytes,
    contentType: row.content_type ?? undefined,
    originalModifiedAt: row.original_modified_at ?? undefined,
  }));
}

/** "AGOSTO/GRABACIONES/SESIONES" → "SESIONES"; para un video, su nombre. */
export function scopeLabel(scope: ShareScope, pathPrefix: string | null, fileName?: string): string {
  if (scope === 'file') return fileName ?? '';
  return pathPrefix!.split('/').pop()!;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LOGO_URL = 'https://qmqtjfhifzxvnhiyifyh.supabase.co/storage/v1/object/public/publico/logo%20sapience%20blanco%2015%20ene%2026.png';

/**
 * Link directo de carpeta/proyecto: un SAS solo cubre un blob (la cuenta no
 * tiene espacio de nombres jerárquico), así que se genera una página índice
 * estática con un SAS por video, se sube a Blob y se comparte el SAS de esa
 * página. Todo vive en blob.core.windows.net. Es una foto fija: lo que se
 * archive después no aparece. Devuelve el link a la página.
 */
export async function publishDirectIndex(opts: {
  token: string;
  title: string;
  pathPrefix: string;
  files: ScopedFile[];
  days: number;
  allowDownload: boolean;
}): Promise<string> {
  const minutes = opts.days * 24 * 60;
  const expires = new Date(Date.now() + minutes * 60_000).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City',
  });

  const groups = new Map<string, ScopedFile[]>();
  for (const f of opts.files) {
    const rel = f.sharepointPath.slice(opts.pathPrefix.length + 1).split('/').slice(0, -1).join(' / ') || opts.title;
    if (!groups.has(rel)) groups.set(rel, []);
    groups.get(rel)!.push(f);
  }

  const sections = [...groups.entries()].map(([folder, files]) => `
    <h2>${esc(folder)}</h2>
    <ul>${files.map((f) => {
      const play = archiveBlobSasUrl(f.blobName, { minutes });
      const dl = opts.allowDownload ? archiveBlobSasUrl(f.blobName, { minutes, downloadName: f.fileName }) : null;
      return `<li><a href="${esc(play)}" target="_blank" rel="noopener">${esc(f.fileName)}</a>${
        dl ? ` <a class="dl" href="${esc(dl)}">Descargar</a>` : ''}</li>`;
    }).join('')}</ul>`).join('');

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(opts.title)} · Sapience</title>
<style>
  body{margin:0;background:#000;color:#fff;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
  header{padding:16px 24px;border-bottom:1px solid #222} header img{height:28px}
  main{max-width:880px;margin:0 auto;padding:24px 16px}
  h1{font-size:18px;margin:0 0 4px} .meta{color:#999;font-size:12px;margin-bottom:16px}
  h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#aaa;margin:24px 0 8px}
  ul{list-style:none;padding:0;margin:0} li{padding:8px 12px;border:1px solid #222;border-radius:6px;margin-bottom:6px;word-break:break-word}
  a{color:#fff} a.dl{color:#aaa;font-size:12px;margin-left:8px}
  footer{color:#666;font-size:11px;text-align:center;padding:24px}
</style></head><body>
<header><img src="${LOGO_URL}" alt="Sapience"></header>
<main><h1>${esc(opts.title)}</h1><div class="meta">${opts.files.length} archivos · disponible hasta el ${esc(expires)}</div>${sections}</main>
<footer>Material confidencial compartido por Sapience. No lo reenvíes.</footer>
</body></html>`;

  const blobName = `_compartidos/${opts.token}.html`;
  await uploadArchiveBlob(blobName, html, 'text/html; charset=utf-8');
  return archiveBlobSasUrl(blobName, { minutes });
}
