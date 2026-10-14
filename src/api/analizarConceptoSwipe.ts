import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { createEndpoint, ZiteError } from '../../server/compat';
import { LecturaConceptoError, leerConcepto } from '../serverUtils/swipe/leerConcepto';

/**
 * Lee con IA la imagen de un concepto (una lámina, una captura o solo el dibujo): título, descripción como tuit y
 * dónde está la ilustración. No guarda nada; la pantalla recorta la ilustración, la sube y crea la idea.
 * La imagen llega ya reducida y en JPEG desde el navegador (src/lib/swipe/imagenes.ts).
 */
export default createEndpoint({
  authenticated: true,
  description: 'Lee la imagen de un concepto de Swipe con IA: título, descripción (tweet concept) y caja de la ilustración',
  inputSchema: z.object({
    /** Base64 sin el prefijo data:. Tope de la API de Claude: 5 MB de imagen. */
    imagen: z.string().min(100).max(7_000_000),
    tipo: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    /** Tamaño en píxeles de la imagen que se manda: la IA da la caja en esos píxeles. */
    ancho: z.number().int().min(1).max(8000),
    alto: z.number().int().min(1).max(8000),
  }),
  outputSchema: z.object({
    titulo: z.string(),
    descripcion: z.string(),
    textoEnImagen: z.boolean(),
    /** Fracciones (0 a 1) del ancho y del alto; ausente si la imagen no tiene ilustración (solo texto). */
    ilustracion: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  }),
  execute: async ({ input }) => {
    try {
      const { ilustracion, ...resto } = await leerConcepto(input);
      return ilustracion ? { ...resto, ilustracion } : resto;
    } catch (err) {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: mensajeDeFalla(err) });
    }
  },
});

/** Qué se le dice a la persona cuando la lectura falla: la causa en palabras llanas. El detalle técnico queda en el log. */
function mensajeDeFalla(err: unknown): string {
  console.error('[analizarConceptoSwipe]', err instanceof Error ? err.message : err);
  if (err instanceof LecturaConceptoError) {
    if (err.motivo === 'SIN_CLAVE') return 'La lectura con IA no está configurada en el servidor.';
    if (err.motivo === 'RECHAZADA') return 'La IA no quiso leer esta imagen.';
    return 'La IA no pudo leer esta imagen.';
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'La IA tardó demasiado en contestar.';
  if (err instanceof Anthropic.RateLimitError) return 'La IA está saturada en este momento.';
  if (err instanceof Anthropic.BadRequestError) return 'La IA no pudo abrir esta imagen.';
  return 'No se pudo consultar a la IA.';
}
