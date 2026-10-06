export interface ArchivedFile {
  id: string;
  projectId?: string;
  projectCode?: string;
  projectName?: string;
  projectFolder: string;
  fileName: string;
  sharepointPath: string;
  sizeBytes: number;
  contentType?: string;
  originalModifiedAt?: string;
  archivedAt: string;
  estado: string;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function mediaKind(f: { fileName: string; contentType?: string }): 'video' | 'audio' | 'other' {
  const ct = f.contentType ?? '';
  const ext = f.fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ct.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'aac', 'ogg'].includes(ext)) return 'audio';
  if (ct.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm'].includes(ext)) return 'video';
  return 'other';
}

/** Carpeta del archivo en SharePoint: "INSANITY/GRABACIONES/SESIONES/x.mp4" → "INSANITY/GRABACIONES/SESIONES". */
export const dirPath = (f: { sharepointPath: string }) => f.sharepointPath.split('/').slice(0, -1).join('/');

/** Carpeta para mostrar, sin el proyecto: "INSANITY/GRABACIONES/SESIONES" → "GRABACIONES / SESIONES". */
export function displayFolder(dir: string): string {
  const parts = dir.split('/').slice(1);
  return parts.length ? parts.join(' / ') : '(raíz)';
}

/** Agrupa preservando el orden de llegada (el endpoint ya ordena por ruta). */
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = map.get(k);
    if (arr) arr.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()];
}

export const archivoLink = (id: string) => `${window.location.origin}/archivo/${id}`;
