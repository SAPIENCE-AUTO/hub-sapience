// Estadística por reclutador (nov 2026): de las respuestas que lleva el nombre de cada reclutador (la pregunta «NR»), cuántas son de gente
// nueva y cuántas de gente que ya había llenado otro filtro. Lógica pura: la usan el servidor (al contar) y la pantalla (al juntar nombres
// y sumar al instante). Ver docs/reclutadores.md.
//
// Una RESPUESTA es una vez que alguien llenó un filtro: las copias de la misma respuesta en varios tableros cuentan una sola vez
// (src/lib/respuestaFillout.ts). «Nueva»: la persona no tenía ninguna respuesta en un proyecto anterior; «repetida»: ya tenía una, y se
// cuenta en cuántos proyectos anteriores (1, 2, 3 o 4 o más). El orden de los proyectos es el de su fecha de inicio, como en el resto de Indicadores.
import type { Periodo } from './reclutamiento';

export type { Periodo };
export const PERIODOS_RECLUTADOR: Periodo[] = ['12m', '6m', 'anio', 'todo'];

/** Proyectos anteriores con los que se parte la barra de las repetidas: 1, 2, 3 y 4 o más. */
export const TRAMOS_REPETIDAS = [1, 2, 3, 4] as const;
export const etiquetaTramo = (t: number) => (t >= 4 ? '4 o más proyectos antes' : t === 1 ? '1 proyecto antes' : `${t} proyectos antes`);

/**
 * Contadores de un conjunto de respuestas, en este orden:
 * [total, nuevas, repetidas con 1, 2, 3 y 4 o más proyectos anteriores, de un contacto compartido].
 * Un «contacto compartido» es un correo o teléfono que usa quien recluta en campo para llenar por el participante: no es una persona que
 * repite, así que esas respuestas no cuentan ni como nuevas ni como repetidas.
 */
export type Conteo = [number, number, number, number, number, number, number];
export const conteoCero = (): Conteo => [0, 0, 0, 0, 0, 0, 0];

/** Suma `b` dentro de `a` (y devuelve `a`). */
export function sumarEn(a: Conteo, b: ReadonlyArray<number>): Conteo {
  for (let i = 0; i < a.length; i++) a[i] += b[i] ?? 0;
  return a;
}

export interface ResumenConteo {
  total: number;
  nuevas: number;
  /** Todas las repetidas, sin importar con cuántos proyectos anteriores. */
  repetidas: number;
  /** Las repetidas partidas en 1, 2, 3 y 4 o más proyectos anteriores. */
  repetidasPorTramo: [number, number, number, number];
  compartido: number;
  /** Nuevas más repetidas: sobre este total se sacan los porcentajes (el contacto compartido queda fuera). */
  clasificadas: number;
  pctNuevas: number | null;
  pctRepetidas: number | null;
}

export function resumenDe(c: ReadonlyArray<number>): ResumenConteo {
  const [total, nuevas, r1, r2, r3, r4, compartido] = [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0, c[6] ?? 0];
  const repetidas = r1 + r2 + r3 + r4;
  const clasificadas = nuevas + repetidas;
  return {
    total, nuevas, repetidas, repetidasPorTramo: [r1, r2, r3, r4], compartido, clasificadas,
    pctNuevas: clasificadas > 0 ? (100 * nuevas) / clasificadas : null,
    pctRepetidas: clasificadas > 0 ? (100 * repetidas) / clasificadas : null,
  };
}

/** Una forma de escribir el nombre (ya sin mayúsculas, acentos ni signos) con sus conteos por periodo. */
export interface Escritura {
  clave: string;
  /** La forma más común tal como la escribieron. */
  nombre: string;
  /** Las formas originales más comunes, con cuántas respuestas trae cada una. */
  formas: Array<[string, number]>;
  c: Record<Periodo, Conteo>;
}

/** Lo que se guarda en indicadores_calculos (área «reclutadores»). */
export interface DatosReclutadores {
  version: 1;
  /** AAAA-MM-DD en que se contó: contra esta fecha se arman los periodos. */
  hoy: string;
  escrituras: Escritura[];
  /** Respuestas sin nombre (vacío, «nadie», «no sé»…): se cuentan aparte. */
  sinNombre: Record<Periodo, Conteo>;
  /** Respuestas que no se pudieron ubicar porque su proyecto no tiene ninguna fecha. */
  sinFecha: number;
  /** Cuántas «personas» se trataron como contacto compartido. */
  contactosCompartidos: number;
}

// ── Nombres ──────────────────────────────────────────────────────────────────
/** «Ana  GÓMEZ.» → «ana gomez»: la llave con la que se juntan las escrituras que solo difieren en mayúsculas, acentos o signos. */
export const normalizarNombre = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Lo que la gente contesta cuando nadie la invitó o no se acuerda: no es un reclutador.
const SIN_NOMBRE = /^(no|ninguno|ninguna|na|n a|nadie|nada|no se|no recuerdo|no me acuerdo|x|xx|xxx|sin nombre|ninguna persona|por mi cuenta|nadie me invito|ninguno me invito|no aplica|no tengo|nose|nr|n r|ok|si|solo|yo|mi|pagina|instagram|facebook|tiktok|whatsapp|redes|redes sociales|internet|google)$/;

/** Una llave que no nombra a nadie (vacía, una letra, o «nadie», «no sé», «instagram»…). */
export const esSinNombre = (clave: string): boolean => clave.length <= 1 || SIN_NOMBRE.test(clave);

// ── Sugerir quién es quién ───────────────────────────────────────────────────
function distancia(a: string, b: string): number {
  const m = a.length, n = b.length;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const actual = [i];
    for (let j = 1; j <= n; j++) actual[j] = Math.min(anterior[j] + 1, actual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    anterior = actual;
  }
  return anterior[n];
}

/**
 * ¿Pueden ser el mismo primer nombre? «manu» y «manel» con «manuel», «ale» con «alejandra». Una letra de diferencia solo vale desde 5 letras
 * («mate» y «mata» son personas distintas), o desde 3 si además el apellido es idéntico («laro prieto» y «lalo prieto»).
 */
function primerNombreParecido(a: string, b: string, apellidoIgual: boolean): boolean {
  if (a === b) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length >= 3 && largo.startsWith(corto)) return true;
  const d = distancia(a, b);
  if (d <= 1 && corto.length >= (apellidoIgual ? 3 : 5)) return true;
  // Dos letras de diferencia solo en nombres largos: «adriana» y «mariana» (dos letras) son personas distintas.
  return d <= 2 && corto.length >= 8;
}

/** ¿Pueden ser el mismo apellido? Igual, una inicial, el principio o una letra de diferencia. */
function apellidoParecido(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length >= 2 && largo.startsWith(corto)) return true;
  return corto.length >= 5 && distancia(a, b) <= 1;
}

/** ¿Podrían ser la misma persona dos formas de escribir un nombre? Solo sirve para SUGERIR: la confirmación es de quien juntan. */
export function podrianSerLaMisma(a: string, b: string): boolean {
  const ta = a.split(' '), tb = b.split(' ');
  // «j salgado» con «julia salgado»: una inicial vale solo si el apellido es el mismo.
  if (ta[0].length === 1 || tb[0].length === 1) {
    return ta.length > 1 && tb.length > 1 && ta[0][0] === tb[0][0] && ta[1] === tb[1];
  }
  const apellidoIgual = ta.length > 1 && tb.length > 1 && ta[1] === tb[1];
  if (!primerNombreParecido(ta[0], tb[0], apellidoIgual)) return false;
  if (ta.length === 1 || tb.length === 1) return true; // «mateo» con «mateo medina»
  return apellidoParecido(ta[1], tb[1]);
}

export interface MiembroSugerido { clave: string; n: number; ambiguo: boolean }
export interface GrupoSugerido {
  /** La forma más común: da nombre al grupo. */
  ancla: string;
  miembros: MiembroSugerido[];
  total: number;
}

/** Una forma que aparece menos veces que esto no da nombre a un grupo nuevo; solo se suma a uno que ya existe. */
export const MIN_RESPUESTAS_ANCLA = 30;

/**
 * Propone grupos con las escrituras que todavía no tienen reclutador. Primero se eligen las formas que dan nombre a un grupo (las más usadas
 * que no se parecen a otra más usada) y después se le suma a cada grupo lo que se le parece. Una forma que encaja con dos grupos distintos
 * («ramiro» con «ramiro g» y «ramiro r») se marca como ambigua: se le suma al más grande, pero conviene revisarla.
 * `n` es la cantidad de respuestas de esa forma (en el periodo que se esté viendo).
 */
export function sugerirGrupos(items: ReadonlyArray<{ clave: string; n: number }>, minAncla = MIN_RESPUESTAS_ANCLA): GrupoSugerido[] {
  const orden = [...items].filter((i) => i.n > 0).sort((a, b) => b.n - a.n || a.clave.localeCompare(b.clave));
  const anclas: GrupoSugerido[] = [];
  for (const it of orden) {
    if (it.n >= minAncla && !anclas.some((g) => podrianSerLaMisma(it.clave, g.ancla))) {
      anclas.push({ ancla: it.clave, miembros: [{ clave: it.clave, n: it.n, ambiguo: false }], total: it.n });
    }
  }
  const esAncla = new Set(anclas.map((g) => g.ancla));
  for (const it of orden) {
    if (esAncla.has(it.clave)) continue;
    const candidatos = anclas.filter((g) => podrianSerLaMisma(it.clave, g.ancla)); // de mayor a menor
    if (candidatos.length === 0) continue; // sin grupo: queda suelta
    candidatos[0].miembros.push({ clave: it.clave, n: it.n, ambiguo: candidatos.length > 1 });
    candidatos[0].total += it.n;
  }
  return anclas.sort((a, b) => b.total - a.total || a.ancla.localeCompare(b.ancla));
}

/** El grupo existente al que más se parece una escritura suelta, si alguno: así se sugiere «¿es Mateo Medina?» sin crear nada. */
export function reclutadorParecido(clave: string, nombresDeReclutadores: ReadonlyArray<{ id: string; claves: ReadonlyArray<string> }>): string | null {
  const encaja = nombresDeReclutadores.filter((r) => r.claves.some((k) => podrianSerLaMisma(clave, k)));
  return encaja.length === 1 ? encaja[0].id : null;
}

// ── Sumar por reclutador ─────────────────────────────────────────────────────
/** Dónde está cada forma de escribir el nombre: con un reclutador, marcada «no es reclutador», o sin asignar (no aparece). */
export interface Asignacion { reclutadorId: string | null; ignorar: boolean }

export interface Reparto {
  /** Por reclutador: lo que suman sus formas y cuáles son. */
  porReclutador: Map<string, { conteo: Conteo; claves: string[] }>;
  sinAsignar: { conteo: Conteo; claves: string[] };
  ignoradas: { conteo: Conteo; claves: string[] };
  /** Lo que no trae nombre. */
  sinNombre: Conteo;
}

/** Reparte las formas de escribir el nombre entre los reclutadores, en el periodo pedido. Todo es suma: se rehace al instante. */
export function repartir(datos: DatosReclutadores, periodo: Periodo, asignaciones: ReadonlyMap<string, Asignacion>): Reparto {
  const r: Reparto = { porReclutador: new Map(), sinAsignar: { conteo: conteoCero(), claves: [] }, ignoradas: { conteo: conteoCero(), claves: [] }, sinNombre: [...datos.sinNombre[periodo]] as Conteo };
  for (const e of datos.escrituras) {
    const a = asignaciones.get(e.clave);
    const destino = a?.reclutadorId
      ? (r.porReclutador.get(a.reclutadorId) ?? (() => { const nuevo = { conteo: conteoCero(), claves: [] as string[] }; r.porReclutador.set(a.reclutadorId!, nuevo); return nuevo; })())
      : a?.ignorar ? r.ignoradas : r.sinAsignar;
    sumarEn(destino.conteo, e.c[periodo]);
    destino.claves.push(e.clave);
  }
  return r;
}

// ── Lo que viaja entre el servidor y la pantalla ─────────────────────────────
export interface Reclutador { id: string; nombre: string }
export interface AliasFila { clave: string; reclutadorId: string | null; ignorar: boolean }
export interface SalidaReclutadores {
  calculadoEn?: string;
  datos?: DatosReclutadores;
  reclutadores: Reclutador[];
  alias: AliasFila[];
  /** Todavía no existen las tablas donde se guarda quién es quién: se ve el cálculo pero no se pueden juntar nombres. */
  sinTablas: boolean;
}
