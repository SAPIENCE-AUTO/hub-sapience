// Periodos del tablero y cómo se comparan. La comparación NO es un valor fijo: es una elección de quien usa el tablero (sin comparar, misma fecha del año
// pasado, año pasado completo, periodo anterior u otro rango), y siempre devuelve los rangos exactos que compara para poder escribirlos en pantalla.
import {
  ISO, iso, parseISO, sumarDias, sumarMeses, sumarAnios, diasEntre, diasEnMes, minISO, MESES_ETIQUETA, trimestreDe,
} from './fechas';

/** Rango de fechas con los dos extremos incluidos. */
export interface Rango {
  inicio: ISO;
  fin: ISO;
}

export type Periodo =
  | { modo: 'todo' }
  | { modo: 'anio'; anio: number }
  | { modo: 'trimestre'; anio: number; trimestre: number }
  | { modo: 'mes'; anio: number; mes: number }
  | { modo: 'rango'; inicio?: ISO; fin?: ISO }
  | { modo: 'ultimos'; cantidad: number; unidad: 'dias' | 'meses' };

export type Comparacion =
  | { modo: 'ninguna' }
  /** El mismo tramo del año pasado, hasta la misma fecha de corte (1 ene–23 oct de este año contra 1 ene–23 oct del anterior). */
  | { modo: 'mismaFecha' }
  /** El mismo periodo del año pasado, completo (lo que hacía el KPI de antes: el año en curso contra todo el año anterior). */
  | { modo: 'anioCompleto' }
  /** El periodo inmediato anterior: el mes, trimestre o año previo; o, en un rango, otro igual de largo justo antes. */
  | { modo: 'anterior' }
  | { modo: 'rango'; inicio?: ISO; fin?: ISO };

export const SIN_COMPARAR: Comparacion = { modo: 'ninguna' };

export interface PeriodosResueltos {
  /** Rango del periodo actual; null = todo el historial (sin filtro de fechas). */
  actual: Rango | null;
  /** Rango contra el que se compara; null = no se compara. */
  previo: Rango | null;
  etiquetaActual: string;
  etiquetaPrevio: string | null;
  /** Por qué no se pudo comparar (p. ej. el periodo es «todo el historial»), para decirlo en pantalla. */
  aviso?: string;
}

const mes = (m: number) => (MESES_ETIQUETA[m - 1] ?? '?').toLowerCase();

/** Rango de un periodo. `hoy` solo importa para «últimos N». */
export function rangoDe(p: Periodo, hoy: ISO): Rango | null {
  switch (p.modo) {
    case 'todo':
      return null;
    case 'anio':
      return { inicio: iso(p.anio, 1, 1), fin: iso(p.anio, 12, 31) };
    case 'trimestre': {
      const m0 = (p.trimestre - 1) * 3 + 1;
      return { inicio: iso(p.anio, m0, 1), fin: iso(p.anio, m0 + 2, diasEnMes(p.anio, m0 + 2)) };
    }
    case 'mes':
      return { inicio: iso(p.anio, p.mes, 1), fin: iso(p.anio, p.mes, diasEnMes(p.anio, p.mes)) };
    case 'rango': {
      if (!p.inicio || !p.fin) return null;
      return p.inicio <= p.fin ? { inicio: p.inicio, fin: p.fin } : { inicio: p.fin, fin: p.inicio };
    }
    case 'ultimos': {
      const n = Math.max(1, Math.floor(p.cantidad));
      if (p.unidad === 'dias') return { inicio: sumarDias(hoy, -(n - 1)), fin: hoy };
      return { inicio: sumarDias(sumarMeses(hoy, -n), 1), fin: hoy };
    }
  }
}

/** El periodo inmediato anterior, completo. */
export function periodoAnterior(p: Periodo, hoy: ISO): Rango | null {
  switch (p.modo) {
    case 'todo':
      return null;
    case 'anio':
      return rangoDe({ modo: 'anio', anio: p.anio - 1 }, hoy);
    case 'trimestre':
      return p.trimestre === 1
        ? rangoDe({ modo: 'trimestre', anio: p.anio - 1, trimestre: 4 }, hoy)
        : rangoDe({ modo: 'trimestre', anio: p.anio, trimestre: p.trimestre - 1 }, hoy);
    case 'mes':
      return p.mes === 1
        ? rangoDe({ modo: 'mes', anio: p.anio - 1, mes: 12 }, hoy)
        : rangoDe({ modo: 'mes', anio: p.anio, mes: p.mes - 1 }, hoy);
    case 'rango':
    case 'ultimos': {
      const r = rangoDe(p, hoy);
      if (!r) return null;
      const largo = diasEntre(r.inicio, r.fin) + 1;
      return { inicio: sumarDias(r.inicio, -largo), fin: sumarDias(r.inicio, -1) };
    }
  }
}

/** Un fin de mes cae en el fin de mes del otro año (28 de feb de 2025 ↔ 29 de feb de 2024); cualquier otro día, en el mismo día. */
const finDesplazado = (f: ISO, n: number): ISO => {
  const { y, m, d } = parseISO(f);
  return d === diasEnMes(y, m) ? iso(y + n, m, diasEnMes(y + n, m)) : sumarAnios(f, n);
};
const desplazarAnio = (r: Rango, n: number): Rango => ({ inicio: sumarAnios(r.inicio, n), fin: finDesplazado(r.fin, n) });

/** Convierte «periodo + cómo comparar» en los rangos exactos de cada lado. */
export function resolverPeriodos(p: Periodo, c: Comparacion, hoy: ISO): PeriodosResueltos {
  const completo = rangoDe(p, hoy);
  if (!completo) {
    return {
      actual: null, previo: null,
      etiquetaActual: p.modo === 'rango' ? 'Elige las fechas' : 'Todo el historial',
      etiquetaPrevio: null,
      aviso: c.modo === 'ninguna' ? undefined : 'Elige un periodo con fechas para poder comparar.',
    };
  }
  const etiquetaActual = etiquetaRango(completo);
  if (c.modo === 'ninguna') return { actual: completo, previo: null, etiquetaActual, etiquetaPrevio: null };

  if (c.modo === 'mismaFecha') {
    if (completo.inicio > hoy) {
      return { actual: completo, previo: null, etiquetaActual, etiquetaPrevio: null, aviso: 'Ese periodo todavía no empieza.' };
    }
    const alCorte: Rango = { inicio: completo.inicio, fin: minISO(completo.fin, hoy) };
    // Periodo ya terminado: fin de periodo contra fin de periodo (feb de 2025 contra los 29 días de feb de 2024). Si el corte es hoy: el mismo día del año pasado.
    const previo = alCorte.fin === completo.fin
      ? desplazarAnio(alCorte, -1)
      : { inicio: sumarAnios(alCorte.inicio, -1), fin: sumarAnios(alCorte.fin, -1) };
    return { actual: alCorte, previo, etiquetaActual: etiquetaRango(alCorte), etiquetaPrevio: etiquetaRango(previo) };
  }

  if (c.modo === 'anioCompleto') {
    const previo = desplazarAnio(completo, -1);
    return { actual: completo, previo, etiquetaActual, etiquetaPrevio: etiquetaRango(previo) };
  }

  if (c.modo === 'anterior') {
    const previo = periodoAnterior(p, hoy);
    if (!previo) return { actual: completo, previo: null, etiquetaActual, etiquetaPrevio: null, aviso: 'No hay un periodo anterior para comparar.' };
    return { actual: completo, previo, etiquetaActual, etiquetaPrevio: etiquetaRango(previo) };
  }

  // rango elegido a mano
  const previo = c.inicio && c.fin ? (c.inicio <= c.fin ? { inicio: c.inicio, fin: c.fin } : { inicio: c.fin, fin: c.inicio }) : null;
  if (!previo) return { actual: completo, previo: null, etiquetaActual, etiquetaPrevio: null, aviso: 'Elige las fechas contra las que comparar.' };
  return { actual: completo, previo, etiquetaActual, etiquetaPrevio: etiquetaRango(previo) };
}

/** «2026», «Oct 2026», «Q3 2026», «1–23 oct 2026», «1 ene–23 oct 2026» o «1 oct 2025–23 ene 2026». */
export function etiquetaRango(r: Rango): string {
  const a = parseISO(r.inicio);
  const b = parseISO(r.fin);
  const finDeMes = (y: number, m: number, d: number) => d === diasEnMes(y, m);
  if (a.y === b.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31) return String(a.y);
  if (a.y === b.y && a.m === b.m && a.d === 1 && finDeMes(b.y, b.m, b.d)) return `${MESES_ETIQUETA[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.d === 1 && (a.m - 1) % 3 === 0 && b.m === a.m + 2 && finDeMes(b.y, b.m, b.d)) return `Q${trimestreDe(a.m)} ${a.y}`;
  if (a.y === b.y) {
    return a.m === b.m ? `${a.d}–${b.d} ${mes(b.m)} ${b.y}` : `${a.d} ${mes(a.m)}–${b.d} ${mes(b.m)} ${b.y}`;
  }
  return `${a.d} ${mes(a.m)} ${a.y}–${b.d} ${mes(b.m)} ${b.y}`;
}

export function etiquetaComparacion(c: Comparacion): string {
  switch (c.modo) {
    case 'ninguna': return 'Sin comparar';
    case 'mismaFecha': return 'Misma fecha del año pasado';
    case 'anioCompleto': return 'Año pasado completo';
    case 'anterior': return 'Periodo anterior';
    case 'rango': return 'Otro rango';
  }
}

export function etiquetaPeriodo(p: Periodo, hoy: ISO): string {
  if (p.modo === 'todo') return 'Todo el historial';
  if (p.modo === 'ultimos') return `Últimos ${p.cantidad} ${p.unidad === 'dias' ? 'días' : 'meses'}`;
  const r = rangoDe(p, hoy);
  return r ? etiquetaRango(r) : 'Elige las fechas';
}
