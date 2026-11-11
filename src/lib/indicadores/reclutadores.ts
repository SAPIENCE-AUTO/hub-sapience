// Estadística por reclutador (nov 2026): de las respuestas que lleva el nombre de cada reclutador (la pregunta «NR»), cuántas son de gente
// nueva y cuántas de gente que ya había llenado otro filtro. Lógica pura: la usan el servidor (al contar) y la pantalla (al juntar nombres
// y sumar al instante). Ver docs/reclutadores.md.
//
// Una RESPUESTA es una vez que alguien llenó un filtro: las copias de la misma respuesta en varios tableros cuentan una sola vez
// (src/lib/respuestaFillout.ts). Lo que se cuenta son respuestas, no personas que asistieron: quien llenó tres filtros aporta tres respuestas.
// «Nueva»: la persona no tenía ninguna respuesta en un proyecto anterior; «repetida»: ya tenía una, y se cuenta en cuántos proyectos anteriores
// (de 1 a 7, u 8 o más). El orden de los proyectos es el de su fecha de inicio, como en el resto de Indicadores.
// «No elegible»: la persona ya había participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al inicio del proyecto
// donde se recibió la respuesta (la regla de los íconos del tablero y de Metas por área). «Entró a un grupo»: en alguno de los tableros donde está
// la respuesta, asistió o está en un grupo (participoEnProyecto).
import type { Periodo } from './reclutamiento';

export type { Periodo };
export const PERIODOS_RECLUTADOR: Periodo[] = ['12m', '6m', 'anio', 'todo'];

/** Proyectos anteriores con los que se parte la barra de las repetidas: 1, 2, 3 … 7 y 8 o más (hasta el 2026-11-10 eran solo 1, 2, 3 y 4 o más). */
export const TRAMOS_REPETIDAS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const MAX_TRAMO = 8;
export const etiquetaTramo = (t: number) => (t >= MAX_TRAMO ? `${MAX_TRAMO} o más proyectos antes` : t === 1 ? '1 proyecto antes' : `${t} proyectos antes`);
/** Dónde está cada tramo (1 a 8 o más) dentro del conteo: los de 1 a 4 en el sitio de siempre y los de 5 a 8 al final, así lo ya guardado se lee igual. */
export const POSICION_TRAMO = [2, 3, 4, 5, 10, 11, 12, 13] as const;
export const TAMANO_CONTEO = 14;

/**
 * Contadores de un conjunto de respuestas, en este orden:
 * [total, nuevas, repetidas con 1, 2, 3 y 4 proyectos anteriores, de un contacto compartido, no elegibles, entraron a un grupo,
 * entraron siendo no elegibles, repetidas con 5, 6, 7 y 8 o más proyectos anteriores] (`POSICION_TRAMO` dice dónde va cada tramo; los cálculos
 * viejos, de 7 o 10 números, se rellenan con ceros al leerlos). «No elegibles» se mide en el proyecto donde se recibió la respuesta; «entraron siendo no elegibles», en el
 * proyecto donde entraron al grupo (la cifra de Metas por área): puede no ser un subconjunto de los primeros si entraron en otro proyecto.
 * Un «contacto compartido» es un correo o teléfono que usa quien recluta en campo para llenar por el participante: no es una persona que
 * repite, así que esas respuestas no cuentan ni como nuevas ni como repetidas, ni se les mide la elegibilidad (de quién sería el historial);
 * lo de «entró a un grupo» sí, porque sale de la fila misma. Lo de elegibilidad y los tramos de 5 a 8 solo vienen en los cálculos de la versión 2.
 */
export type Conteo = number[];
export const conteoCero = (): Conteo => new Array<number>(TAMANO_CONTEO).fill(0);

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
  /** Las repetidas partidas en 1, 2 … 7 y 8 o más proyectos anteriores (`TRAMOS_REPETIDAS`). */
  repetidasPorTramo: number[];
  compartido: number;
  /** Nuevas más repetidas: sobre este total se sacan los porcentajes (el contacto compartido queda fuera). */
  clasificadas: number;
  pctNuevas: number | null;
  pctRepetidas: number | null;
  /** Respuestas de personas no elegibles (ya habían participado con el mismo cliente, o en los 6 meses anteriores al proyecto). */
  avisos: number;
  /** Respuestas que terminaron en un grupo. */
  entraron: number;
  /** De las que entraron, cuántas eran no elegibles en el proyecto donde entraron (la cifra de «No elegibles que entraron» de Metas por área). */
  avisosQueEntraron: number;
  /** El total sin el contacto compartido: sobre esto se saca el porcentaje de no elegibles (de ese contacto no se sabe quién es la persona). */
  evaluables: number;
  pctAvisos: number | null;
  /** Sobre el total de respuestas. */
  pctEntraron: number | null;
  /** Sobre las que entraron. */
  pctAvisosQueEntraron: number | null;
}

export function resumenDe(c: ReadonlyArray<number>): ResumenConteo {
  const [total, nuevas, compartido] = [c[0] ?? 0, c[1] ?? 0, c[6] ?? 0];
  const [avisos, entraron, avisosQueEntraron] = [c[7] ?? 0, c[8] ?? 0, c[9] ?? 0];
  const repetidasPorTramo = POSICION_TRAMO.map((p) => c[p] ?? 0);
  const repetidas = repetidasPorTramo.reduce((suma, n) => suma + n, 0);
  const clasificadas = nuevas + repetidas;
  const evaluables = total - compartido;
  return {
    total, nuevas, repetidas, repetidasPorTramo, compartido, clasificadas,
    pctNuevas: clasificadas > 0 ? (100 * nuevas) / clasificadas : null,
    pctRepetidas: clasificadas > 0 ? (100 * repetidas) / clasificadas : null,
    avisos, entraron, avisosQueEntraron, evaluables,
    pctAvisos: evaluables > 0 ? (100 * avisos) / evaluables : null,
    pctEntraron: total > 0 ? (100 * entraron) / total : null,
    pctAvisosQueEntraron: entraron > 0 ? (100 * avisosQueEntraron) / entraron : null,
  };
}

/** Los conteos de un mes de inicio de proyecto («2026-10»): solo están los meses que tienen respuestas. */
export type Meses = Record<string, Conteo>;

/** Una forma de escribir el nombre (ya sin mayúsculas, acentos ni signos) con sus conteos por periodo. */
export interface Escritura {
  clave: string;
  /** La forma más común tal como la escribieron. */
  nombre: string;
  /** Las formas originales más comunes, con cuántas respuestas trae cada una. */
  formas: Array<[string, number]>;
  c: Record<Periodo, Conteo>;
  /** Lo mismo, mes por mes (el mes de inicio del proyecto donde se recibió cada respuesta), para ver la evolución. Solo en los cálculos de la versión 3. */
  meses?: Meses;
}

/** Lo que se guarda en indicadores_calculos (área «reclutadores»). */
export interface DatosReclutadores {
  /**
   * 1: sin elegibilidad ni entradas a grupo y con las repetidas partidas hasta «4 o más» (los conteos traen 7 números; se rellenan con ceros al leerlos). 2: con ellas y con las repetidas
   * partidas hasta «8 o más» (14 números). 3: además, el conteo mes por mes (`meses` en cada forma y `sinNombreMeses`), para la evolución en el tiempo.
   */
  version: 1 | 2 | 3;
  /** AAAA-MM-DD en que se contó: contra esta fecha se arman los periodos. */
  hoy: string;
  escrituras: Escritura[];
  /** Respuestas sin nombre (vacío, «nadie», «no sé»…): se cuentan aparte. */
  sinNombre: Record<Periodo, Conteo>;
  /** Lo mismo, mes por mes (versión 3). */
  sinNombreMeses?: Meses;
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

/** ¿El cálculo guardado ya trae «no elegibles» y «entraron a un grupo»? Los de la primera versión no. */
export const traeElegibilidad = (datos: Pick<DatosReclutadores, 'version'> | undefined): boolean => (datos?.version ?? 1) >= 2;

/** ¿El cálculo guardado ya trae el conteo mes por mes? Solo los de la versión 3. */
export const traeEvolucion = (datos: Pick<DatosReclutadores, 'version'> | undefined): boolean => (datos?.version ?? 1) >= 3;

// ── Evolución en el tiempo ───────────────────────────────────────────────────
/** Los dos «sujetos» de la evolución que no son una persona: lo que suman todos los reclutadores ya juntados, y toda la base (con y sin nombre). */
export const SUJETO_TODOS = '__todos';
export const SUJETO_BASE = '__base';

const aNumeroDeMes = (mes: string): number => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1;
const deNumeroDeMes = (n: number): string => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;

/** El primer mes (AAAA-MM) con respuestas en todo el cálculo, o `undefined` si no hay ninguno. */
export function primerMesConDatos(datos: Pick<DatosReclutadores, 'escrituras' | 'sinNombreMeses'>): string | undefined {
  let primero: string | undefined;
  const ver = (m?: Meses) => { for (const mes of Object.keys(m ?? {})) if (primero === undefined || mes < primero) primero = mes; };
  for (const e of datos.escrituras) ver(e.meses);
  ver(datos.sinNombreMeses);
  return primero;
}

/**
 * Los meses (AAAA-MM) de un rango, del más viejo al más nuevo, terminando en el mes de `hoy` (que va incompleto): 6 o 12 meses, el año en curso, o desde `primerMes` (todo).
 * Es por mes completo: no usa el día exacto como los periodos de la tabla.
 */
export function mesesDelRango(hoy: string, periodo: Periodo, primerMes?: string): string[] {
  const fin = aNumeroDeMes(hoy);
  const inicio = periodo === '6m' ? fin - 5 : periodo === '12m' ? fin - 11 : periodo === 'anio' ? Math.floor(fin / 12) * 12 : (primerMes ? Math.min(aNumeroDeMes(primerMes), fin) : fin);
  return Array.from({ length: fin - inicio + 1 }, (_, i) => deNumeroDeMes(inicio + i));
}

/**
 * Suma, mes por mes, lo de las formas de escribir el nombre dadas (`'todas'` = todas las formas) y, si se pide, lo que no trae nombre. Los meses sin respuestas salen en ceros, para que el
 * eje de la gráfica no tenga huecos. Una clave que no existe no suma nada.
 */
export function serieMensual(
  datos: Pick<DatosReclutadores, 'escrituras' | 'sinNombreMeses'>,
  claves: Iterable<string> | 'todas',
  meses: ReadonlyArray<string>,
  opciones: { incluirSinNombre?: boolean } = {},
): Array<{ mes: string; conteo: Conteo }> {
  const serie = meses.map((mes) => ({ mes, conteo: conteoCero() }));
  const posicion = new Map(meses.map((m, i) => [m, i]));
  const sumarMeses = (m?: Meses) => { for (const [mes, c] of Object.entries(m ?? {})) { const i = posicion.get(mes); if (i !== undefined) sumarEn(serie[i].conteo, c); } };
  if (claves === 'todas') for (const e of datos.escrituras) sumarMeses(e.meses);
  else {
    const quiero = new Set(claves);
    for (const e of datos.escrituras) if (quiero.has(e.clave)) sumarMeses(e.meses);
  }
  if (opciones.incluirSinNombre) sumarMeses(datos.sinNombreMeses);
  return serie;
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
