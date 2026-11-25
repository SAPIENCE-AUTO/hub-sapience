// Los pilares (unidades de negocio) con los que arranca el catálogo y los colores que se ofrecen al crear uno nuevo. El catálogo de verdad vive en la tabla `pilares`
// (se pueden crear, renombrar y desactivar desde la pantalla de Pilares); esto solo es el punto de partida. Los colores nunca van solos: cada pilar siempre se
// muestra con su nombre (hay personas en el equipo que no distinguen algunos colores).

export interface PilarDeArranque {
  nombre: string;
  color: string;
}

export const PILARES_DE_ARRANQUE: PilarDeArranque[] = [
  { nombre: 'Cualitativo', color: '#027495' },
  { nombre: 'Cuantitativo', color: '#D4A017' },
  { nombre: 'Digital', color: '#4B5BA8' },
  { nombre: 'Estrategia', color: '#3F8F5B' },
];

/** Colores que se ofrecen para un pilar nuevo (los de arranque primero, luego otros que se distinguen entre sí). */
export const PALETA_PILARES = ['#027495', '#D4A017', '#4B5BA8', '#3F8F5B', '#A2467C', '#C2553A', '#5B6770', '#8A6A3B'];

export const COLOR_SIN_ELEGIR = '#5B6770';

export const esColorValido = (c: unknown): c is string => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);

/** El primer color de la paleta que ningún pilar usa todavía; si ya se usaron todos, vuelve a empezar. */
export function colorSiguiente(usados: string[]): string {
  const en = new Set(usados.map(c => c.toLowerCase()));
  return PALETA_PILARES.find(c => !en.has(c.toLowerCase())) ?? PALETA_PILARES[usados.length % PALETA_PILARES.length];
}

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 40;
