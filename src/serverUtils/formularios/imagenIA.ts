import OpenAI from 'openai';
import { ZiteError } from '../../../server/compat';
import type { Gasto } from './claude';

/**
 * Imágenes de las opciones de un filtro hechas con IA (pedido de Sergio,
 * 2026-10-26): con una descripción breve sale una imagen genérica, lista para
 * subir como cualquier otra. Con la cuenta de OpenAI que ya tiene el Hub (la
 * de Anthropic no hace imágenes). Sin marcas ni texto: para un logo o un
 * empaque real se sube la imagen real.
 */
export const MODELO_IMAGEN = process.env.FORMULARIOS_MODELO_IMAGEN || 'gpt-image-2';

const instrucciones = (pedido: string) => [
  `Imagen para una opción de un cuestionario que se contesta en el celular: ${pedido}.`,
  'Un solo objeto o escena, claro y reconocible a tamaño pequeño, centrado, sobre fondo blanco liso.',
  'Fotografía de producto o ilustración sencilla y realista. Sin texto, sin letras, sin logotipos ni marcas reales.',
].join(' ');

export async function crearImagen(pedido: string, onGasto?: (g: Gasto) => void): Promise<{ base64: string; tipo: string }> {
  if (!process.env.ZITE_OPENAI_ACCESS_TOKEN) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'El Hub no tiene la llave de OpenAI para hacer imágenes.' });
  const cliente = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN, timeout: 90_000, maxRetries: 1 });
  try {
    const r = await cliente.images.generate({ model: MODELO_IMAGEN, prompt: instrucciones(pedido), size: '1024x1024', quality: 'low', n: 1 });
    const base64 = r.data?.[0]?.b64_json;
    if (!base64) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La IA no devolvió la imagen. Vuelve a intentar.' });
    onGasto?.({ modelo: MODELO_IMAGEN, entrada: r.usage?.input_tokens ?? 0, cacheLeidos: 0, cacheEscritos: 0, salida: r.usage?.output_tokens ?? 0 });
    return { base64, tipo: 'image/png' };
  } catch (err) {
    if (err instanceof ZiteError) throw err;
    const e = err as { status?: number; code?: string; message?: string };
    if (e.code === 'moderation_blocked' || /safety|moderation/i.test(e.message ?? '')) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'La IA no quiso hacer esa imagen. Cambia la descripción.' });
    }
    if (e.status === 429 || e.code === 'insufficient_quota' || e.code === 'billing_hard_limit_reached') {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La cuenta de OpenAI del Hub no tiene saldo o está saturada. Intenta en un rato.' });
    }
    if (/timeout|timed out/i.test(e.message ?? '')) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La IA tardó demasiado en hacer la imagen. Vuelve a intentar.' });
    console.error('[filtros] no se pudo crear la imagen', e.status, e.code, e.message);
    throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'No se pudo crear la imagen. Vuelve a intentar.' });
  }
}
