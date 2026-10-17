// Indicadores de Reclutamiento: qué se mide y cómo se resume. Lo comparten el servidor (que cuenta proyecto por proyecto) y la
// pantalla (que suma los proyectos del periodo elegido), así que la definición de cada cifra vive en un solo lugar.

/** Cuántas veces había participado una persona antes de este proyecto: 1, 2, 3, 4 o «5 o más». Los tramos no se traslapan. */
export type Veces = 1 | 2 | 3 | 4 | 5;
export const VECES: Veces[] = [1, 2, 3, 4, 5];
export type PorVeces = Record<Veces, number>;
export const etiquetaVeces = (v: Veces) => (v === 1 ? '1 vez' : v === 5 ? '5 o más veces' : `${v} veces`);

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
  /** De las no elegibles que entraron, cuántas ya habían participado antes 1, 2, 3, 4 o 5 o más veces (suman `noElegibles`). */
  noElegiblesPorVeces: PorVeces;
  /**
   * De las ELEGIBLES que entraron (las que no traían aviso), cuántas ya habían participado antes 1, 2, 3, 4 o 5 o más veces. Las que
   * entraron por primera vez no están aquí: son `participaron - noElegibles` menos la suma de este conteo.
   */
  elegiblesPorVeces: PorVeces;
  /**
   * Acumulado de todas las que entraron (con 2 o más, 3 o más, 4 o más y 5 o más participaciones previas). Ya no se muestra: se sigue
   * guardando para que el cálculo guardado lo lea también la versión anterior de la pantalla.
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

export type ClaveIndicador = 'noElegibles' | 'avisosRespetados' | 'duplicados';

export interface DefinicionIndicador {
  clave: ClaveIndicador;
  etiqueta: string;
  /** Si lo bueno es que baje o que suba: de ahí sale si va en meta. */
  mejor: 'menos' | 'mas';
}

export const INDICADORES: DefinicionIndicador[] = [
  { clave: 'noElegibles', etiqueta: 'No elegibles que entran', mejor: 'menos' },
  { clave: 'avisosRespetados', etiqueta: 'Avisos respetados', mejor: 'mas' },
  { clave: 'duplicados', etiqueta: 'Duplicados en el tablero', mejor: 'menos' },
];

/** Los dos grupos de quienes entraron: los que traían aviso de «no elegible» y los que no. */
export type Grupo = 'noElegibles' | 'elegibles';

/** Con qué clave se guarda la meta de un tramo; es también la clave de la gráfica de ese tramo. */
export const claveVeces = (grupo: Grupo, veces: Veces) => `${grupo}_${veces}` as const;

/** Lo que se puede ver trimestre por trimestre: los indicadores y cada tramo de cada grupo. */
export type ClaveGrafica = ClaveIndicador | ReturnType<typeof claveVeces>;
export interface OpcionGrafica { clave: ClaveGrafica; etiqueta: string; grupo: string; mejor: 'menos' | 'mas'; meta: string }

export const OPCIONES_GRAFICA: OpcionGrafica[] = [
  ...INDICADORES.map((i) => ({ clave: i.clave as ClaveGrafica, etiqueta: i.etiqueta, grupo: 'Indicadores', mejor: i.mejor, meta: i.clave as string })),
  ...VECES.map((v) => ({ clave: claveVeces('noElegibles', v) as ClaveGrafica, etiqueta: `No elegibles que ya habían participado ${etiquetaVeces(v)}`, grupo: 'No elegibles por número de veces', mejor: 'menos' as const, meta: claveVeces('noElegibles', v) as string })),
  ...VECES.map((v) => ({ clave: claveVeces('elegibles', v) as ClaveGrafica, etiqueta: `Elegibles que ya habían participado ${etiquetaVeces(v)}`, grupo: 'Elegibles por número de veces', mejor: 'menos' as const, meta: claveVeces('elegibles', v) as string })),
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
  /** Las que entraron sin aviso, y de ellas las que participaban por primera vez. */
  elegibles: number;
  primeraVez: number;
  noElegiblesPorVeces: PorVeces;
  elegiblesPorVeces: PorVeces;
  /** Personas con aviso a las que el equipo dio seguimiento, y de ellas las que se frenaron (no terminaron en un grupo). */
  avisosTrabajados: number;
  avisosRespetados: number;
  pctAvisosRespetados: number | null;
  duplicados: number;
  pctDuplicados: number | null;
}

const sumaVeces = (a: PorVeces): number => VECES.reduce((s, v) => s + a[v], 0);

export function resumir(proyectos: ProyectoReclutamiento[]): ResumenReclutamiento {
  const suma = (f: (p: ProyectoReclutamiento) => number) => proyectos.reduce((s, p) => s + f(p), 0);
  const porVeces = (campo: 'noElegiblesPorVeces' | 'elegiblesPorVeces'): PorVeces =>
    ({ 1: suma((p) => p[campo]?.[1] ?? 0), 2: suma((p) => p[campo]?.[2] ?? 0), 3: suma((p) => p[campo]?.[3] ?? 0), 4: suma((p) => p[campo]?.[4] ?? 0), 5: suma((p) => p[campo]?.[5] ?? 0) });
  const participaron = suma((p) => p.participaron);
  const noElegibles = suma((p) => p.noElegibles);
  const elegibles = participaron - noElegibles;
  const noElegiblesPorVeces = porVeces('noElegiblesPorVeces');
  const elegiblesPorVeces = porVeces('elegiblesPorVeces');
  const avisosTrabajados = suma((p) => p.marcadosTrabajados ?? 0);
  const duplicados = suma((p) => p.duplicados);
  // Las no elegibles que entraron siempre tuvieron seguimiento (entrar lo es), así que son parte de las trabajadas.
  const avisosRespetados = Math.max(0, avisosTrabajados - noElegibles);
  return {
    proyectos: proyectos.length, participaron,
    noElegibles, pctNoElegibles: porcentaje(noElegibles, participaron),
    elegibles, primeraVez: Math.max(0, elegibles - sumaVeces(elegiblesPorVeces)), noElegiblesPorVeces, elegiblesPorVeces,
    avisosTrabajados, avisosRespetados, pctAvisosRespetados: porcentaje(avisosRespetados, avisosTrabajados),
    duplicados, pctDuplicados: porcentaje(duplicados, participaron),
  };
}

/** De cada indicador: el porcentaje, de qué se saca (parte de total) y qué es el total. */
export function valorDe(r: ResumenReclutamiento, clave: ClaveIndicador): { pct: number | null; parte: number; total: number; de: string } {
  switch (clave) {
    case 'noElegibles': return { pct: r.pctNoElegibles, parte: r.noElegibles, total: r.participaron, de: 'personas que entraron' };
    case 'avisosRespetados': return { pct: r.pctAvisosRespetados, parte: r.avisosRespetados, total: r.avisosTrabajados, de: 'personas con aviso y con seguimiento' };
    case 'duplicados': return { pct: r.pctDuplicados, parte: r.duplicados, total: r.participaron, de: 'personas que entraron' };
  }
}

/** Un tramo de un grupo: el porcentaje de ESE grupo (los no elegibles o los elegibles que entraron) que ya había participado esas veces. */
export function valorVeces(r: ResumenReclutamiento, grupo: Grupo, veces: Veces): { pct: number | null; parte: number; total: number } {
  const total = grupo === 'noElegibles' ? r.noElegibles : r.elegibles;
  const parte = (grupo === 'noElegibles' ? r.noElegiblesPorVeces : r.elegiblesPorVeces)[veces];
  return { pct: porcentaje(parte, total), parte, total };
}

/** Las elegibles que entraron por primera vez, como porcentaje de las elegibles. */
export function valorPrimeraVez(r: ResumenReclutamiento): { pct: number | null; parte: number; total: number } {
  return { pct: porcentaje(r.primeraVez, r.elegibles), parte: r.primeraVez, total: r.elegibles };
}

export interface PuntoTrimestre { trimestre: string; parte: number; total: number; pct: number | null }

/** Un indicador (o un tramo de un grupo) trimestre por trimestre, por el trimestre de inicio del proyecto, del más viejo al más nuevo. */
export function porTrimestre(proyectos: ProyectoReclutamiento[], clave: ClaveGrafica): PuntoTrimestre[] {
  const trimestres = new Map<string, ProyectoReclutamiento[]>();
  for (const p of proyectos) {
    const t = `${p.fecha.slice(0, 4)}-T${Math.floor((Number(p.fecha.slice(5, 7)) - 1) / 3) + 1}`;
    const lista = trimestres.get(t);
    if (lista) lista.push(p); else trimestres.set(t, [p]);
  }
  return [...trimestres].sort(([a], [b]) => a.localeCompare(b)).map(([trimestre, lista]) => {
    const resumen = resumir(lista);
    const [grupo, veces] = clave.split('_');
    const { pct, parte, total } = veces
      ? valorVeces(resumen, grupo as Grupo, Number(veces) as Veces)
      : valorDe(resumen, clave as ClaveIndicador);
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
    case 'duplicados': return `${n(v.parte)} de ${n(v.total)} personas que entraron aparecen en más de una fila de su tablero.`;
  }
}
