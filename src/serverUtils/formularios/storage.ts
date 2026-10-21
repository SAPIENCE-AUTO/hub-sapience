import { getSupabaseAdmin } from '../../../server/supabaseAdmin';
import type { FotoSubida, Respuestas } from '../../lib/formularios/tipos';

// Las fotos de los participantes son de su casa: bucket PRIVADO, se ven solo con URL firmada desde el panel.
export const BUCKET = process.env.FORMULARIOS_BUCKET ?? 'formularios';

export async function subirFoto(ruta: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(ruta, data, { contentType, upsert: false });
  if (error) throw new Error(`No se pudo guardar la foto: ${error.message}`);
}

/** Todas las fotos de una respuesta, con su URL firmada (10 min). */
export async function fotosFirmadas(respuestas: Respuestas): Promise<Record<string, string>> {
  const rutas = rutasDeFotos(respuestas);
  if (rutas.length === 0) return {};
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrls(rutas, 600);
  if (error || !data) return {};
  return Object.fromEntries(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

export async function borrarFotos(rutas: string[]): Promise<void> {
  if (rutas.length === 0) return;
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(rutas);
  if (error) console.error('[formularios] no se pudieron borrar fotos de Storage', { total: rutas.length, error: error.message });
}

export function rutasDeFotos(respuestas: Respuestas): string[] {
  return Object.values(respuestas)
    .filter((v): v is FotoSubida[] => Array.isArray(v) && v.some((x) => typeof x === 'object' && x !== null && 'ruta' in x))
    .flat()
    .map((f) => f.ruta);
}
