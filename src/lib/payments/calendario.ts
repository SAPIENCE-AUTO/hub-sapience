// El calendario de pagos: en qué día cae cada pago, qué tan cargado está cada día y cada semana, los vencidos que
// no caben en el mes a la vista, y cómo se agrupa un día por proveedor. Solo cuentas; lo que se pinta está en
// components/payments. Los días se manejan como texto 'YYYY-MM-DD' (ver fechas.ts).
import type { PagoBase, Pestana } from './types';
import {
  diaDeLaSemana, diaDelMes, diasDelMes, lunesDe, mesDe, mesesEntre, nombreMes, nombreMesCorto, sumaDias,
} from './fechas';
import { cmpTexto, fechaDeLaPestana } from './lista';
import { fmtTotales, nombreProveedor, plural } from './formato';
import { totalesPorMoneda, type TotalesMoneda } from './urgencia';

export type Calor = 0 | 1 | 2 | 3 | 4;

/** Cómo se ve un pago según lo que le pasa hoy: el color y el punto que lo acompañan. */
export type EstadoVisual = 'vencido' | 'hoy' | 'porVenir' | 'pagado' | 'cancelado';

export interface ContextoCalendario {
  /** La pestaña decide qué fecha cuenta: en «Pagados» la del pago real, en las demás la comprometida. */
  pestana: Pestana;
  hoy: string;
}

/** Lunes a viernes. El sábado (6) y el domingo (0) solo se agregan si ese mes hay pagos en esos días. */
const LUN_A_VIE = [1, 2, 3, 4, 5];

/** Los días, de lunes (0) a domingo (6), cuentan desde el lunes de su semana. */
const desfase = (diaSemana: number) => (diaSemana + 6) % 7;

// ── Pagos por día ────────────────────────────────────────────────────────────

export interface IndiceDias<T extends PagoBase> {
  /** fecha → los pagos de ese día, por número de ODC. */
  porDia: Map<string, T[]>;
  /** Los pagos que no tienen la fecha que pide la pestaña: no caben en el calendario. */
  sinFecha: T[];
  /** Los días que tienen pagos, del más viejo al más nuevo. */
  fechas: string[];
}

const porOdc = (a: PagoBase, b: PagoBase) =>
  cmpTexto(a.poNumber ?? '', b.poNumber ?? '') || Number(a.paymentId ?? 0) - Number(b.paymentId ?? 0);

export function indexaPorDia<T extends PagoBase>(pagos: ReadonlyArray<T>, pestana: Pestana): IndiceDias<T> {
  const porDia = new Map<string, T[]>();
  const sinFecha: T[] = [];
  for (const p of pagos) {
    const f = fechaDeLaPestana(p, pestana);
    if (!f) {
      sinFecha.push(p);
      continue;
    }
    const lista = porDia.get(f);
    if (lista) lista.push(p);
    else porDia.set(f, [p]);
  }
  for (const lista of porDia.values()) lista.sort(porOdc);
  return { porDia, sinFecha, fechas: [...porDia.keys()].sort() };
}

/** De 0 (sin pagos) a 4 (muchos): la intensidad del color de un día. */
export function calor(n: number): Calor {
  return n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4;
}

export function estadoVisual(p: PagoBase, fecha: string | null, hoy: string): EstadoVisual {
  if (p.status === 'Realizado') return 'pagado';
  if (p.status === 'Cancelado') return 'cancelado';
  if (!fecha) return 'porVenir';
  return fecha < hoy ? 'vencido' : fecha === hoy ? 'hoy' : 'porVenir';
}

export interface DiaCalendario<T extends PagoBase> {
  fecha: string;
  /** Si el día es del mes a la vista; los de las semanas partidas (28 sep en octubre) se ven apagados. */
  enMes: boolean;
  pagos: T[];
  totales: TotalesMoneda;
  calor: Calor;
  /** Cuántos de sus pagos están vencidos (por pagar y con fecha anterior a hoy). */
  vencidos: number;
  esHoy: boolean;
}

function construyeDia<T extends PagoBase>(indice: IndiceDias<T>, fecha: string, mes: string | null, ctx: ContextoCalendario): DiaCalendario<T> {
  const pagos = indice.porDia.get(fecha) ?? [];
  return {
    fecha,
    enMes: mes === null || mesDe(fecha) === mes,
    pagos,
    totales: totalesPorMoneda(pagos),
    calor: calor(pagos.length),
    vencidos: pagos.filter(p => estadoVisual(p, fecha, ctx.hoy) === 'vencido').length,
    esHoy: fecha === ctx.hoy,
  };
}

const diasDeLaSemana = (lunes: string, columnas: ReadonlyArray<number>) => columnas.map(c => sumaDias(lunes, desfase(c)));

// ── El mes ───────────────────────────────────────────────────────────────────

export interface SemanaCalendario<T extends PagoBase> {
  lunes: string;
  /** Solo las columnas a la vista. */
  dias: DiaCalendario<T>[];
  /** Lo que cae en los días de este mes (en una semana partida, el otro mes no cuenta aquí). */
  n: number;
  totales: TotalesMoneda;
  /** '5–9 oct', o '1–2 oct' en una semana partida: los días de este mes. */
  etiqueta: string;
  /** Qué tan cargada está frente a la semana más cargada del mes, de 0 a 1. */
  carga: number;
}

export interface MesCalendario<T extends PagoBase> {
  /** 'YYYY-MM' */
  mes: string;
  /** 1 = lunes … 5 = viernes; 6 = sábado y 0 = domingo solo si ese mes tienen pagos. */
  columnas: number[];
  semanas: SemanaCalendario<T>[];
  n: number;
  totales: TotalesMoneda;
}

export function columnasDelMes(indice: IndiceDias<PagoBase>, mes: string): number[] {
  const columnas = [...LUN_A_VIE];
  const delMes = indice.fechas.filter(f => mesDe(f) === mes);
  if (delMes.some(f => diaDeLaSemana(f) === 6)) columnas.push(6);
  if (delMes.some(f => diaDeLaSemana(f) === 0)) columnas.push(0);
  return columnas;
}

export function construyeMes<T extends PagoBase>(indice: IndiceDias<T>, mes: string, ctx: ContextoCalendario): MesCalendario<T> {
  const columnas = columnasDelMes(indice, mes);
  const primero = `${mes}-01`;
  const ultimo = `${mes}-${String(diasDelMes(mes)).padStart(2, '0')}`;

  const semanas: Omit<SemanaCalendario<T>, 'carga'>[] = [];
  for (let lunes = lunesDe(primero); lunes <= ultimo; lunes = sumaDias(lunes, 7)) {
    const dias = diasDeLaSemana(lunes, columnas).map(f => construyeDia(indice, f, mes, ctx));
    const delMes = dias.filter(d => d.enMes);
    if (delMes.length === 0) continue; // p. ej. un mes que empieza en sábado, sin pagos en fin de semana
    const pagos = delMes.flatMap(d => d.pagos);
    const a = delMes[0].fecha;
    const b = delMes[delMes.length - 1].fecha;
    semanas.push({
      lunes,
      dias,
      n: pagos.length,
      totales: totalesPorMoneda(pagos),
      etiqueta: a === b ? `${diaDelMes(a)} ${nombreMesCorto(a)}` : `${diaDelMes(a)}–${diaDelMes(b)} ${nombreMesCorto(b)}`,
    });
  }

  const masCargada = Math.max(0, ...semanas.map(s => s.n));
  const delMes = indice.fechas.filter(f => mesDe(f) === mes).flatMap(f => indice.porDia.get(f)!);
  return {
    mes,
    columnas,
    semanas: semanas.map(s => ({ ...s, carga: masCargada ? s.n / masCargada : 0 })),
    n: delMes.length,
    totales: totalesPorMoneda(delMes),
  };
}

// ── La semana ────────────────────────────────────────────────────────────────

export interface SemanaVista<T extends PagoBase> {
  lunes: string;
  dias: DiaCalendario<T>[];
  n: number;
  totales: TotalesMoneda;
}

/** Una semana completa de lunes a viernes (más sábado o domingo si esa semana tiene pagos), sin importar el mes. */
export function construyeSemana<T extends PagoBase>(indice: IndiceDias<T>, lunes: string, ctx: ContextoCalendario): SemanaVista<T> {
  const columnas = [...LUN_A_VIE];
  for (const c of [6, 0]) {
    if (indice.porDia.has(sumaDias(lunes, desfase(c)))) columnas.push(c);
  }
  const dias = diasDeLaSemana(lunes, columnas).map(f => construyeDia(indice, f, null, ctx));
  const pagos = dias.flatMap(d => d.pagos);
  return { lunes, dias, n: pagos.length, totales: totalesPorMoneda(pagos) };
}

// ── Vencidos que el periodo a la vista no muestra ────────────────────────────

export interface VencidosPrevios<T extends PagoBase> {
  pagos: T[];
  n: number;
  totales: TotalesMoneda;
  /** La fecha comprometida más vieja. */
  masViejo: string | null;
}

/**
 * Los pagos por pagar que ya vencieron y que no se ven en el periodo a la vista: los de antes de `desde` (el primer día
 * del mes o el lunes de la semana a la vista). Si ese periodo ya es futuro, cuentan todos los vencidos hasta hoy.
 */
export function vencidosPrevios<T extends PagoBase>(pagos: ReadonlyArray<T>, desde: string, ctx: ContextoCalendario): VencidosPrevios<T> {
  const corte = desde < ctx.hoy ? desde : ctx.hoy;
  const previos = pagos.filter(p => {
    const f = fechaDeLaPestana(p, ctx.pestana);
    return f !== null && f < corte && estadoVisual(p, f, ctx.hoy) === 'vencido';
  });
  const fechas = previos.map(p => fechaDeLaPestana(p, ctx.pestana)!).sort();
  return { pagos: previos, n: previos.length, totales: totalesPorMoneda(previos), masViejo: fechas[0] ?? null };
}

// ── El día: pagos por proveedor ──────────────────────────────────────────────

export interface GrupoProveedor<T extends PagoBase> {
  /** El nombre tal como está guardado (dos personas con el mismo nombre se distinguen por el correo pegado). */
  clave: string;
  /** El nombre como se ve en pantalla. */
  nombre: string;
  pagos: T[];
  totales: TotalesMoneda;
}

/** Los pagos de un día juntos por proveedor, del que más recibe al que menos (pesos primero, luego dólares). */
export function agrupaPorProveedor<T extends PagoBase>(pagos: ReadonlyArray<T>): GrupoProveedor<T>[] {
  const mapa = new Map<string, T[]>();
  for (const p of pagos) {
    const k = p.supplierName ?? '';
    const lista = mapa.get(k);
    if (lista) lista.push(p);
    else mapa.set(k, [p]);
  }
  return [...mapa.entries()]
    .map(([clave, lista]) => ({
      clave,
      nombre: clave ? nombreProveedor(clave) : 'Sin proveedor',
      pagos: [...lista].sort(porOdc),
      totales: totalesPorMoneda(lista),
    }))
    .sort((a, b) =>
      (b.totales.MXN?.total ?? 0) - (a.totales.MXN?.total ?? 0)
      || (b.totales.USD?.total ?? 0) - (a.totales.USD?.total ?? 0)
      || cmpTexto(a.nombre, b.nombre));
}

/** Qué pagos interesan primero: los que vienen (en «Por pagar») o los que ya pasaron (en «Pagados»). */
export type Sentido = 'adelante' | 'atras';

export const sentidoDe = (pestana: Pestana): Sentido => (pestana === 'pagados' ? 'atras' : 'adelante');

export interface DiaCercano {
  fecha: string;
  n: number;
  totales: TotalesMoneda;
}

/**
 * El día con pagos más cercano a `desde` (sin contarlo): el siguiente si el sentido es hacia adelante, el último
 * anterior si es hacia atrás. Trae lo que ese día tiene, para avisar «el siguiente día con pagos es…».
 */
export function diaCercano<T extends PagoBase>(indice: IndiceDias<T>, desde: string, sentido: Sentido): DiaCercano | null {
  const fecha = sentido === 'adelante'
    ? indice.fechas.find(f => f > desde)
    : [...indice.fechas].reverse().find(f => f < desde);
  if (!fecha) return null;
  const pagos = indice.porDia.get(fecha)!;
  return { fecha, n: pagos.length, totales: totalesPorMoneda(pagos) };
}

// ── Dónde abre el calendario ─────────────────────────────────────────────────

/**
 * El mes con el que abre: el de hoy si tiene pagos; si no, el más cercano a hoy que sí los tenga (si empatan, el
 * futuro). Sin ningún pago, el de hoy.
 */
export function mesInicial(indice: IndiceDias<PagoBase>, hoy: string): string {
  const actual = mesDe(hoy);
  const meses = [...new Set(indice.fechas.map(mesDe))];
  if (meses.length === 0 || meses.includes(actual)) return actual;
  const distancia = (m: string) => mesesEntre(actual, m);
  return meses.sort((a, b) => Math.abs(distancia(a)) - Math.abs(distancia(b)) || distancia(b) - distancia(a))[0];
}

/**
 * El día que muestra el panel cuando nadie ha elegido uno. En el mes de hoy: hoy si tiene pagos; si no, el día con
 * pagos más cercano en el sentido de la pestaña (el siguiente en «Por pagar», el último en «Pagados»); y si el mes
 * no tiene ninguno, hoy, vacío. En otro mes: el primero que tenga pagos, o null si no tiene.
 */
export function diaPorDefecto<T extends PagoBase>(m: MesCalendario<T>, hoy: string, sentido: Sentido): string | null {
  const visibles = m.semanas.flatMap(s => s.dias).filter(d => d.enMes);
  const conPagos = visibles.filter(d => d.pagos.length > 0);
  if (mesDe(hoy) !== m.mes) return conPagos[0]?.fecha ?? null;
  if (conPagos.some(d => d.fecha === hoy)) return hoy;
  const delante = conPagos.find(d => d.fecha > hoy);
  const detras = [...conPagos].reverse().find(d => d.fecha < hoy);
  const cercano = sentido === 'adelante' ? delante ?? detras : detras ?? delante;
  if (cercano) return cercano.fecha;
  return visibles.find(d => d.fecha >= hoy)?.fecha ?? null;
}

/** El día del panel: el que se eligió si sigue a la vista en este mes; si no, el de siempre. */
export function diaDelPanel<T extends PagoBase>(m: MesCalendario<T>, elegido: string | null, hoy: string, sentido: Sentido): DiaCalendario<T> | null {
  const visibles = m.semanas.flatMap(s => s.dias).filter(d => d.enMes);
  const fecha = elegido && visibles.some(d => d.fecha === elegido) ? elegido : diaPorDefecto(m, hoy, sentido);
  return visibles.find(d => d.fecha === fecha) ?? null;
}

// ── Textos ───────────────────────────────────────────────────────────────────

const ADJETIVO: Record<Pestana, [string, string]> = {
  porPagar: ['por pagar', 'por pagar'],
  pagados: ['realizado', 'realizados'],
  cancelados: ['cancelado', 'cancelados'],
  todos: ['', ''],
};

/** 'Semana del 5 al 9 de octubre', o 'Semana del 28 de septiembre al 2 de octubre' si cruza de mes. */
export function tituloSemana(dias: ReadonlyArray<{ fecha: string }>): string {
  const a = dias[0].fecha;
  const b = dias[dias.length - 1].fecha;
  return `Semana del ${diaDelMes(a)}${mesDe(a) === mesDe(b) ? '' : ` de ${nombreMes(a)}`} al ${diaDelMes(b)} de ${nombreMes(b)}`;
}

/** '53 pagos por pagar · $190,655 + USD 4,600', o 'Sin pagos este mes'. */
export function textoResumen(n: number, totales: TotalesMoneda, pestana: Pestana, periodo: 'mes' | 'semana'): string {
  if (n === 0) return periodo === 'mes' ? 'Sin pagos este mes' : 'Sin pagos esta semana';
  const adjetivo = ADJETIVO[pestana][n === 1 ? 0 : 1];
  return `${plural(n, 'pago')}${adjetivo ? ` ${adjetivo}` : ''} · ${fmtTotales(totales)}`;
}

// ── Color de los días ────────────────────────────────────────────────────────

/** Cuánto del color de la pestaña lleva cada nivel de calor (el resto es blanco). */
export const PORCENTAJE_CALOR: Record<Calor, number> = { 0: 0, 1: 9, 2: 18, 3: 32, 4: 52 };

/** '#1795D3' mezclado con blanco: 52 % deja la mitad del color. Es lo mismo que `color-mix(in srgb, color 52%, white)`. */
export function mezclaConBlanco(hex: string, porcentaje: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const canal = (c: number) => Math.round(255 - (255 - c) * (porcentaje / 100)).toString(16).padStart(2, '0');
  return `#${canal((n >> 16) & 255)}${canal((n >> 8) & 255)}${canal(n & 255)}`;
}
