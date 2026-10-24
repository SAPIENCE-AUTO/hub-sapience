/**
 * Negritas y resaltado en los textos del filtro (pedido de Sergio, 2026-10-24):
 * «**así**» es negrita y «==así==» va en el color de resaltar. Se guardan así,
 * dentro del texto, para que el contrato no cambie: el formulario y el Word
 * los dibujan, y donde va texto simple (columnas del tablero, Excel, flujo,
 * lógica en palabras) se quitan con `sinFormato`.
 *
 * Llevan formato: la pregunta, su ayuda, el texto de contenido, la entrada de
 * la sección, la bienvenida y las dos despedidas. Las opciones y los títulos no.
 */

export interface TramoFormato { texto: string; negrita?: boolean; resaltado?: boolean }
export type Marca = 'negrita' | 'resaltado';

export const MARCAS: Record<Marca, string> = { negrita: '**', resaltado: '==' };

/** El color de resaltar: el morado de Word, distinto del rojo de error, el verde y el azul de las notas. */
export const COLOR_RESALTADO = '#7030A0';

/**
 * Dónde abre y cierra cada marca. Va pegada a las palabras: abre antes de algo
 * que no es espacio y cierra después de algo que no es espacio, con texto
 * adentro. La que no cierra se lee como texto («2 ** 3»).
 */
function cambios(texto: string): Map<number, Marca> {
  const out = new Map<number, Marca>();
  for (const marca of Object.keys(MARCAS) as Marca[]) {
    const m = MARCAS[marca];
    let abre = -1;
    for (let i = texto.indexOf(m); i >= 0; i = texto.indexOf(m, i + 1)) {
      if (abre >= 0 && i >= abre + m.length + 1 && !/\s/.test(texto[i - 1])) {
        out.set(abre, marca);
        out.set(i, marca);
        abre = -1;
        i += m.length - 1;
      } else if (abre < 0 && i + m.length < texto.length && !/\s/.test(texto[i + m.length]) && !texto.startsWith(m, i + m.length)) {
        abre = i;
        i += m.length - 1;
      }
    }
  }
  return out;
}

/** El texto en tramos con su formato. Sin marcas, un solo tramo. */
export function leerFormato(texto: string): TramoFormato[] {
  const marcas = cambios(texto);
  if (!marcas.size) return texto ? [{ texto }] : [];
  const out: TramoFormato[] = [];
  const activo: Record<Marca, boolean> = { negrita: false, resaltado: false };
  let actual = '';
  const cerrar = () => {
    if (actual) out.push({ texto: actual, ...(activo.negrita ? { negrita: true } : {}), ...(activo.resaltado ? { resaltado: true } : {}) });
    actual = '';
  };
  for (let i = 0; i < texto.length;) {
    const marca = marcas.get(i);
    if (marca) {
      cerrar();
      activo[marca] = !activo[marca];
      i += MARCAS[marca].length;
    } else {
      actual += texto[i];
      i++;
    }
  }
  cerrar();
  return out;
}

/** El texto sin las marcas de formato. */
export const sinFormato = (texto: string): string => (texto.includes('**') || texto.includes('==') ? leerFormato(texto).map((t) => t.texto).join('') : texto);

export const tieneFormato = (texto?: string): boolean => !!texto && leerFormato(texto).some((t) => t.negrita || t.resaltado);

/**
 * Pone o quita una marca sobre lo seleccionado en un cuadro de texto. Sin
 * selección toma la palabra donde está el cursor. Si lo seleccionado ya la
 * tiene (por dentro o por fuera), la quita. Devuelve el texto y la selección
 * nueva (lo mismo, ya con o sin la marca).
 */
export function alternarMarca(valor: string, inicio: number, fin: number, marca: Marca): { valor: string; inicio: number; fin: number } {
  const m = MARCAS[marca];
  let a = inicio;
  let b = fin;
  if (a === b) {
    while (a > 0 && /[\p{L}\p{N}]/u.test(valor[a - 1])) a--;
    while (b < valor.length && /[\p{L}\p{N}]/u.test(valor[b])) b++;
    if (a === b) return { valor, inicio, fin };
  }
  // Los espacios de las orillas quedan fuera: la marca va pegada a las palabras.
  while (a < b && /\s/.test(valor[a])) a++;
  while (b > a && /\s/.test(valor[b - 1])) b--;
  if (a === b) return { valor, inicio, fin };

  const sel = valor.slice(a, b);
  // Ya marcado por fuera: «**palabra**» con «palabra» seleccionada.
  if (valor.slice(a - m.length, a) === m && valor.slice(b, b + m.length) === m) {
    return { valor: valor.slice(0, a - m.length) + sel + valor.slice(b + m.length), inicio: a - m.length, fin: b - m.length };
  }
  // Seleccionado con todo y marcas.
  if (sel.length > 2 * m.length && sel.startsWith(m) && sel.endsWith(m)) {
    const dentro = sel.slice(m.length, -m.length);
    return { valor: valor.slice(0, a) + dentro + valor.slice(b), inicio: a, fin: a + dentro.length };
  }
  return { valor: valor.slice(0, a) + m + sel + m + valor.slice(b), inicio: a + m.length, fin: b + m.length };
}
