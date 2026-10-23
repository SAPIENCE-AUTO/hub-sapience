import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ZiteError } from '../../../server/compat';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';

// Imágenes de los filtros a partir de un enlace de internet (un .png o .jpg): el Hub descarga la imagen
// una vez y guarda su propia copia en la carpeta pública de los filtros, así la opción no depende de que
// esa página la siga teniendo ni el celular del participante va a otra página. Se cuida que el enlace sea
// de internet (no de la red interna del servidor), que sea una imagen y que no pese de más.

const TIPOS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAXIMO = 10 * 1024 * 1024;
const BUCKET = 'zite-uploads';
const CARPETA = 'formularios-imagenes';

/** Direcciones que no son de internet: la propia máquina, la red interna, la nube por dentro. */
function esPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return esPrivada(x.slice(7));
    return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function revisarEnlace(texto: string): Promise<URL> {
  let url: URL;
  try { url = new URL(texto.trim()); } catch { throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese enlace no parece una dirección de internet.' }); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ZiteError({ code: 'BAD_REQUEST', message: 'El enlace tiene que empezar con https://' });
  if (url.port && url.port !== '80' && url.port !== '443') throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese enlace no se puede abrir.' });
  const direcciones = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true }).catch(() => []);
  if (!direcciones.length) throw new ZiteError({ code: 'BAD_REQUEST', message: 'No se encontró la página de ese enlace.' });
  if (direcciones.some((d) => esPrivada(d.address))) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese enlace no se puede abrir.' });
  return url;
}

/** Descarga la imagen (siguiendo hasta 3 redirecciones, revisando cada una). */
export async function descargarImagen(enlace: string): Promise<{ datos: Buffer; tipo: string; nombre: string }> {
  let url = await revisarEnlace(enlace);
  for (let saltos = 0; ; saltos++) {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; HubSapience/1.0; +https://hub.sapience.com.mx)' } })
      .catch(() => { throw new ZiteError({ code: 'BAD_REQUEST', message: 'No se pudo abrir ese enlace.' }); });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (saltos >= 3) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese enlace redirige demasiadas veces.' });
      url = await revisarEnlace(new URL(r.headers.get('location')!, url).toString());
      continue;
    }
    if (!r.ok) throw new ZiteError({ code: 'BAD_REQUEST', message: `Ese enlace no respondió (${r.status}).` });
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.has(tipo)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese enlace no es una imagen (tiene que ser JPG, PNG, WebP o GIF).' });
    if (Number(r.headers.get('content-length') ?? 0) > MAXIMO) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La imagen pesa más de 10 MB.' });
    const partes: Buffer[] = [];
    let total = 0;
    for await (const parte of r.body as unknown as AsyncIterable<Uint8Array>) {
      total += parte.length;
      if (total > MAXIMO) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La imagen pesa más de 10 MB.' });
      partes.push(Buffer.from(parte));
    }
    const nombre = decodeURIComponent(url.pathname.split('/').pop() || 'imagen').replace(/[^\w.-]+/g, '-').slice(-80) || 'imagen';
    return { datos: Buffer.concat(partes), tipo, nombre };
  }
}

/** Guarda una copia en la carpeta pública de los filtros y regresa su dirección. */
export async function guardarCopiaDeImagen(img: { datos: Buffer; tipo: string; nombre: string }): Promise<string> {
  const admin = getSupabaseAdmin();
  const ruta = `${CARPETA}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${img.nombre}`;
  const { error } = await admin.storage.from(BUCKET).upload(ruta, img.datos, { contentType: img.tipo, upsert: false });
  if (error) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo guardar la imagen.' });
  return admin.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
}

/** Si la imagen ya es nuestra (subida al Hub o dibujada en el filtro), no hay que copiarla. */
export function esImagenNuestra(direccion: string): boolean {
  if (direccion.startsWith('data:image/')) return true;
  const base = process.env.SUPABASE_URL;
  return !!base && direccion.startsWith(`${base.replace(/\/$/, '')}/storage/v1/object/public/`);
}
