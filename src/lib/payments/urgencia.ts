// Cuánto urge cada pago por pagar: los grupos de la lista (Vencidos, Hoy, Próximos 7 días…), los totales por moneda
// y las tarjetas de arriba. Los grupos no se traslapan: cada pago cae en uno solo.
import type { Moneda, PagoBase } from './types';
import { diasEntre, nombreMes, soloFecha, sumaDias } from './fechas';

export type ClaveGrupo = 'vencidos' | 'hoy' | 'proximos' | 'adelante' | 'sinFecha';

export const DIAS_PROXIMOS = 7;

export const GRUPOS: ReadonlyArray<{ clave: ClaveGrupo; titulo: string }> = [
  { clave: 'vencidos', titulo: 'Vencidos' },
  { clave: 'hoy', titulo: 'Hoy' },
  { clave: 'proximos', titulo: `Próximos ${DIAS_PROXIMOS} días` },
  { clave: 'adelante', titulo: 'Más adelante' },
  { clave: 'sinFecha', titulo: 'Sin fecha' },
];

export type TotalesMoneda = Partial<Record<Moneda, { n: number; total: number }>>;

/** Igual que `fmtCurrency`: todo lo que no sea USD se trata como pesos (un pago sin moneda es MXN). */
export function monedaDe(p: { currency?: string }): Moneda {
  return p.currency === 'USD' ? 'USD' : 'MXN';
}

export function totalesPorMoneda(pagos: ReadonlyArray<PagoBase>): TotalesMoneda {
  const t: TotalesMoneda = {};
  for (const p of pagos) {
    const c = (t[monedaDe(p)] ??= { n: 0, total: 0 });
    c.n += 1;
    c.total += p.amount ?? 0;
  }
  for (const m of ['MXN', 'USD'] as const) {
    const c = t[m];
    if (c) c.total = Math.round(c.total * 100) / 100;
  }
  return t;
}

/** En qué grupo cae un pago por pagar según su fecha comprometida. `hoy` es 'YYYY-MM-DD'. */
export function claveGrupo(dueDate: string | undefined | null, hoy: string): ClaveGrupo {
  const d = soloFecha(dueDate);
  if (!d) return 'sinFecha';
  if (d < hoy) return 'vencidos';
  if (d === hoy) return 'hoy';
  if (d <= sumaDias(hoy, DIAS_PROXIMOS)) return 'proximos';
  return 'adelante';
}

export interface Grupo<T extends PagoBase> {
  clave: ClaveGrupo;
  titulo: string;
  pagos: T[];
  totales: TotalesMoneda;
}

/** Parte la lista en grupos, en orden de urgencia, sin los que quedan vacíos. Respeta el orden en que vienen los pagos. */
export function agrupaPorUrgencia<T extends PagoBase>(pagos: ReadonlyArray<T>, hoy: string): Grupo<T>[] {
  const cubetas = new Map<ClaveGrupo, T[]>();
  for (const p of pagos) {
    const k = claveGrupo(p.dueDate, hoy);
    const lista = cubetas.get(k);
    if (lista) lista.push(p);
    else cubetas.set(k, [p]);
  }
  return GRUPOS.filter(g => cubetas.has(g.clave)).map(g => {
    const lista = cubetas.get(g.clave)!;
    return { clave: g.clave, titulo: g.titulo, pagos: lista, totales: totalesPorMoneda(lista) };
  });
}

export type TonoRelativo = 'vencido' | 'hoy' | 'futuro';

/** «hace 105 días», «hoy», «mañana», «en 3 días». Null si el pago no tiene fecha. */
export function textoRelativo(dueDate: string | undefined | null, hoy: string): { texto: string; tono: TonoRelativo } | null {
  const d = soloFecha(dueDate);
  if (!d) return null;
  const n = diasEntre(hoy, d);
  if (n < 0) return { texto: n === -1 ? 'hace 1 día' : `hace ${-n} días`, tono: 'vencido' };
  if (n === 0) return { texto: 'hoy', tono: 'hoy' };
  if (n === 1) return { texto: 'mañana', tono: 'futuro' };
  return { texto: `en ${n} días`, tono: 'futuro' };
}

export interface Tarjeta {
  n: number;
  totales: TotalesMoneda;
}

export interface ResumenTarjetas {
  porPagar: Tarjeta;
  vencido: Tarjeta;
  /** La fecha comprometida más vieja entre los vencidos. */
  vencidoMasViejo: string | null;
  pagadoMes: Tarjeta;
  nombreMes: string;
}

/** Las tres tarjetas de arriba: lo que falta pagar, lo vencido y lo pagado en el mes en curso (por fecha real de pago). */
export function resumenTarjetas(pagos: ReadonlyArray<PagoBase>, hoy: string): ResumenTarjetas {
  const programados = pagos.filter(p => p.status === 'Programado');
  const vencidos = programados.filter(p => claveGrupo(p.dueDate, hoy) === 'vencidos');
  const mes = hoy.slice(0, 7);
  const pagadosMes = pagos.filter(p => p.status === 'Realizado' && soloFecha(p.paymentDate)?.slice(0, 7) === mes);
  const tarjeta = (l: ReadonlyArray<PagoBase>): Tarjeta => ({ n: l.length, totales: totalesPorMoneda(l) });
  const fechasVencidas = vencidos.map(p => soloFecha(p.dueDate)!).sort();
  return {
    porPagar: tarjeta(programados),
    vencido: tarjeta(vencidos),
    vencidoMasViejo: fechasVencidas[0] ?? null,
    pagadoMes: tarjeta(pagadosMes),
    nombreMes: nombreMes(hoy),
  };
}
