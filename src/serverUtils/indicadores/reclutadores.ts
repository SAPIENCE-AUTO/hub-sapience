// Estadística por reclutador: de qué reclutador es cada respuesta (la pregunta «NR»), cuáles son de gente nueva y cuáles de gente que ya había
// llenado otro filtro en un proyecto anterior. Ver docs/reclutadores.md y src/lib/indicadores/reclutadores.ts (las definiciones).
//
// Dos pasos: leer el nombre que escribió cada participante (de lo que cada tablero ya guarda por fila) y contar sobre lo que ya carga
// getGlobalIdentityData (todas las filas de reclutamiento y sus identidades). Solo lee: no escribe nada en reclutamiento.
import type { GlobalIdentityData } from '../../lib/globalIdentityCache';
import { normalizeName, participoEnProyecto, type IdentityRow } from '../../lib/duplicateIdentity';
import { respuestaDe } from '../../lib/respuestaFillout';
import {
  MAX_TRAMO, PERIODOS_RECLUTADOR, POSICION_TRAMO, conteoCero, esSinNombre, normalizarNombre, type Conteo, type DatosReclutadores, type Escritura, type Periodo,
} from '../../lib/indicadores/reclutadores';
import { restarMeses } from '../../lib/indicadores/reclutamiento';
import { esContactoCompartido } from '../../lib/filtrosLlenados';
import type { Consulta } from './almacen';

// Qué es un contacto compartido (tantas respuestas y tantos nombres distintos) se define una sola vez, en src/lib/filtrosLlenados.ts, porque el tablero y el historial lo usan igual;
// se reexporta aquí porque las pruebas y los scripts lo importan de este archivo.
export { MIN_RESPUESTAS_COMPARTIDO, MIN_NOMBRES_COMPARTIDO } from '../../lib/filtrosLlenados';

/** Cómo se llama la columna del reclutador en los tableros (sin mayúsculas ni acentos). */
export const COLUMNAS_RECLUTADOR = ['nr', 'reclutador', 'nombre reclutador', 'quien lo invito'];

// ── 1. El nombre que escribió cada participante ─────────────────────────────
/**
 * El nombre del reclutador de cada fila viva, por id de fila. Sale del resumen que cada fila guarda de sus celdas (`cell_data`), no de
 * `cell_values`: ahí falta en la mitad de las filas (importaciones viejas) y consultarla columna por columna tarda minutos. Donde las dos
 * existen coinciden. Se lee tablero por tablero, de a pocos a la vez, para no cargar la base.
 */
export async function leerNombresReclutador(
  db: Consulta,
  opciones: { concurrencia?: number; alAvanzar?: (hechos: number, total: number) => void } = {},
): Promise<Map<string, string>> {
  const { rows: columnas } = await db.query(
    `select bc.id::text as col_id, bc.board_id
     from board_columns bc join boards b on b.id::text = bc.board_id and b.deleted_at is null
     where (bc.deleted_at is null or bc.deleted_at = '')
       and translate(lower(trim(bc.column_name)), 'áéíóú', 'aeiou') = any($1::text[])`,
    [COLUMNAS_RECLUTADOR],
  );
  const porTablero = new Map<string, string[]>();
  for (const c of columnas) {
    const ids = porTablero.get(c.board_id) ?? [];
    ids.push(c.col_id);
    porTablero.set(c.board_id, ids);
  }

  const nombres = new Map<string, string>();
  const tableros = [...porTablero.entries()];
  let hechos = 0;
  const leerUno = async ([tablero, columnasDelTablero]: [string, string[]]) => {
    const campos = columnasDelTablero.map((_, i) => `nullif(trim(r.cell_data::jsonb -> $${i + 2} ->> 'textValue'), '') as v${i}`).join(', ');
    try {
      const { rows } = await db.query(
        `select r.id::text as id, ${campos} from recruitment_rows r
         where r.board_id = $1 and (r.deleted_at is null or r.deleted_at = '') and r.cell_data is not null and r.cell_data <> ''`,
        [tablero, ...columnasDelTablero],
      );
      for (const r of rows) {
        const nombre = columnasDelTablero.map((_, i) => r[`v${i}`] as string | null).find((v) => v);
        if (nombre) nombres.set(r.id, nombre);
      }
    } catch {
      // Un `cell_data` que no es JSON válido tira la consulta de todo el tablero: se vuelve a leer fila por fila y esa fila se salta.
      const { rows } = await db.query(
        `select r.id::text as id, r.cell_data from recruitment_rows r
         where r.board_id = $1 and (r.deleted_at is null or r.deleted_at = '') and r.cell_data is not null and r.cell_data <> ''`,
        [tablero],
      );
      for (const r of rows) {
        try {
          const celdas = JSON.parse(String(r.cell_data)) as Record<string, { textValue?: unknown } | undefined>;
          const nombre = columnasDelTablero.map((c) => celdas?.[c]?.textValue).find((v) => typeof v === 'string' && v.trim());
          if (typeof nombre === 'string') nombres.set(r.id, nombre.trim());
        } catch { /* fila ilegible: sin nombre */ }
      }
    }
    opciones.alAvanzar?.(++hechos, tableros.length);
  };

  // Un pequeño grupo de lectores que van tomando tableros de la lista.
  let siguiente = 0;
  const lector = async () => { while (siguiente < tableros.length) await leerUno(tableros[siguiente++]); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opciones.concurrencia ?? 3, tableros.length || 1)) }, lector));
  return nombres;
}

// ── 2. Contar ───────────────────────────────────────────────────────────────
const norm = (s?: string | null) => (s ?? '').toLowerCase().trim();
const participo = (r: IdentityRow) => participoEnProyecto(r as { status?: string | null; group?: string | null });

/**
 * ¿Esta persona era «no elegible» para el proyecto `codigo`? Es la regla de los íconos del tablero (getBoardDuplicateBadges) y de Metas por
 * área (calcularReclutamiento) aplicada contra la fecha de inicio de ese proyecto: ya había participado con el mismo cliente, o en cualquier
 * proyecto en los 6 meses anteriores. Solo cuenta haber PARTICIPADO (participoEnProyecto), no haber estado registrado; un proyecto que empieza
 * después no cuenta. `filas` son todas las filas de la persona. Sin fecha de inicio del proyecto no hay con qué medir: no.
 */
export function eraNoElegible(
  filas: ReadonlyArray<IdentityRow>,
  codigo: string,
  projectMap: ReadonlyMap<string, { client?: string; startDate?: string }>,
): boolean {
  const inicio = projectMap.get(codigo)?.startDate;
  if (!inicio) return false;
  const ref = new Date(inicio);
  const seisMeses = new Date(ref);
  seisMeses.setMonth(seisMeses.getMonth() - 6);
  const cliente = norm(projectMap.get(codigo)?.client);
  for (const otra of filas) {
    const codigoOtra = typeof otra.projectCode === 'string' ? otra.projectCode : '';
    if (!codigoOtra || codigoOtra === codigo) continue;
    const info = projectMap.get(codigoOtra);
    const fechaOtra = info?.startDate ? new Date(info.startDate) : null;
    if (fechaOtra && fechaOtra > ref) continue;
    if (!participo(otra)) continue;
    const clienteOtra = norm(info?.client);
    if (cliente && clienteOtra && cliente === clienteOtra) return true;
    if (!fechaOtra || fechaOtra > seisMeses) return true;
  }
  return false;
}

const porPeriodo = (): Record<Periodo, Conteo> => ({ '12m': conteoCero(), '6m': conteoCero(), anio: conteoCero(), todo: conteoCero() });

/**
 * Cuenta las respuestas de todas las personas. Cada persona (identidad por 2 de 3 datos) tiene sus respuestas ordenadas por la fecha de
 * inicio de su proyecto: la primera es «nueva» y las de proyectos posteriores son «repetidas», con el número de proyectos anteriores en que ya
 * tenía una. Las respuestas del mismo proyecto que la primera cuentan como nuevas (son pasos del mismo reclutamiento). El nombre de
 * la respuesta es el de su copia más antigua que lo trae.
 *
 * Además de nuevas y repetidas, de cada respuesta se anota: si era «no elegible» (medido contra el proyecto de su copia más antigua, que es donde
 * se recibió: `eraNoElegible`), si terminó en un grupo en alguno de sus tableros (`participoEnProyecto`) y si entró siendo no elegible (medido
 * contra el proyecto donde entró, como hace Metas por área). Ninguna elegibilidad se mide en un contacto compartido.
 */
export function calcularReclutadores(
  datos: Pick<GlobalIdentityData, 'activeRows' | 'projectMap' | 'globalClusters'>,
  nombres: ReadonlyMap<string, string>,
  hoy: string,
): DatosReclutadores {
  const { activeRows, projectMap, globalClusters } = datos;
  const filaPorId = new Map<string, IdentityRow>(activeRows.map((r) => [r.id, r]));
  const fechaDe = (codigo: unknown): string | null => {
    const f = typeof codigo === 'string' && codigo ? projectMap.get(codigo)?.startDate : undefined;
    return f ? String(f).slice(0, 10) : null;
  };
  const desde: Record<Periodo, string> = { '12m': restarMeses(hoy, 12), '6m': restarMeses(hoy, 6), anio: `${hoy.slice(0, 4)}-01-01`, todo: '' };

  const porClave = new Map<string, { formas: Map<string, number>; c: Record<Periodo, Conteo> }>();
  const sinNombre = porPeriodo();
  let sinFecha = 0;
  let contactosCompartidos = 0;

  for (const cluster of globalClusters.values()) {
    const filas = cluster.rowIds.map((id) => filaPorId.get(id)).filter((r): r is IdentityRow => !!r);
    if (filas.length === 0) continue;

    // Las filas más antiguas primero, para que el nombre de la respuesta sea el de su copia más antigua.
    const ordenadas = [...filas].sort((a, b) => {
      const fa = fechaDe(a.projectCode) ?? '9999', fb = fechaDe(b.projectCode) ?? '9999';
      return fa < fb ? -1 : fa > fb ? 1 : String(a.id) < String(b.id) ? -1 : 1;
    });
    const respuestas = new Map<string, { fecha: string | null; proyectos: Set<string>; nombre: string; copias: IdentityRow[]; origen: string }>();
    const nombresDeLaPersona = new Set<string>();
    for (const f of ordenadas) {
      const clave = respuestaDe(f) ?? `fila:${f.id}`;
      let r = respuestas.get(clave);
      if (!r) { r = { fecha: null, proyectos: new Set(), nombre: '', copias: [], origen: '' }; respuestas.set(clave, r); }
      r.copias.push(f);
      const codigo = typeof f.projectCode === 'string' ? f.projectCode : '';
      if (codigo) {
        r.proyectos.add(codigo);
        // Las filas vienen de la más antigua a la más nueva: la primera con fecha da la fecha y el proyecto de origen de la respuesta.
        const fecha = fechaDe(codigo);
        if (fecha && r.fecha === null) { r.fecha = fecha; r.origen = codigo; }
      }
      if (!r.nombre) r.nombre = (nombres.get(f.id) ?? '').trim();
      const n = normalizeName(f.participantName as string | undefined);
      if (n) nombresDeLaPersona.add(n);
    }

    const compartido = esContactoCompartido(respuestas.size, nombresDeLaPersona.size);
    if (compartido) contactosCompartidos++;
    let primera: string | null = null;
    for (const r of respuestas.values()) if (r.fecha && (primera === null || r.fecha < primera)) primera = r.fecha;

    for (const r of respuestas.values()) {
      if (!r.fecha || primera === null) { sinFecha++; continue; }
      if (r.fecha > hoy) continue; // el proyecto aún no empieza: igual que en el resto de Indicadores

      // Posición en el conteo: 1 nuevas, 6 contacto compartido y, para las repetidas, la de su tramo (1 a 8 o más proyectos anteriores: POSICION_TRAMO).
      let posicion: number;
      if (compartido) posicion = 6;
      else if (r.fecha === primera) posicion = 1;
      else {
        const anteriores = new Set<string>();
        for (const o of respuestas.values()) if (o.fecha && o.fecha < r.fecha) for (const p of o.proyectos) anteriores.add(p);
        posicion = POSICION_TRAMO[Math.max(1, Math.min(anteriores.size, MAX_TRAMO)) - 1];
      }

      // Posiciones 7, 8 y 9: no elegible (al recibirse la respuesta), entró a un grupo, entró siendo no elegible (en el proyecto donde entró).
      const entro = r.copias.some(participo);
      const aviso = !compartido && r.origen !== '' && eraNoElegible(filas, r.origen, projectMap);
      let entroConAviso = false;
      if (!compartido && entro) {
        const vistos = new Set<string>();
        for (const copia of r.copias) {
          const donde = typeof copia.projectCode === 'string' ? copia.projectCode : '';
          if (!donde || vistos.has(donde) || !participo(copia)) continue;
          vistos.add(donde);
          if (eraNoElegible(filas, donde, projectMap)) { entroConAviso = true; break; }
        }
      }

      const periodos = PERIODOS_RECLUTADOR.filter((p) => r.fecha! >= desde[p]);
      const clave = normalizarNombre(r.nombre);
      const sumar = (c: Conteo) => { c[0]++; c[posicion]++; if (aviso) c[7]++; if (entro) c[8]++; if (entroConAviso) c[9]++; };
      if (esSinNombre(clave)) {
        for (const p of periodos) sumar(sinNombre[p]);
        continue;
      }
      let e = porClave.get(clave);
      if (!e) { e = { formas: new Map(), c: porPeriodo() }; porClave.set(clave, e); }
      e.formas.set(r.nombre, (e.formas.get(r.nombre) ?? 0) + 1);
      for (const p of periodos) sumar(e.c[p]);
    }
  }

  const escrituras: Escritura[] = [...porClave.entries()].map(([clave, e]) => {
    const formas = [...e.formas.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { clave, nombre: formas[0][0], formas: formas.slice(0, 6), c: e.c };
  }).sort((a, b) => b.c.todo[0] - a.c.todo[0] || a.clave.localeCompare(b.clave));
  return { version: 2, hoy, escrituras, sinNombre, sinFecha, contactosCompartidos };
}
