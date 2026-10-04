import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';

export const BUCKET = process.env.PROPUESTAS_BUCKET ?? 'propuestas';

// Nombre seguro para una ruta de Storage: sin acentos ni caracteres raros.
export function nombreSeguro(nombre: string): string {
  const limpio = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return limpio.slice(-80) || 'archivo';
}

export async function subirArchivo(ruta: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(ruta, data, { contentType, upsert: true });
  if (error) throw new Error(`No se pudo subir a Storage: ${error.message}`);
}

export async function descargarArchivo(ruta: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(ruta);
  if (error || !data) throw new Error(`No se pudo descargar de Storage (${ruta}): ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function urlFirmada(ruta: string, segundos = 3600, descargarComo?: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(ruta, segundos, descargarComo ? { download: descargarComo } : undefined);
  if (error || !data) throw new Error(`No se pudo firmar la URL: ${error?.message}`);
  return data.signedUrl;
}

// Descarga cada ruta de Storage a /tmp/<propuesta_id>/ y devuelve
// { rutaStorage: rutaTemporal } — lo que construirPropuesta espera como `archivos`.
export async function descargarATmp(propuestaId: string, rutas: string[]): Promise<{ archivos: Record<string, string>; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `propuesta-${propuestaId}-`));
  const archivos: Record<string, string> = {};
  for (const [i, ruta] of rutas.entries()) {
    const destino = path.join(dir, `${i}_${nombreSeguro(path.basename(ruta))}`);
    fs.writeFileSync(destino, await descargarArchivo(ruta));
    archivos[ruta] = destino;
  }
  return { archivos, dir };
}
