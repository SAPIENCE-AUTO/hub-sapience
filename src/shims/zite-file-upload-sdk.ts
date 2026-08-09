// Reemplazo de 'zite-file-upload-sdk'. Único export usado: uploadFile (15 archivos).
//
// Destino natural: Supabase Storage. Por ahora sube al backend, que decide dónde
// guardar. En modo simulado devuelve una URL local para poder ver la interfaz.

import { BASE } from './zite-endpoints-sdk';

export interface UploadResult { url: string; name: string; size: number; mimeType?: string }

export async function uploadFile(file: File, options?: { folder?: string }): Promise<UploadResult> {
  if (import.meta.env.VITE_MOCK_USER === 'true') {
    return { url: URL.createObjectURL(file), name: file.name, size: file.size, mimeType: file.type };
  }
  const form = new FormData();
  form.append('file', file);
  if (options?.folder) form.append('folder', options.folder);
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form, credentials: 'include' });
  if (!res.ok) throw new Error(`Falló la subida de ${file.name} (${res.status})`);
  return res.json();
}
