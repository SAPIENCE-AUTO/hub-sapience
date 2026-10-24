import sharp from 'sharp';
import { z } from 'zod';
import { pool } from '../../../server/compat';
import { getSupabaseAdmin } from '../../../server/supabaseAdmin';
import { ID_FOTO_IDENTIFICACION, ID_NOMBRE } from '../../lib/formularios/inicio';
import { PAISES } from '../../lib/formularios/paises';
import { leerDefinicion, type Definicion, type FotoSubida, type Respuestas, type Resultado } from '../../lib/formularios/tipos';
import { llamarConImagen, MODELOS } from './claude';
import { BUCKET } from './storage';
import { anotarGasto, cerrarUso, registrarUsoAutomatico } from './uso';

// Revisión de la identificación oficial que sube el participante en «Antes de empezar»: al recibir la
// respuesta (sin hacerlo esperar), la IA lee de la foto el nombre, la fecha de nacimiento y la ciudad o el
// estado, y el Hub los compara con lo que declaró. Lo que no cuadra sale como alerta en el panel: nunca
// descarta (lo decide el equipo, como el NSE). Lo que se lee de la foto queda en `resultado.identificacion`.

export const LeidoZ = z.object({
  esIdentificacion: z.boolean().default(false),
  legible: z.boolean().default(true),
  tipo: z.string().nullish(),
  nombre: z.string().nullish(),
  fechaNacimiento: z.string().nullish(),
  ciudad: z.string().nullish(),
  estado: z.string().nullish(),
});
export type LeidoIdentificacion = z.infer<typeof LeidoZ>;

export interface Declarado { nombre?: string; edad?: number; ciudad?: string; estado?: string }

export interface RevisionIdentificacion {
  tipo?: string;
  nombre?: string;
  edad?: number;
  lugar?: string;
  alertas: string[];
}

const SISTEMA = `Lees fotos de identificaciones oficiales (en México: INE, pasaporte, licencia de manejo, cédula profesional) para un cuestionario de reclutamiento. Copias los datos tal como aparecen en la foto; nunca adivinas ni inventas. Si un dato no se ve (puede estar tapado a propósito), va en null. Respondes solo con un objeto JSON, sin texto antes ni después.`;

const TEXTO = `De esta foto, responde solo con este JSON:
{"esIdentificacion": true|false (si es una identificación oficial con foto de una persona), "legible": true|false (si se alcanzan a leer los datos), "tipo": "INE" | "pasaporte" | "licencia" | "otra" | null, "nombre": "nombre completo como aparece" | null, "fechaNacimiento": "AAAA-MM-DD" | null, "ciudad": "ciudad, municipio o alcaldía" | null, "estado": "estado" | null}`;

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const palabras = (t: string) => normal(t).split(' ').filter((x) => x.length > 2);

/** Edad cumplida a una fecha (AAAA-MM-DD). */
export function edadDe(fecha: string, hoy = new Date()): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (!m) return undefined;
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let edad = hoy.getFullYear() - a;
  if (hoy.getMonth() + 1 < mes || (hoy.getMonth() + 1 === mes && hoy.getDate() < dia)) edad--;
  return edad >= 0 && edad < 120 ? edad : undefined;
}

/** «Edo. Méx.», «CDMX», «Ciudad de México»: el estado con el nombre de la lista del país, para compararlo. */
function estadoNormal(t: string, pais: string): string {
  const n = normal(t).replace(/^estado de /, '').replace(/^edo /, '');
  const alias: Record<string, string> = { cdmx: 'ciudad de mexico', df: 'ciudad de mexico', 'distrito federal': 'ciudad de mexico', mex: 'mexico', 'estado de mexico': 'mexico' };
  const lista = (PAISES[pais]?.estados ?? []).map((e) => normal(e).replace(/^estado de /, ''));
  const directo = alias[n] ?? n;
  return lista.find((e) => e === directo || e.startsWith(directo) || directo.startsWith(e)) ?? directo;
}

/**
 * Compara lo leído de la identificación con lo declarado. El nombre coincide
 * si al menos dos palabras del declarado (o la única) están en el de la
 * identificación («Ana López» con «ANA MARÍA LÓPEZ GARCÍA»); la edad, con un
 * año de margen; el lugar, por el estado (o la ciudad si no hay estado).
 */
export function compararIdentificacion(leido: LeidoIdentificacion, declarado: Declarado, pais: string, hoy = new Date()): RevisionIdentificacion {
  const alertas: string[] = [];
  const edad = leido.fechaNacimiento ? edadDe(leido.fechaNacimiento, hoy) : undefined;
  const lugar = [leido.ciudad, leido.estado].filter(Boolean).join(', ') || undefined;
  const revision: RevisionIdentificacion = { tipo: leido.tipo ?? undefined, nombre: leido.nombre ?? undefined, edad, lugar, alertas };
  if (!leido.esIdentificacion) { alertas.push('La foto no parece una identificación oficial'); return revision; }
  if (!leido.legible) { alertas.push('No se alcanza a leer la identificación'); return revision; }

  if (declarado.nombre && leido.nombre) {
    const suyas = palabras(declarado.nombre);
    const enId = new Set(palabras(leido.nombre));
    const comunes = suyas.filter((p) => enId.has(p)).length;
    if (suyas.length && comunes < Math.min(2, suyas.length)) alertas.push(`La identificación dice otro nombre: «${leido.nombre}»`);
  }
  if (declarado.edad !== undefined && edad !== undefined && Math.abs(declarado.edad - edad) > 1) {
    alertas.push(`Edad distinta en la identificación: ${edad} años`);
  }
  if (leido.estado && declarado.estado) {
    if (estadoNormal(leido.estado, pais) !== estadoNormal(declarado.estado, pais)) alertas.push(`La identificación es de otro lugar: ${lugar}`);
  } else if (leido.ciudad && declarado.ciudad && !normal(leido.ciudad).includes(normal(declarado.ciudad)) && !normal(declarado.ciudad).includes(normal(leido.ciudad))) {
    alertas.push(`La identificación es de otro lugar: ${lugar}`);
  }
  return revision;
}

/** Lo que declaró: el nombre, la edad (si hay pregunta de edad) y la ciudad y el estado de su dirección (si la hay). */
export function declaradoDe(def: Definicion, resp: Respuestas): Declarado {
  const texto = (id?: string) => (id && typeof resp[id] === 'string' ? (resp[id] as string) : undefined);
  const edad = def.claves?.edad ? resp[def.claves.edad] : undefined;
  const direccion = def.secciones.flatMap((s) => s.preguntas).find((p) => p.tipo === 'direccion');
  const d = direccion ? (resp[direccion.id] as Record<string, string> | undefined) : undefined;
  return {
    nombre: texto(def.claves?.nombre ?? ID_NOMBRE),
    edad: typeof edad === 'number' ? edad : undefined,
    ciudad: d?.ciudad?.trim() || undefined,
    estado: d?.estado?.trim() || undefined,
  };
}

/** Revisa la identificación de una respuesta y le agrega las alertas. Pensada para correr sin que nadie la espere. */
export async function revisarIdentificacion(respuestaId: string): Promise<void> {
  const { rows: [r] } = await pool.query(
    `select r.formulario_id, r.respuestas, r.resultado, f.definicion
     from formulario_respuestas r join formularios f on f.id = r.formulario_id where r.id = $1`,
    [respuestaId],
  );
  if (!r || !process.env.ANTHROPIC_API_KEY) return;
  const resp = r.respuestas as Respuestas;
  const [foto] = (resp[ID_FOTO_IDENTIFICACION] as FotoSubida[] | undefined) ?? [];
  if (!foto) return;
  const def = leerDefinicion(r.definicion);

  let revision: RevisionIdentificacion;
  const usoId = await registrarUsoAutomatico(r.formulario_id, 'identificacion');
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).download(foto.ruta);
    if (error || !data) throw new Error(`No se pudo leer la foto: ${error?.message}`);
    // Derecha (según la cámara), de hasta 1600 px y en JPEG: lo que la IA lee bien y cuesta poco.
    const datos = await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const leido = await llamarConImagen({
      sistema: SISTEMA, texto: TEXTO, imagen: { datos, tipo: 'image/jpeg' }, esquema: LeidoZ,
      modelo: MODELOS.cambios, esfuerzo: 'low', onGasto: (g) => void anotarGasto(usoId, g),
    });
    revision = compararIdentificacion(leido, declaradoDe(def, resp), def.pais);
    await cerrarUso(usoId, true);
  } catch (err) {
    console.error('[filtros] no se pudo revisar una identificación', respuestaId, (err as Error).message);
    await cerrarUso(usoId, false);
    revision = { alertas: ['No se pudo revisar la identificación con la IA: revísala a mano'] };
  }

  const resultado = r.resultado as Resultado & { identificacion?: RevisionIdentificacion };
  const alertas = [...resultado.alertas.filter((a) => !(resultado.identificacion?.alertas ?? []).includes(a)), ...revision.alertas];
  // Solo sus campos: el historial y la clasificación se guardan aparte en el mismo resultado.
  await pool.query(
    `update formulario_respuestas set resultado = resultado || jsonb_build_object('alertas', $2::jsonb, 'identificacion', $3::jsonb) where id = $1`,
    [respuestaId, JSON.stringify(alertas), JSON.stringify(revision)],
  );
}
