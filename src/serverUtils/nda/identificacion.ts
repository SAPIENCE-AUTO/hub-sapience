// Comprobar a quien firmó el NDA contra la identificación que subió en «Antes de empezar» de un filtro del Hub (guía: docs/nda.md). Dos cosas, las dos solo de apoyo para que una persona
// del equipo decida (nunca descartan, rechazan ni cambian nada):
//  1) el nombre con que firmó contra el nombre que la IA ya leyó de la identificación (no llama a la IA otra vez);
//  2) a pedido (botón en el detalle del NDA), la firma dibujada en el NDA contra la firma que se ve en la foto de la identificación, con la IA: «parecidas», «distintas» o «no concluyente»
//     y una frase. La IA no es perito caligráfico y una firma con el dedo casi nunca se parece a la de una credencial, así que es una opinión orientativa, no una prueba.
// Nada se guarda: cada comparación se calcula al momento (cuesta menos de un centavo de dólar) y solo la ve quien la pide. Sin identificación en el Hub (la persona no llegó por un
// filtro del Hub, o no subió la foto) no hay con qué comparar y se dice por qué.
import sharp from 'sharp';
import { z } from 'zod';
import { ZiteError, pool } from '../../../server/compat';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';
import { ID_FOTO_IDENTIFICACION } from '../../lib/formularios/inicio';
import { llamarConImagen, MODELOS } from '../formularios/claude';
import { nombreCoincide } from '../formularios/identificacion';
import { BUCKET } from '../formularios/storage';

export type VeredictoFirma = 'parecidas' | 'distintas' | 'no_concluyente';

const ComparacionZ = z.object({
  firmaEnIdentificacion: z.boolean().default(false),
  caja: z.array(z.number()).length(4).nullish(),
  veredicto: z.enum(['parecidas', 'distintas', 'no_concluyente']).default('no_concluyente'),
  comentario: z.string().default(''),
});
export type ComparacionIA = z.infer<typeof ComparacionZ>;

export interface ComprobacionIdentificacion {
  /** false cuando no hay con qué comparar (todavía no firma, no llegó por un filtro del Hub, no subió identificación). */
  disponible: boolean;
  motivo?: string;
  nombreFirmado?: string;
  /** El nombre que la IA leyó de la identificación cuando la persona la subió. */
  nombreIdentificacion?: string;
  nombre?: 'coincide' | 'distinto' | 'sin-dato';
  /** Solo si se pidió comparar la firma. Las imágenes van como «data:…;base64,…» (la firma del NDA y el recorte de la firma de la identificación, si se pudo recortar). */
  firma?: { veredicto: VeredictoFirma; comentario: string; firmaNda: string; firmaIdentificacion?: string };
}

/** Lo que toca el mundo de afuera (Storage y la IA): las pruebas lo cambian por uno falso. */
export interface DepsIdentificacion {
  iaDisponible(): boolean;
  descargarFoto(ruta: string): Promise<Buffer>;
  comparar(args: { firma: Buffer; identificacion: Buffer }): Promise<ComparacionIA>;
}

const SISTEMA = `Eres un apoyo para el equipo de una agencia de investigación de mercados. Recibes dos imágenes: la primera es una firma dibujada con el dedo en la pantalla de un celular; la segunda es la foto de una identificación oficial mexicana (INE, pasaporte, licencia), donde aparece, si se ve, la firma impresa de su titular.
No eres perito caligráfico y esto no es una prueba de identidad: das una opinión orientativa sobre qué tanto se parecen en rasgos generales (forma de las letras o del trazo, si empieza con la misma inicial, trazos largos o cortos, inclinación, proporciones, rúbrica).
Una firma con el dedo y una firma con pluma impresa en una credencial casi siempre se ven distintas aunque sean de la misma persona: no las castigues por el instrumento, el tamaño ni la calidad de la foto. Responde «no_concluyente» si la firma de la identificación no se alcanza a ver, está cortada, borrosa o es muy pequeña, o si la del celular es un garabato sin rasgos que se puedan comparar. Usa «distintas» solo cuando los rasgos se vean claramente diferentes y no se explique por el instrumento. En caso de duda, «no_concluyente». Nunca afirmes que sea o no sea la misma persona.
Responde solo con el JSON pedido.`;

const TEXTO = `Compara la firma de la primera imagen con la firma impresa en la identificación de la segunda. Responde solo con este JSON:
{"firmaEnIdentificacion": true|false (si se ve una firma impresa en la identificación), "caja": [x0, y0, x1, y1] | null (el rectángulo que rodea SOLO la firma de la identificación en la segunda imagen: esquina superior izquierda y esquina inferior derecha, como fracción del ancho y del alto de la segunda imagen, números entre 0 y 1; null si no se ve), "veredicto": "parecidas" | "distintas" | "no_concluyente", "comentario": "una o dos oraciones en español sobre los rasgos que ves, sin escribir el nombre que se lea en la firma y sin afirmar que sea o no la misma persona"}`;

export const depsIdentificacion: DepsIdentificacion = {
  iaDisponible: () => !!process.env.ANTHROPIC_API_KEY,
  async descargarFoto(ruta) {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(ruta);
    if (error || !data) throw new Error(`No se pudo leer la foto: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  },
  comparar: ({ firma, identificacion }) => llamarConImagen({
    sistema: SISTEMA, texto: TEXTO,
    imagenes: [{ datos: firma, tipo: 'image/png' }, { datos: identificacion, tipo: 'image/jpeg' }],
    esquema: ComparacionZ, modelo: MODELOS.cambios, esfuerzo: 'low',
  }),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// El mismo prefijo con que formularios/reclutamiento.ts (origenRespuesta) marca de qué respuesta viene cada fila: «Formulario Hub · título|id de la respuesta». Una prueba cuida que no se desfasen.
const PREFIJO_ORIGEN = 'Formulario Hub · ';

/**
 * El rectángulo de la firma que contestó la IA, ya como fracciones del ancho y del alto (0 a 1), o null si no sirve: no es de 4 números, es demasiado chico para ser una firma
 * o ocupa casi toda la foto (no la ubicó). Si la IA contesta en píxeles de la imagen que se le dio (valores mayores a 1) se pasan a fracciones con el tamaño real.
 */
export function cajaValida(caja: number[] | null | undefined, ancho: number, alto: number): [number, number, number, number] | null {
  if (!caja || caja.length !== 4 || caja.some((n) => !Number.isFinite(n)) || ancho <= 0 || alto <= 0) return null;
  const enPixeles = Math.max(...caja) > 1.5;
  const [a, b, c, d] = enPixeles ? [caja[0] / ancho, caja[1] / alto, caja[2] / ancho, caja[3] / alto] : caja;
  const [x0, y0, x1, y1] = [a, b, c, d].map((n) => Math.min(1, Math.max(0, n)));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 0.04 || h < 0.02) return null;
  if (w * h > 0.35) return null;
  return [x0, y0, x1, y1];
}

/** Recorta la firma de la foto con un margen alrededor (la IA marca la caja con algo de error) y la deja de hasta 640 px de ancho. */
async function recortarFirma(foto: Buffer, caja: [number, number, number, number]): Promise<string | undefined> {
  const { width = 0, height = 0 } = await sharp(foto).metadata();
  const [x0, y0, x1, y1] = caja;
  const w = x1 - x0;
  const h = y1 - y0;
  const margenX = Math.max(w * 0.15, 0.015);
  const margenY = Math.max(h * 0.25, 0.015);
  const left = Math.max(0, Math.floor((x0 - margenX) * width));
  const top = Math.max(0, Math.floor((y0 - margenY) * height));
  const right = Math.min(width, Math.ceil((x1 + margenX) * width));
  const bottom = Math.min(height, Math.ceil((y1 + margenY) * height));
  if (right - left < 20 || bottom - top < 10) return undefined;
  const jpg = await sharp(foto).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

const alIA = (mensaje: string) => new ZiteError({ code: 'INTERNAL_ERROR', message: mensaje });

/**
 * Comprueba el envío firmado `envioId`. Sin `conFirma` solo compara el nombre (gratis); con `conFirma` también le pide a la IA comparar las dos firmas.
 * No escribe nada en la base.
 */
export async function comprobarIdentificacion(envioId: string, opciones: { conFirma?: boolean } = {}, deps: DepsIdentificacion = depsIdentificacion): Promise<ComprobacionIdentificacion> {
  const { rows: [e] } = await pool.query<{ estado: string; recruitment_row_id: string | null; nombre_firmado: string | null; firma_png: string | null }>(
    `select estado, recruitment_row_id, nombre_firmado, firma_png from nda_envios where id = $1`, [envioId],
  );
  if (!e) throw new ZiteError({ code: 'NOT_FOUND', message: 'No encontré ese acuerdo.' });
  const nombreFirmado = e.nombre_firmado?.trim() || undefined;
  if (e.estado !== 'firmado') return { disponible: false, motivo: 'Todavía no firma el acuerdo.' };

  const { rows: [fila] } = await pool.query<{ source_form: string | null }>(`select source_form from recruitment_rows where id = $1`, [e.recruitment_row_id]);
  const origen = String(fila?.source_form ?? '');
  const respuestaId = origen.startsWith(PREFIJO_ORIGEN) ? (origen.split('|')[1] ?? '').trim() : '';
  if (!UUID.test(respuestaId)) return { disponible: false, nombreFirmado, motivo: 'No llegó por un filtro del Hub: no hay identificación guardada.' };

  const { rows: [r] } = await pool.query<{ respuestas: Record<string, unknown> | null; resultado: { identificacion?: { nombre?: string } } | null }>(
    `select respuestas, resultado from formulario_respuestas where id = $1`, [respuestaId],
  );
  const foto = ((r?.respuestas?.[ID_FOTO_IDENTIFICACION] as { ruta?: string }[] | undefined) ?? [])[0];
  if (!foto?.ruta) return { disponible: false, nombreFirmado, motivo: 'No subió identificación.' };

  const leido = r?.resultado?.identificacion?.nombre?.trim() || undefined;
  const nombre = !nombreFirmado || !leido ? 'sin-dato' : nombreCoincide(nombreFirmado, leido) ? 'coincide' : 'distinto';
  const base: ComprobacionIdentificacion = { disponible: true, ...(nombreFirmado ? { nombreFirmado } : {}), ...(leido ? { nombreIdentificacion: leido } : {}), nombre };
  if (!opciones.conFirma) return base;

  // La firma, con la IA.
  if (!e.firma_png) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Este acuerdo no tiene la firma guardada.' });
  if (!deps.iaDisponible()) throw new ZiteError({ code: 'BAD_REQUEST', message: 'La IA no está disponible por ahora.' });
  // La firma del NDA es un trazo oscuro sobre fondo transparente: se pone sobre blanco para que la IA lo vea (sobre negro no se distingue).
  const firma = await sharp(Buffer.from(e.firma_png, 'base64')).flatten({ background: '#ffffff' }).png().toBuffer();
  let identificacion: Buffer;
  try {
    // Derecha (según la cámara), de hasta 1600 px y en JPEG, igual que la revisión de la identificación.
    identificacion = await sharp(await deps.descargarFoto(foto.ruta)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch (err) {
    console.error('[nda] no se pudo abrir la foto de la identificación', envioId, (err as Error).message);
    throw alIA('No se pudo abrir la foto de la identificación.');
  }
  let ia: ComparacionIA;
  try {
    ia = await deps.comparar({ firma, identificacion });
  } catch (err) {
    if (err instanceof ZiteError) throw err; // ya trae un mensaje claro (sin saldo, la IA no quiso, formato)
    console.error('[nda] no se pudo comparar la firma', envioId, (err as Error).message);
    throw alIA('No se pudo comparar con la IA. Inténtalo de nuevo.');
  }

  let recorte: string | undefined;
  if (ia.firmaEnIdentificacion) {
    const { width = 0, height = 0 } = await sharp(identificacion).metadata();
    const caja = cajaValida(ia.caja, width, height);
    if (caja) recorte = await recortarFirma(identificacion, caja).catch(() => undefined);
  }
  const veredicto: VeredictoFirma = ia.firmaEnIdentificacion ? ia.veredicto : 'no_concluyente';
  const comentario = (ia.comentario.trim() || (ia.firmaEnIdentificacion ? '' : 'No se alcanza a ver la firma en la foto de la identificación.')).slice(0, 400);
  return { ...base, firma: { veredicto, comentario, firmaNda: `data:image/png;base64,${firma.toString('base64')}`, ...(recorte ? { firmaIdentificacion: recorte } : {}) } };
}
