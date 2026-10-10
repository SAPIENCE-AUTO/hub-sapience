// Qué pagos se ven en cada pestaña y en qué orden: filtro por estado, orden de las columnas, búsqueda (con la ODC
// tolerante a cómo la escriba cada quien) y los meses para la pestaña de pagados.
import type { PagoBase, Pestana } from './types';
import { etiquetaMes, soloFecha } from './fechas';
import { monedaDe } from './urgencia';

export const ESTADO_DE_PESTANA: Record<Pestana, string | null> = {
  porPagar: 'Programado',
  pagados: 'Realizado',
  cancelados: 'Cancelado',
  todos: null,
};

export function filtraPorPestana<T extends PagoBase>(pagos: ReadonlyArray<T>, pestana: Pestana): T[] {
  const estado = ESTADO_DE_PESTANA[pestana];
  return estado ? pagos.filter(p => p.status === estado) : [...pagos];
}

export function contarPorPestana(pagos: ReadonlyArray<PagoBase>): Record<Pestana, number> {
  return {
    porPagar: pagos.filter(p => p.status === 'Programado').length,
    pagados: pagos.filter(p => p.status === 'Realizado').length,
    cancelados: pagos.filter(p => p.status === 'Cancelado').length,
    todos: pagos.length,
  };
}

// ── Orden ────────────────────────────────────────────────────────────────────

export type ClaveOrden = 'odc' | 'monto' | 'fecha';
export interface Orden {
  clave: ClaveOrden;
  dir: 'asc' | 'desc';
}

/** Por pagar: lo más urgente primero. Las demás: lo más reciente primero. */
export function ordenPorDefecto(pestana: Pestana): Orden {
  return { clave: 'fecha', dir: pestana === 'porPagar' ? 'asc' : 'desc' };
}

/** La fecha que muestra la columna de fecha: en pagados la del pago real, en las demás la comprometida. */
export function fechaDeLaPestana(p: PagoBase, pestana: Pestana): string | null {
  return soloFecha(pestana === 'pagados' ? p.paymentDate : p.dueDate);
}

export const cmpTexto = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });

// Los vacíos van siempre al final, sin importar si el orden es ascendente o descendente.
function cmpConVacios<V>(a: V | null, b: V | null, cmp: (x: V, y: V) => number, signo: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return signo * cmp(a, b);
}

export function ordenaPagos<T extends PagoBase>(pagos: ReadonlyArray<T>, orden: Orden, pestana: Pestana): T[] {
  const signo = orden.dir === 'asc' ? 1 : -1;
  const porClave = (a: T, b: T): number => {
    switch (orden.clave) {
      case 'fecha':
        return cmpConVacios(fechaDeLaPestana(a, pestana), fechaDeLaPestana(b, pestana), (x, y) => (x < y ? -1 : x > y ? 1 : 0), signo);
      case 'odc':
        return cmpConVacios(a.poNumber || null, b.poNumber || null, cmpTexto, signo);
      case 'monto': {
        // Pesos con pesos y dólares con dólares: ordenar 450 USD contra 6,543 MXN por el número solo no tiene sentido.
        const cmp = (x: T, y: T) => (monedaDe(x) !== monedaDe(y) ? (monedaDe(x) === 'MXN' ? -1 : 1) : (x.amount ?? 0) - (y.amount ?? 0));
        return cmpConVacios(a.amount == null ? null : a, b.amount == null ? null : b, cmp, signo);
      }
    }
  };
  return [...pagos].sort((a, b) =>
    porClave(a, b)
    || cmpConVacios(soloFecha(a.dueDate), soloFecha(b.dueDate), (x, y) => (x < y ? -1 : x > y ? 1 : 0), 1)
    || cmpTexto(a.poNumber ?? '', b.poNumber ?? '')
    || Number(a.paymentId ?? 0) - Number(b.paymentId ?? 0));
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

export function normaliza(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * La ODC sin importar cómo se escriba: 'RI-01234', 'ODC-RI-01234', 'ri 1234' y 'RI 1234' (como sale en el concepto del
 * banco) dan todas 'ri1234'. Así buscar «RI 1234» encuentra «RI-01234».
 */
export function claveOdc(s?: string | null): string {
  if (!s) return '';
  const t = normaliza(s).replace(/^odc[\s-]*/, '').replace(/[^a-z0-9]/g, '');
  const m = t.match(/^([a-z]+)0*(\d+)$/);
  return m ? m[1] + m[2] : t;
}

export function coincideBusqueda(p: PagoBase, consulta: string): boolean {
  const q = normaliza(consulta.trim());
  if (!q) return true;
  const campos = [p.paymentId != null ? String(p.paymentId) : '', p.supplierName, p.reference, p.projectCode, p.poNumber, p.supplierInvoiceNumber, p.sourceCompany];
  if (campos.some(c => c && normaliza(c).includes(q))) return true;
  const qo = claveOdc(consulta);
  return qo !== '' && claveOdc(p.poNumber).includes(qo);
}

// ── Meses de la pestaña de pagados ───────────────────────────────────────────

export interface OpcionMes {
  valor: string; // 'YYYY-MM'
  etiqueta: string; // 'Octubre 2026'
  n: number;
}

/** Los meses en que hay pagos realizados (por fecha real de pago), del más reciente al más viejo. */
export function opcionesMes(pagos: ReadonlyArray<PagoBase>): OpcionMes[] {
  const cuenta = new Map<string, number>();
  for (const p of pagos) {
    if (p.status !== 'Realizado') continue;
    const mes = soloFecha(p.paymentDate)?.slice(0, 7);
    if (mes) cuenta.set(mes, (cuenta.get(mes) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([valor, n]) => ({ valor, etiqueta: etiquetaMes(valor), n }));
}
