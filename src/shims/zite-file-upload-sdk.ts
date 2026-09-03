// Reemplazo de 'zite-file-upload-sdk'. Único export usado: uploadFile (15 archivos).
//
// Sube a Supabase Storage vía /api/upload (server/upload.ts) — ruta dedicada
// que maneja multipart/form-data, aparte del dispatcher JSON genérico.
// En modo simulado devuelve una URL local para poder ver la interfaz.

import { BASE } from './zite-endpoints-sdk';
import { supabase } from '@/lib/supabaseClient';

export interface UploadResult { fileUrl: string; name: string; size: number; mimeType?: string }

export async function uploadFile(
  { data, filename, folder, token, password, preworkToken }: {
    data: File; filename: string; folder?: string; token?: string; password?: string; preworkToken?: string;
  },
): Promise<UploadResult> {
  if (import.meta.env.VITE_MOCK_USER === 'true') {
    return { fileUrl: URL.createObjectURL(data), name: filename, size: data.size, mimeType: data.type };
  }

  const form = new FormData();
  form.append('file', data, filename);
  if (folder) form.append('folder', folder);

  const headers: Record<string, string> = {};
  if (preworkToken) {
    // Portal de participante de Prework: público por token de sesión propio.
    form.append('preworkToken', preworkToken);
  } else if (token) {
    // Portal de proveedores: público por token+password, no por sesión.
    form.append('token', token);
    if (password) form.append('password', password);
  } else {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) headers.Authorization = `Bearer ${sessionData.session.access_token}`;
  }

  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers, credentials: 'include', body: form });
  if (!res.ok) {
    let body: any = {};
    try { body = await res.json(); } catch { /* respuesta no JSON */ }
    throw new Error(body?.message ?? `Falló la subida de ${filename} (${res.status})`);
  }
  return res.json();
}
