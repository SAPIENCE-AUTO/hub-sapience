// Cómo se reparte un deal entre pilares (unidades de negocio): lógica PURA, sin React, sin red y sin base. La usan el servidor (para validar y guardar) y la pantalla (para
// calcular porcentajes y avisos mientras se captura), así los dos dicen lo mismo. Pruebas: server/scripts/test-pilares-logica.ts.
//
// Reglas de fondo:
// - Se capturan MONTOS (en la moneda del deal, pesos casi siempre) y los porcentajes salen de dividir; los porcentajes nunca se guardan.
// - Un deal con UN solo pilar es 100 % de ese pilar sin que haga falta escribir nada: su ingreso es el precio del deal, aunque el precio cambie después.
// - Con dos o más pilares, los ingresos repartidos deben sumar el precio del deal (con $1 de tolerancia por centavos); lo que falte sale como «sin repartir» y lo que
//   sobre se rechaza al guardar. Los costos son opcionales y no tienen que sumar nada: es el costo que quien captura dice que le toca a cada pilar.
// - Todo se calcula en centavos enteros para que las sumas den exacto.

export interface FilaReparto {
  pilarId: string;
  /** Ingreso (parte del precio del deal) de este pilar; null = todavía sin monto. */
  precio: number | null;
  /** Costo de este pilar; null = sin costo capturado. */
  costo: number | null;
}

export type EstadoReparto = 'sin-clasificar' | 'listo' | 'sin-precio' | 'incompleto' | 'excedido';

export interface ResumenReparto {
  estado: EstadoReparto;
  /** Ingreso repartido entre los pilares (con un solo pilar, el precio del deal). */
  asignado: number;
  /** Lo que falta por repartir del precio del deal. */
  falta: number;
  /** Lo que se pasa del precio del deal. */
  sobra: number;
}

export interface PorcentajesFila {
  /** Parte del precio del deal (0 a 100); null si no hay monto o no hay contra qué compararlo. */
  precio: number | null;
  /** Parte del costo repartido entre los pilares (0 a 100); null si esta fila no tiene costo o ningún pilar lo tiene. */
  costo: number | null;
}

/** Cuánto puede diferir lo repartido del precio del deal y seguir contando como completo: un peso (centavos de redondeo al capturar). */
export const TOLERANCIA = 1;

const aCentavos = (n: number): number => Math.round(n * 100 + (n < 0 ? -1e-7 : 1e-7));
const dePesos = (c: number): number => c / 100;

/** Redondea a dos decimales (centavos). */
export function redondear(n: number): number {
  return dePesos(aCentavos(n));
}

const esNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Suma exacta (en centavos) de un campo de las filas; lo vacío cuenta como cero. */
export function sumar(filas: FilaReparto[], campo: 'precio' | 'costo'): number {
  return dePesos(filas.reduce((s, f) => s + (esNumero(f[campo]) ? aCentavos(f[campo] as number) : 0), 0));
}

/** El precio del deal solo sirve para repartir si es un número mayor que cero. */
export const hayPrecio = (precioDeal: number | null | undefined): precioDeal is number => esNumero(precioDeal) && precioDeal > 0;

/** Estado del reparto de un deal contra su precio. */
export function estadoReparto(filas: FilaReparto[], precioDeal: number | null | undefined): ResumenReparto {
  if (filas.length === 0) return { estado: 'sin-clasificar', asignado: 0, falta: 0, sobra: 0 };
  if (filas.length === 1) return { estado: 'listo', asignado: hayPrecio(precioDeal) ? redondear(precioDeal) : 0, falta: 0, sobra: 0 };
  const asignado = sumar(filas, 'precio');
  if (!hayPrecio(precioDeal)) return { estado: 'sin-precio', asignado, falta: 0, sobra: 0 };
  const dif = redondear(precioDeal - asignado);
  if (Math.abs(dif) <= TOLERANCIA) return { estado: 'listo', asignado, falta: 0, sobra: 0 };
  return dif > 0 ? { estado: 'incompleto', asignado, falta: dif, sobra: 0 } : { estado: 'excedido', asignado, falta: 0, sobra: -dif };
}

/** El ingreso que de verdad cuenta cada fila: con un solo pilar, el precio del deal; con varios, lo que se capturó (vacío = 0). */
export function ingresoEfectivo(filas: FilaReparto[], precioDeal: number | null | undefined): number[] {
  if (filas.length === 1) return [hayPrecio(precioDeal) ? redondear(precioDeal) : 0];
  return filas.map(f => (esNumero(f.precio) ? redondear(f.precio) : 0));
}

const aUnDecimal = (x: number): number => Math.round(x * 10) / 10;

/** Porcentajes de cada fila: del ingreso contra el precio del deal (o contra lo repartido si el deal aún no tiene precio) y del costo contra el costo repartido. */
export function porcentajes(filas: FilaReparto[], precioDeal: number | null | undefined): PorcentajesFila[] {
  const ingresos = ingresoEfectivo(filas, precioDeal);
  const repartido = ingresos.reduce((s, x) => s + x, 0);
  const baseIngreso = filas.length === 1 ? (hayPrecio(precioDeal) ? precioDeal : null) : hayPrecio(precioDeal) ? precioDeal : repartido > 0 ? repartido : null;
  const totalCosto = sumar(filas, 'costo');
  return filas.map((f, i) => ({
    precio: filas.length === 1 ? 100 : baseIngreso !== null && esNumero(f.precio) ? aUnDecimal((ingresos[i] / baseIngreso) * 100) : null,
    costo: totalCosto > 0 && esNumero(f.costo) ? aUnDecimal((f.costo / totalCosto) * 100) : null,
  }));
}

/** Parte `total` en `n` montos iguales al centavo: el resto de centavos se va a los primeros. Siempre suman exactamente `total`. */
export function repartoParejo(total: number, n: number): number[] {
  if (n <= 0) return [];
  const c = aCentavos(total);
  const base = Math.floor(c / n);
  const resto = c - base * n;
  return Array.from({ length: n }, (_, i) => dePesos(base + (i < resto ? 1 : 0)));
}

/**
 * Escala los ingresos capturados para que sumen exactamente `precio`, conservando sus proporciones (método del resto mayor, en centavos). Sirve cuando el precio del deal
 * cambió después de repartirlo. Si ningún pilar tiene ingreso, reparte parejo. Los costos no se tocan.
 */
export function reajustarAlPrecio(filas: FilaReparto[], precio: number): FilaReparto[] {
  if (filas.length === 0 || !hayPrecio(precio)) return filas.map(f => ({ ...f }));
  const pesos = filas.map(f => (esNumero(f.precio) && f.precio > 0 ? aCentavos(f.precio) : 0));
  const suma = pesos.reduce((s, x) => s + x, 0);
  if (suma === 0) return repartoParejo(precio, filas.length).map((p, i) => ({ ...filas[i], precio: p }));
  const objetivo = aCentavos(precio);
  const bruto = pesos.map(p => (p * objetivo) / suma);
  const piso = bruto.map(Math.floor);
  let faltan = objetivo - piso.reduce((s, x) => s + x, 0);
  const orden = bruto.map((b, i) => ({ i, resto: b - Math.floor(b) })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of orden) {
    if (faltan <= 0) break;
    piso[i] += 1;
    faltan -= 1;
  }
  return filas.map((f, i) => ({ ...f, precio: dePesos(piso[i]) }));
}

/** Pone en la fila `indice` lo que falta para completar el precio del deal (nunca menos de cero). */
export function completarConLoQueFalta(filas: FilaReparto[], indice: number, precioDeal: number | null | undefined): FilaReparto[] {
  if (!hayPrecio(precioDeal) || indice < 0 || indice >= filas.length) return filas.map(f => ({ ...f }));
  const otros = dePesos(filas.reduce((s, f, i) => s + (i !== indice && esNumero(f.precio) ? aCentavos(f.precio) : 0), 0));
  const falta = Math.max(0, redondear(precioDeal - otros));
  return filas.map((f, i) => (i === indice ? { ...f, precio: falta } : { ...f }));
}

/**
 * Al elegir o quitar pilares: se conservan las filas (y sus montos) de los que siguen elegidos y los nuevos entran sin monto, en el orden del catálogo (`orden`).
 * Con un solo pilar no hace falta monto de ingreso. Si hay dos o más y todavía nadie tiene monto, arranca parejo contra el precio del deal.
 */
export function ponerPilares(actuales: FilaReparto[], elegidos: string[], precioDeal: number | null | undefined, orden: string[]): FilaReparto[] {
  const porId = new Map(actuales.map(f => [f.pilarId, f]));
  const ids = [...new Set(elegidos)].sort((a, b) => {
    const ia = orden.indexOf(a);
    const ib = orden.indexOf(b);
    return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
  });
  let filas: FilaReparto[] = ids.map(id => porId.get(id) ?? { pilarId: id, precio: null, costo: null });
  if (filas.length === 1) return [{ ...filas[0], precio: null }];
  if (filas.length >= 2 && hayPrecio(precioDeal) && filas.every(f => !esNumero(f.precio))) {
    const partes = repartoParejo(precioDeal, filas.length);
    filas = filas.map((f, i) => ({ ...f, precio: partes[i] }));
  }
  return filas;
}

/** Texto corto del tipo de proyecto de un deal a partir de los nombres de sus pilares («Cualitativo + Digital»), en el orden recibido y sin repetir. */
export function resumenTexto(nombres: string[]): string {
  return [...new Set(nombres.map(n => n.trim()).filter(Boolean))].join(' + ');
}
