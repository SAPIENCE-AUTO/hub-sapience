import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getSupabaseAdmin } from './supabaseAdmin';
import { resolveAuth } from './auth';
import { Suppliers } from './compat';
import { verifySessionToken } from './preworkAuth';

/**
 * POST /api/upload — ruta dedicada, NO pasa por el dispatcher genérico de
 * server/index.ts (que solo entiende JSON vía c.req.json()). multipart/
 * form-data necesita su propio parseo, así que vive aparte y se monta antes
 * del dispatcher genérico en index.ts.
 *
 * Guarda en Supabase Storage con el service_role key (server/supabaseAdmin.ts,
 * ya usado por inviteUsers.ts) y devuelve { fileUrl, name, size, mimeType } —
 * la forma que espera uploadFile() en src/shims/zite-file-upload-sdk.ts.
 */

// Mismo límite que ya tienen los buckets zite-uploads/purchase-orders
// (ver server/scripts/migrate-zite-uploads.mjs y migrate-monday-po-pdfs.mjs,
// ambos creados con fileSizeLimit: '50MB') — no se inventa un número nuevo.
const MAX_SIZE = 50 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/xml', 'text/xml',
  'text/plain',
  // Prework: video/nota de voz de participantes (foto ya cubierta arriba).
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg',
]);

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_').slice(-150) || 'archivo';
}

/**
 * `purchase-orders` y `zite-uploads` ya existen (migrados desde Zite/Monday —
 * ver los scripts de arriba). Los adjuntos ad-hoc de PoAttachmentsSection van
 * a `purchase-orders/attachments/`, separados de los PDFs migrados que viven
 * en la raíz del bucket como `${po.id}.pdf` — para no chocar con esos paths.
 * Todo lo demás va a `zite-uploads/<folder o "misc">/`.
 */
function bucketAndPathFor(folder: string | undefined, filename: string): { bucket: string; path: string } {
  const safe = sanitizeFilename(filename);
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  if (folder === 'purchase-orders') return { bucket: 'purchase-orders', path: `attachments/${unique}` };
  return { bucket: 'zite-uploads', path: `${folder || 'misc'}/${unique}` };
}

export const uploadApp = new Hono();

uploadApp.post(
  '/upload',
  bodyLimit({
    maxSize: MAX_SIZE,
    onError: (c) => c.json({ message: `El archivo supera el límite de ${MAX_SIZE / (1024 * 1024)}MB` }, 413),
  }),
  async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ message: 'No se pudo leer el archivo enviado' }, 400);
    }

    const file = body.file;
    if (!(file instanceof File)) {
      return c.json({ message: 'Falta el archivo' }, 400);
    }
    const folder = typeof body.folder === 'string' ? body.folder : undefined;

    // ── Auth: sesión normal, portal de proveedores (token+password), o
    // portal de participante de Prework (preworkToken) — tres orígenes
    // posibles para un archivo, cada uno con su propio criterio de acceso.
    const portalToken = typeof body.token === 'string' ? body.token : undefined;
    const portalPassword = typeof body.password === 'string' ? body.password : undefined;
    const preworkToken = typeof body.preworkToken === 'string' ? body.preworkToken : undefined;

    if (preworkToken) {
      if (!verifySessionToken(preworkToken)) {
        return c.json({ message: 'Sesión de Prework inválida o expirada' }, 401);
      }
    } else if (portalToken) {
      const supplier = await Suppliers.findOne({ filters: { accessToken: portalToken } });
      if (!supplier || supplier.portalPassword !== portalPassword) {
        return c.json({ message: 'Token o clave de acceso inválidos' }, 401);
      }
    } else {
      const resolved = await resolveAuth(c.req.header('Authorization'));
      if (!resolved.user) {
        return c.json({ message: 'Sesión requerida' }, 401);
      }
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return c.json({ message: `Tipo de archivo no permitido: ${file.type || 'desconocido'}` }, 400);
    }
    if (file.size > MAX_SIZE) {
      return c.json({ message: `El archivo supera el límite de ${MAX_SIZE / (1024 * 1024)}MB` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { bucket, path } = bucketAndPathFor(folder, file.name);

    const admin = getSupabaseAdmin();
    const { error: upErr } = await admin.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (upErr) {
      console.error('[upload] Falló la subida a Supabase Storage', { bucket, path, error: upErr.message });
      return c.json({ message: 'No se pudo subir el archivo' }, 500);
    }

    const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);
    return c.json({ fileUrl: pub.publicUrl, name: file.name, size: file.size, mimeType: file.type });
  },
);
