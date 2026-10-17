// Indicadores de Reclutamiento: qué se mide y cómo se resume. Lo comparten el servidor (que cuenta proyecto por proyecto) y la
// pantalla (que suma los proyectos del periodo elegido), así que la definición de cada cifra vive en un solo lugar.

/** Una fila por proyecto, ya contada. «Persona» = una identidad: la misma persona aunque aparezca en varias filas. */
export interface ProyectoReclutamiento {
  codigo: string;
  cliente?: string;
  /** Inicio del proyecto (AAAA-MM-DD); si el proyecto no tiene fecha, la de su última actividad real. */
  fecha: string;
  inferida: boolean;
  /** Personas que participaron o quedaron en un grupo (la definición del Hub, participoEnProyecto). */
  participaron: number;
  /** De ellas, las que ya eran «no elegibles» al entrar: habían participado con el mismo cliente o en los 6 meses anteriores. */
  noElegibles: number;
  /** De las no elegibles que entraron, las que lo eran por haber participado con el mismo cliente. */
  porMismoCliente: number;
  /**
   * Personas marcadas «no elegible» en este proyecto a las que el equipo sí dio seguimiento: entraron a un grupo o tienen un estatus
   * distinto de «Pendiente» y vacío (contactada, confirmada, descartada, no show…). Las que se quedaron en «Pendiente» o sin estatus no cuentan.
   */
  marcadosTrabajados: number;
  /**
   * De las que participaron, las que llegaron con 2 o más, 3 o más, 4 o más y 5 o más participaciones previas (en otros proyectos, antes
   * de este). Es ACUMULADO: quien ya había participado 3 veces cuenta también en «2 o más». Los tramos que no se traslapan salen de restar.
   */
  previas: { 2: number; 3: number; 4: number; 5: number };
  /** De las que participaron, las que aparecen en más de una fila de un mismo tablero. */
  duplicados: number;
}

export interface DatosReclutamiento {
  proyectos: ProyectoReclutamiento[];
  /** Personas que han participado alguna vez, y cuántas lo hicieron en 2, 3, 5 o 10 proyectos o más. */
  vida: { personas: number; enAlMenos: { 2: number; 3: number; 5: number; 10: number } };
  /** Personas-proyecto que no se pudieron contar porque el proyecto no tiene ninguna fecha. */
  sinFecha: number;
}

/**
 * Los repetidores por cuántos proyectos anteriores ya habían participado, en tramos que NO se traslapan: una persona cae en uno solo.
 * 2, 3 y 4 son «exactamente»; 5 es «5 o más». Los tramos suman el total de repetidores (2 o más).
 */
export type Tramo = 2 | 3 | 4 | 5;
export const TRAMOS: Tramo[] = [2, 3, 4, 5];
export const etiquetaTramo = (t: Tramo) => (t === 5 ? '5 o más proyectos antes' : `Exactamente ${t} proyectos antes`);

/** Con qué clave se guarda la meta de cada tramo. */
export const claveMetaTramo = (t: Tramo) => `repetidores_${t}`;

export type ClaveIndicador = 'noElegibles' | 'avisosRespetados' | 'repetidores' | 'duplicados';

export interface DefinicionIndicador {
  clave: ClaveIndicador;
  etiqueta: string;
  /** Si lo bueno es que baje o que suba: de ahí sale si va en meta. */
  mejor: 'menos' | 'mas';
}

export const INDICADORES: DefinicionIndicador[] = [
  { clave: 'noElegibles', etiqueta: 'No elegibles que entran', mejor: 'menos' },
  { clave: 'avisosRespetados', etiqueta: 'Avisos respetados', mejor: 'mas' },
  { clave: 'repetidores', etiqueta: 'Repetidores (2 o más proyectos antes)', mejor: 'menos' },
  { clave: 'duplicados', etiqueta: 'Duplicados en el tablero', mejor: 'menos' },
];

/** Lo que se puede ver trimestre por trimestre: los cuatro indicadores y cada tramo de repetidores. */
export type ClaveGrafica = ClaveIndicador | `tramo_${Tramo}`;
export const OPCIONES_GRAFICA: Array<{ clave: ClaveGrafica; etiqueta: string; mejor: 'menos' | 'mas'; meta: string | null }> = [
  ...INDICADORES.map((i) => ({ clave: i.clave as ClaveGrafica, etiqueta: i.etiqueta, mejor: i.mejor, meta: i.clave === 'repetidores' ? null : i.clave })),
  ...TRAMOS.map((t) => ({ clave: `tramo_${t}` as ClaveGrafica, etiqueta: `Repetidores: ${t === 5 ? '5 o más' : `exactamente ${t}`} proyectos antes`, mejor: 'menos' as const, meta: claveMetaTramo(t) })),
];

// ── Periodos ─────────────────────────────────────────────────────────────────
export type Periodo = '6m' | '12m' | 'anio' | 'todo';
export const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: '12m', etiqueta: '12 meses' },
  { valor: '6m', etiqueta: '6 meses' },
  { valor: 'anio', etiqueta: 'Este año' },
  { valor: 'todo', etiqueta: 'Todo' },
];

/** AAAA-MM-DD menos `meses` meses (si el día no existe en el mes de llegada, queda el último día de ese mes). */
export function restarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 - meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

/** Los proyectos que empezaron dentro del periodo, hasta hoy: los que aún no empiezan no cuentan. `hoy` es AAAA-MM-DD. */
export function enPeriodo(proyectos: ProyectoReclutamiento[], periodo: Periodo, hoy: string): ProyectoReclutamiento[] {
  const desde = periodo === '12m' ? restarMeses(hoy, 12) : periodo === '6m' ? restarMeses(hoy, 6) : periodo === 'anio' ? `${hoy.slice(0, 4)}-01-01` : '';
  return proyectos.filter((p) => p.fecha <= hoy && p.fecha >= desde);
}

// ── Resumen ──────────────────────────────────────────────────────────────────
const porcentaje = (parte: number, total: number): number | null => (total > 0 ? (100 * parte) / total : null);

export interface ResumenReclutamiento {
  proyectos: number;
  participaron: number;
  noElegibles: number;
  pctNoElegibles: number | null;
  /** Personas con aviso a las que el equipo dio seguimiento, y de ellas las que se frenaron (no terminaron en un grupo). */
  avisosTrabajados: number;
  avisosRespetados: number;
  pctAvisosRespetados: number | null;
  /** Repetidores en total (2 o más proyectos antes) y por tramo sin traslape: la suma de los tramos es el total. */
  repetidores: number;
  pctRepetidores: number | null;
  tramos: Record<Tramo, number>;
  duplicados: number;
  pctDuplicados: number | null;
}

export function resumir(proyectos: ProyectoReclutamiento[]): ResumenReclutamiento {
  const suma = (f: (p: ProyectoReclutamiento) => number) => proyectos.reduce((s, p) => s + f(p), 0);
  const participaron = suma((p) => p.participaron);
  const noElegibles = suma((p) => p.noElegibles);
  const avisosTrabajados = suma((p) => p.marcadosTrabajados ?? 0);
  const acumulado = (k: Tramo) => suma((p) => p.previas[k]);
  const repetidores = acumulado(2);
  const tramos: Record<Tramo, number> = { 2: repetidores - acumulado(3), 3: acumulado(3) - acumulado(4), 4: acumulado(4) - acumulado(5), 5: acumulado(5) };
  const duplicados = suma((p) => p.duplicados);
  // Las no elegibles que entraron siempre tuvieron seguimiento (entrar lo es), así que son parte de las trabajadas.
  const avisosRespetados = Math.max(0, avisosTrabajados - noElegibles);
  return {
    proyectos: proyectos.length, participaron,
    noElegibles, pctNoElegibles: porcentaje(noElegibles, participaron),
    avisosTrabajados, avisosRespetados, pctAvisosRespetados: porcentaje(avisosRespetados, avisosTrabajados),
    repetidores, pctRepetidores: porcentaje(repetidores, participaron), tramos,
    duplicados, pctDuplicados: porcentaje(duplicados, participaron),
  };
}

/** De cada indicador: el porcentaje, de qué se saca (parte de total) y qué es el total. */
export function valorDe(r: ResumenReclutamiento, clave: ClaveIndicador): { pct: number | null; parte: number; total: number; de: string } {
  switch (clave) {
    case 'noElegibles': return { pct: r.pctNoElegibles, parte: r.noElegibles, total: r.participaron, de: 'personas que entraron' };
    case 'avisosRespetados': return { pct: r.pctAvisosRespetados, parte: r.avisosRespetados, total: r.avisosTrabajados, de: 'personas con aviso y con seguimiento' };
    case 'repetidores': return { pct: r.pctRepetidores, parte: r.repetidores, total: r.participaron, de: 'personas que entraron' };
    case 'duplicados': return { pct: r.pctDuplicados, parte: r.duplicados, total: r.participaron, de: 'personas que entraron' };
  }
}

/** Un tramo de repetidores: el porcentaje de quienes entraron que cayeron justo en ese tramo, y de qué se saca. */
export function valorTramo(r: ResumenReclutamiento, t: Tramo): { pct: number | null; parte: number; total: number } {
  return { pct: porcentaje(r.tramos[t], r.participaron), parte: r.tramos[t], total: r.participaron };
}

export interface PuntoTrimestre { trimestre: string; parte: number; total: number; pct: number | null }

/** Un indicador trimestre por trimestre (por el trimestre de inicio del proyecto), del más viejo al más nuevo. */
export function porTrimestre(proyectos: ProyectoReclutamiento[], clave: ClaveGrafica): PuntoTrimestre[] {
  const trimestres = new Map<string, ProyectoReclutamiento[]>();
  for (const p of proyectos) {
    const t = `${p.fecha.slice(0, 4)}-T${Math.floor((Number(p.fecha.slice(5, 7)) - 1) / 3) + 1}`;
    const lista = trimestres.get(t);
    if (lista) lista.push(p); else trimestres.set(t, [p]);
  }
  return [...trimestres].sort(([a], [b]) => a.localeCompare(b)).map(([trimestre, lista]) => {
    const resumen = resumir(lista);
    const { pct, parte, total } = clave.startsWith('tramo_') ? valorTramo(resumen, Number(clave.slice(6)) as Tramo) : valorDe(resumen, clave as ClaveIndicador);
    return { trimestre, parte, total, pct };
  });
}

// ── Metas ────────────────────────────────────────────────────────────────────
export type EstadoMeta = 'enMeta' | 'fuera' | 'sinMeta';

/** Se compara con un decimal, que es lo que se ve en pantalla: un 5.04% que se muestra «5.0%» no puede quedar fuera de una meta de 5. */
export function estadoMeta(valor: number | null, meta: number | undefined, mejor: 'menos' | 'mas'): EstadoMeta {
  if (valor === null || meta === undefined || !Number.isFinite(meta)) return 'sinMeta';
  const v = Math.round(valor * 10) / 10;
  return (mejor === 'menos' ? v <= meta : v >= meta) ? 'enMeta' : 'fuera';
}

/** Lo que se escribe en el campo de meta: «5», «5.5» o «5,5» → ese número; vacío → null (quitar la meta); otra cosa o fuera de 0–100 → undefined (no vale). */
export function leerMeta(texto: string): number | null | undefined {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : undefined;
}

/** La frase, en palabras llanas y con los números, que va debajo de cada porcentaje. `v` sale de valorDe. */
export function fraseIndicador(clave: ClaveIndicador, v: { parte: number; total: number }): string {
  const n = (x: number) => x.toLocaleString('es-MX');
  switch (clave) {
    case 'noElegibles': return `${n(v.parte)} de ${n(v.total)} personas que entraron a un grupo ya habían participado con el mismo cliente o en los 6 meses anteriores.`;
    case 'avisosRespetados': return `De ${n(v.total)} personas con aviso a las que el equipo dio seguimiento, ${n(v.parte)} se frenaron y ${n(v.total - v.parte)} terminaron en un grupo.`;
    case 'repetidores': return `${n(v.parte)} de ${n(v.total)} personas que entraron ya habían participado antes en 2 o más proyectos.`;
    case 'duplicados': return `${n(v.parte)} de ${n(v.total)} personas que entraron aparecen en más de una fila de su tablero.`;
  }
}

/** La frase de un tramo de repetidores (sin traslape con los demás). */
export function fraseTramo(t: Tramo, v: { parte: number; total: number }): string {
  const n = (x: number) => x.toLocaleString('es-MX');
  return `${n(v.parte)} de ${n(v.total)} personas que entraron ya habían participado antes en ${t === 5 ? '5 o más proyectos' : `exactamente ${t} proyectos`}.`;
}
