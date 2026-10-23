/**
 * «¿Quisiste decir …@gmail.com?»: si el dominio de un correo se parece a uno
 * de los que más se usan en México pero no es igual (gmial.com, hotmail.co,
 * outlok.com, «gmail» sin .com), se sugiere el bueno. No corrige solo.
 */
const DOMINIOS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.mx', 'hotmail.es', 'outlook.es',
  'live.com', 'live.com.mx', 'icloud.com', 'prodigy.net.mx',
];

/** Cuántas letras hay que cambiar, quitar o poner para pasar de una palabra a otra. */
function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const arriba = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = arriba;
    }
  }
  return fila[b.length];
}

export function sugerirCorreo(correo: string): string | undefined {
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(correo.trim().toLowerCase());
  if (!m) return undefined;
  const [, usuario, dominio] = m;
  if (DOMINIOS.includes(dominio)) return undefined;
  const sinPunto = !dominio.includes('.');
  let mejor: string | undefined;
  let menor = 3;
  for (const d of DOMINIOS) {
    const x = sinPunto ? distancia(dominio, d.split('.')[0]) : distancia(dominio, d);
    if (x < menor) { menor = x; mejor = d; }
  }
  // Sin «.com» basta con que el nombre se parezca mucho («gmail», «hotmal»); con él, hasta dos letras.
  return mejor && menor <= (sinPunto ? 1 : 2) ? `${usuario}@${mejor}` : undefined;
}
