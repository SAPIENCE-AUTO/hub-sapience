// Adivinar el pilar de un deal a partir del texto libre que tenía en «Tipo de proyecto» («Cuali», «CUALITATIVO», «Cuali + Digital», «Cuali y cuanti»…). Es solo una SUGERENCIA para
// que alguien la acepte: nunca se guarda sola. Lógica pura (sin React ni base). Pruebas: server/scripts/test-pilares-logica.ts.
//
// Criterio: si el texto nombra solo cosas que son pilares del catálogo, se sugieren esos pilares; si trae cualquier otra palabra («Entendimiento de Consumidor», «Otro»,
// «Tipo de proyecto»), no se sugiere nada: mejor que lo decida una persona que adivinar mal.

export interface PilarDelCatalogo {
  id: string;
  nombre: string;
}

export interface Sugerencia {
  pilarIds: string[];
  nombres: string[];
  /** El texto nombra más de un pilar: el reparto de dinero entre ellos no se puede adivinar. */
  mixta: boolean;
}

/** Minúsculas y sin acentos, para comparar. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Cómo se suele escribir a mano cada pilar de arranque. Un pilar creado después se reconoce por su propio nombre.
const ALIAS: Record<string, string[]> = {
  cualitativo: ['cuali', 'cualitativo', 'cualitativa', 'cualitativos', 'cualitativas'],
  cuantitativo: ['cuanti', 'cuantitativo', 'cuantitativa', 'cuantitativos', 'cuantitativas'],
  digital: ['digital', 'digitales', 'online'],
  estrategia: ['estrategia', 'estrategias', 'estrategico', 'estrategica', 'estrategicos'],
};

// Palabras que unen pilares y no cuentan como «otra cosa».
const NEXOS = new Set(['y', 'e', 'mas', 'con']);
// Palabras sueltas que no identifican a un pilar creado después («Unidad de Negocio» se reconoce por «unidad» y «negocio», no por «de»).
const RELLENO = new Set([...NEXOS, 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'para', 'por', 'un', 'una']);

const palabras = (texto: string): string[] => normalizar(texto).split(/[^a-z0-9ñ]+/).filter(Boolean);

function clavesDe(p: PilarDelCatalogo): string[] {
  const propio = normalizar(p.nombre);
  return [...new Set([...(ALIAS[propio] ?? []), ...palabras(p.nombre).filter(w => w.length >= 2 && !RELLENO.has(w))])];
}

/** El pilar (o pilares) que nombra un texto, o null si el texto trae algo que no es un pilar o no trae ninguno. */
export function sugerirDesdeTexto(texto: string | null | undefined, catalogo: PilarDelCatalogo[]): Sugerencia | null {
  if (!texto || !texto.trim()) return null;
  const claves = catalogo.map(p => ({ p, claves: clavesDe(p) }));
  const hallados = new Set<string>();
  for (const w of palabras(texto)) {
    if (NEXOS.has(w)) continue;
    const dueno = claves.find(c => c.claves.includes(w));
    if (!dueno) return null;
    hallados.add(dueno.p.id);
  }
  if (hallados.size === 0) return null;
  const elegidos = catalogo.filter(p => hallados.has(p.id));
  return { pilarIds: elegidos.map(p => p.id), nombres: elegidos.map(p => p.nombre), mixta: elegidos.length > 1 };
}
