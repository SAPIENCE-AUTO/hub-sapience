// Fechas del tablero comercial: todo viaja como texto «AAAA-MM-DD» (así vienen de la base) y se opera en UTC para que la zona horaria no mueva un día.

export type ISO = string;

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MESES_ETIQUETA = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const dos = (n: number) => String(n).padStart(2, '0');

export function iso(y: number, m: number, d: number): ISO {
  return `${y}-${dos(m)}-${dos(d)}`;
}

export function parseISO(s: ISO): { y: number; m: number; d: number } {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** La fecha de hoy según el reloj de quien usa el tablero (no la de UTC). */
export function hoyISO(ahora: Date = new Date()): ISO {
  return iso(ahora.getFullYear(), ahora.getMonth() + 1, ahora.getDate());
}

export function diasEnMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function sumarDias(s: ISO, n: number): ISO {
  const { y, m, d } = parseISO(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Suma meses sin salirse del mes: 31 de enero + 1 mes = 28 (o 29) de febrero. */
export function sumarMeses(s: ISO, n: number): ISO {
  const { y, m, d } = parseISO(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return iso(ny, nm, Math.min(d, diasEnMes(ny, nm)));
}

/** El mismo día de otro año; el 29 de febrero cae en el 28 si ese año no es bisiesto. */
export function sumarAnios(s: ISO, n: number): ISO {
  return sumarMeses(s, 12 * n);
}

/** Días de `a` a `b` (positivo si `b` es posterior). */
export function diasEntre(a: ISO, b: ISO): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export const trimestreDe = (m: number): number => Math.ceil(m / 3);

export function minISO(a: ISO, b: ISO): ISO {
  return a <= b ? a : b;
}

export function maxISO(a: ISO, b: ISO): ISO {
  return a >= b ? a : b;
}

export function esISO(s: unknown): s is ISO {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
}

/** Años que el tablero acepta en una fecha o un periodo escrito a mano o guardado: fuera de esto casi seguro es un error de captura. */
export const ANIO_MIN = 1900;
export const ANIO_MAX = 2200;

/** ¿Es una fecha real «AAAA-MM-DD» (día que existe, año de cuatro cifras entre ANIO_MIN y ANIO_MAX)? Lo que venga después del día (una hora) se ignora. */
export function fechaValida(s: unknown): s is ISO {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}(?!\d)/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return y >= ANIO_MIN && y <= ANIO_MAX && m >= 1 && m <= 12 && d >= 1 && d <= diasEnMes(y, m);
}
