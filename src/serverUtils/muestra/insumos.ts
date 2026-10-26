import { randomUUID } from 'node:crypto';
import { pool } from '../../../server/compat';
import { leerGenerador, type ArchivoInsumo, type Insumos, type ReunionInsumo } from '../../lib/formularios/generador';
import { borrarArchivoInsumo, copiarArchivosInsumo, leerArchivoInsumo } from '../formularios/insumos';

/**
 * Los insumos de la muestra del proyecto (pedido de Sergio, 2026-10-26): lo
 * que lee la IA para proponerla o cambiarla, a la vista en Reclutamiento →
 * Muestra, donde se suman archivos (también imágenes y Excel), reuniones de
 * Notetaker y texto. Mientras nadie los toca son los del filtro del proyecto
 * que más tiene; al primer cambio se vuelven de la muestra (se copian los del
 * filtro, con sus PDF e imágenes a su propia carpeta) y ya no dependen de él.
 * Tabla `muestra_insumos` (add-formularios-tables.ts).
 */
export interface InsumosMuestra {
  insumos: Insumos;
  /** Los insumos son de la muestra (si no, son los del filtro, sin copiar todavía). */
  propios: boolean;
  /** El filtro de donde salen (o salieron), para mostrarlo y para el registro de uso de la IA. */
  filtro?: { id: string; titulo: string };
}

interface Guardados extends Insumos { de?: { id: string; titulo: string } }

const carpeta = (proyectoId: string) => `muestra-${proyectoId}`;

function leerGuardados(json: unknown): Guardados {
  const d = (json && typeof json === 'object' ? json : {}) as Partial<Guardados>;
  return {
    ...(typeof d.notas === 'string' ? { notas: d.notas } : {}),
    archivos: Array.isArray(d.archivos) ? d.archivos : [],
    reuniones: Array.isArray(d.reuniones) ? d.reuniones : [],
    ...(d.de?.id ? { de: d.de } : {}),
  };
}

/**
 * Los insumos (propuesta, notas, kick-off) del filtro del proyecto que más
 * tenga (si empatan, el más reciente). Un filtro copiado de otro sin notas ni
 * archivos no cuenta.
 */
export async function filtroConMasInsumos(proyectoId: string) {
  const { rows } = await pool.query(
    `select id, titulo, generador from formularios where proyecto_id = $1 and generador is not null order by updated_at desc nulls last limit 20`,
    [proyectoId],
  );
  let mejor: { formularioId: string; titulo: string; insumos: Insumos; peso: number } | null = null;
  for (const r of rows) {
    const g = leerGenerador(r.generador);
    if (!g) continue;
    const peso = 2 * g.insumos.archivos.length + 2 * g.insumos.reuniones.length + (g.insumos.notas?.trim() ? 1 : 0);
    if (peso > (mejor?.peso ?? 0)) mejor = { formularioId: r.id as string, titulo: (r.titulo ?? 'Filtro') as string, insumos: g.insumos, peso };
  }
  return mejor && { formularioId: mejor.formularioId, titulo: mejor.titulo, insumos: mejor.insumos };
}

async function guardados(proyectoId: string, bloquear?: { query: typeof pool.query }): Promise<Guardados | null> {
  try {
    const { rows: [m] } = await (bloquear ?? pool).query(
      `select insumos from muestra_insumos where proyecto_id = $1${bloquear ? ' for update' : ''}`,
      [proyectoId],
    );
    return m ? leerGuardados(m.insumos) : null;
  } catch (e) {
    // Sin la tabla todavía (antes de correr add-formularios-tables.ts): como si no hubiera propios.
    if ((e as { code?: string }).code === '42P01' && !bloquear) return null;
    throw e;
  }
}

/** Lo que leerá la IA: los de la muestra o, si nadie los ha tocado, los del filtro que más tiene. */
export async function insumosDeLaMuestra(proyectoId: string): Promise<InsumosMuestra> {
  const g = await guardados(proyectoId);
  if (g) {
    const { de, ...insumos } = g;
    return { insumos, propios: true, ...(de ? { filtro: de } : {}) };
  }
  const f = await filtroConMasInsumos(proyectoId);
  if (f) return { insumos: f.insumos, propios: false, filtro: { id: f.formularioId, titulo: f.titulo } };
  return { insumos: { archivos: [], reuniones: [] }, propios: false };
}

/** Para la pantalla: sin el texto de los archivos (puede ser muy largo). */
export const insumosParaNavegador = (m: InsumosMuestra) => ({
  ...m,
  insumos: { ...m.insumos, archivos: m.insumos.archivos.map(({ texto: _t, ruta: _r, ...a }) => a) },
});

/**
 * Suma o quita un insumo de la muestra (un archivo por llamada, en base64). La
 * primera vez copia los del filtro para que la lista que se vio sea la que se
 * cambia.
 */
export async function cambiarInsumos(
  proyectoId: string,
  cambio: { notas?: string; reuniones?: ReunionInsumo[]; archivo?: { nombre: string; mime: string; base64: string }; quitarArchivo?: string },
  por: string,
): Promise<InsumosMuestra> {
  // El archivo se lee antes de abrir la transacción: subir un PDF tarda.
  const nuevo = cambio.archivo
    ? await leerArchivoInsumo(carpeta(proyectoId), randomUUID(), cambio.archivo.nombre, cambio.archivo.mime, Buffer.from(cambio.archivo.base64, 'base64'))
    : undefined;
  let quitado: ArchivoInsumo | undefined;
  const client = await pool.connect();
  try {
    await client.query('begin');
    let base = await guardados(proyectoId, client);
    if (!base) {
      const f = await filtroConMasInsumos(proyectoId);
      base = f
        ? {
          ...(f.insumos.notas ? { notas: f.insumos.notas } : {}),
          reuniones: f.insumos.reuniones,
          archivos: await copiarArchivosInsumo(f.insumos.archivos, f.formularioId, carpeta(proyectoId)),
          de: { id: f.formularioId, titulo: f.titulo },
        }
        : { archivos: [], reuniones: [] };
    }
    if (cambio.notas !== undefined) base.notas = cambio.notas;
    if (cambio.reuniones) base.reuniones = cambio.reuniones;
    if (nuevo) base.archivos = [...base.archivos, nuevo];
    quitado = cambio.quitarArchivo ? base.archivos.find((a) => a.id === cambio.quitarArchivo) : undefined;
    if (quitado) base.archivos = base.archivos.filter((a) => a.id !== quitado!.id);
    await client.query(
      `insert into muestra_insumos (proyecto_id, insumos, updated_by) values ($1, $2, $3)
       on conflict (proyecto_id) do update set insumos = excluded.insumos, updated_by = excluded.updated_by, updated_at = now()`,
      [proyectoId, JSON.stringify(base), por],
    );
    await client.query('commit');
  } catch (err) {
    try { await client.query('rollback'); } catch { /* la conexión ya murió */ }
    if (nuevo) await borrarArchivoInsumo(nuevo);
    throw err;
  } finally {
    client.release();
  }
  // Solo se borra lo que vive en la carpeta de la muestra (nunca un archivo del filtro).
  if (quitado?.ruta?.startsWith(`insumos/${carpeta(proyectoId)}/`)) await borrarArchivoInsumo(quitado);
  return insumosDeLaMuestra(proyectoId);
}

/**
 * Lo que lee la IA de un filtro: sus insumos y los de la muestra del proyecto,
 * sin repetir (un archivo con el mismo nombre, una reunión ya elegida o el
 * mismo texto cuentan una vez). Así no se vuelven a subir; lo propio del
 * filtro (un screener en Word, por ejemplo) se suma.
 */
export async function insumosParaFiltro(proyectoId: string | null, propios: Insumos): Promise<Insumos> {
  if (!proyectoId) return propios;
  const { insumos: deMuestra } = await insumosDeLaMuestra(proyectoId);
  const nombres = new Set(propios.archivos.map((a) => a.nombre.trim().toLowerCase()));
  const reuniones = new Set(propios.reuniones.map((r) => r.id));
  const notas = [propios.notas?.trim(), deMuestra.notas?.trim()].filter((x): x is string => !!x);
  return {
    ...propios,
    archivos: [...propios.archivos, ...deMuestra.archivos.filter((a) => !nombres.has(a.nombre.trim().toLowerCase()))],
    reuniones: [...propios.reuniones, ...deMuestra.reuniones.filter((r) => !reuniones.has(r.id))],
    ...(notas.length ? { notas: [...new Set(notas)].join('\n\n') } : {}),
  };
}
