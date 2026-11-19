// Buscar texto dentro de una transcripción (como en Sharpli): sin importar mayúsculas ni acentos, con todas las coincidencias numeradas en orden
// para ir de una a otra. Las posiciones se calculan sobre el mismo texto que se ve en pantalla (las palabras de cada turno unidas por un espacio).

export interface Rango { inicio: number; fin: number }
export interface MarcaPalabra { coincide: boolean; indice: number; ancla: boolean }

/**
 * El texto en minúsculas y sin acentos (la ñ se conserva: «año» no es «ano»), con exactamente el mismo largo, para que una posición
 * encontrada en el texto plegado sea la misma en el original.
 */
export function plegar(texto: string): string {
  let salida = '';
  for (const c of texto) {
    if (c === 'ñ' || c === 'Ñ') { salida += 'ñ'; continue; }
    const base = c.normalize('NFD')[0] ?? c;
    const bajo = base.toLowerCase();
    salida += bajo.length === c.length ? bajo : c;
  }
  return salida;
}

/**
 * Cada coincidencia de `consulta` en cada texto (sin traslapes). `desde[i]` es cuántas coincidencias hay antes del texto i: el número
 * global de la k-ésima coincidencia del texto i es `desde[i] + k`.
 */
export function buscarEnTextos(textos: string[], consulta: string): { porTexto: Rango[][]; desde: number[]; total: number } {
  const q = plegar(consulta).replace(/\s+/g, ' ').trim();
  const porTexto: Rango[][] = [];
  const desde: number[] = [];
  let total = 0;
  for (const texto of textos) {
    desde.push(total);
    const rangos: Rango[] = [];
    if (q) {
      const t = plegar(texto);
      let pos = 0;
      for (let i = t.indexOf(q, pos); i !== -1; i = t.indexOf(q, pos)) {
        rangos.push({ inicio: i, fin: i + q.length });
        pos = i + q.length;
      }
    }
    total += rangos.length;
    porTexto.push(rangos);
  }
  return { porTexto, desde, total };
}

/**
 * Qué palabras de un turno entran en alguna coincidencia: `indice` es el número global de la coincidencia y `ancla` marca la primera
 * palabra de cada una (a donde se desplaza la pantalla).
 */
export function marcarPalabras(palabras: Rango[], rangos: Rango[], primerIndice: number): MarcaPalabra[] {
  const marcas: MarcaPalabra[] = palabras.map(() => ({ coincide: false, indice: -1, ancla: false }));
  rangos.forEach((r, k) => {
    let primera = true;
    palabras.forEach((p, i) => {
      if (p.inicio < r.fin && p.fin > r.inicio) {
        marcas[i] = { coincide: true, indice: primerIndice + k, ancla: primera };
        primera = false;
      }
    });
  });
  return marcas;
}

/** Dónde empieza y termina cada palabra en el texto que resulta de unirlas con un espacio. */
export function posicionesDePalabras(palabras: string[]): Rango[] {
  let pos = 0;
  return palabras.map((p) => {
    const r = { inicio: pos, fin: pos + p.length };
    pos += p.length + 1;
    return r;
  });
}
