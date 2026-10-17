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
  /** Personas marcadas «no elegible» en este proyecto, hayan entrado o no. */
  marcados: number;
  /** De las que participaron, las que llegaron con 2, 3, 4 o 5 participaciones previas o más (en otros proyectos, antes de este). */
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

export type Previas = 2 | 3 | 4 | 5;
export const OPCIONES_PREVIAS: Previas[] = [2, 3, 4, 5];

export type ClaveIndicador = 'noElegibles' | 'detectados' | 'repetidores' | 'duplicados';

export interface DefinicionIndicador {
  clave: ClaveIndicador;
  etiqueta: string;
  /** Si lo bueno es que baje o que suba: de ahí sale si va en meta. */
  mejor: 'menos' | 'mas';
}

export const INDICADORES: DefinicionIndicador[] = [
  { clave: 'noElegibles', etiqueta: 'No elegibles que entran', mejor: 'menos' },
  { clave: 'detectados', etiqueta: 'Detectados a tiempo', mejor: 'mas' },
  { clave: 'repetidores', etiqueta: 'Repetidores', mejor: 'menos' },
  { clave: 'duplicados', etiqueta: 'Duplicados en el tablero', mejor: 'menos' },
];

/** Con qué clave se guarda la meta: la de repetidores depende de cuántas participaciones previas se cuentan. */
export const claveMeta = (clave: ClaveIndicador, previas: Previas) => (clave === 'repetidores' ? `repetidores_${previas}` : clave);

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
  marcados: number;
  detectados: number;
  pctDetectados: number | null;
  repetidores: number;
  pctRepetidores: number | null;
  duplicados: number;
  pctDuplicados: number | null;
}

export function resumir(proyectos: ProyectoReclutamiento[], previas: Previas): ResumenReclutamiento {
  const suma = (f: (p: ProyectoReclutamiento) => number) => proyectos.reduce((s, p) => s + f(p), 0);
  const participaron = suma((p) => p.participaron);
  const noElegibles = suma((p) => p.noElegibles);
  const marcados = suma((p) => p.marcados);
  const repetidores = suma((p) => p.previas[previas]);
  const duplicados = suma((p) => p.duplicados);
  const detectados = Math.max(0, marcados - noElegibles);
  return {
    proyectos: proyectos.length, participaron,
    noElegibles, pctNoElegibles: porcentaje(noElegibles, participaron),
    marcados, detectados, pctDetectados: porcentaje(detectados, marcados),
    repetidores, pctRepetidores: porcentaje(repetidores, participaron),
    duplicados, pctDuplicados: porcentaje(duplicados, participaron),
  };
}

/** De cada indicador: el porcentaje, de qué se saca (parte de total) y qué es el total. */
export function valorDe(r: ResumenReclutamiento, clave: ClaveIndicador): { pct: number | null; parte: number; total: number; de: string } {
  switch (clave) {
    case 'noElegibles': return { pct: r.pctNoElegibles, parte: r.noElegibles, total: r.participaron, de: 'personas que entraron' };
    case 'detectados': return { pct: r.pctDetectados, parte: r.detectados, total: r.marcados, de: 'personas marcadas «no elegible»' };
    case 'repetidores': return { pct: r.pctRepetidores, parte: r.repetidores, total: r.participaron, de: 'personas que entraron' };
    case 'duplicados': return { pct: r.pctDuplicados, parte: r.duplicados, total: r.participaron, de: 'personas que entraron' };
  }
}

export interface PuntoTrimestre { trimestre: string; participaron: number; noElegibles: number; pct: number | null }

/** Por trimestre de inicio del proyecto, del más viejo al más nuevo: cuántos entraron y cuántos de ellos eran no elegibles. */
export function porTrimestre(proyectos: ProyectoReclutamiento[]): PuntoTrimestre[] {
  const trimestres = new Map<string, { participaron: number; noElegibles: number }>();
  for (const p of proyectos) {
    const clave = `${p.fecha.slice(0, 4)}-T${Math.floor((Number(p.fecha.slice(5, 7)) - 1) / 3) + 1}`;
    const t = trimestres.get(clave) ?? { participaron: 0, noElegibles: 0 };
    t.participaron += p.participaron;
    t.noElegibles += p.noElegibles;
    trimestres.set(clave, t);
  }
  return [...trimestres].sort(([a], [b]) => a.localeCompare(b)).map(([trimestre, t]) => ({ trimestre, ...t, pct: porcentaje(t.noElegibles, t.participaron) }));
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
