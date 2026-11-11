// Texto del buscador de gente («¿en qué filtros hay consumidores de Corona?»): normalizar para comparar sin acentos ni mayúsculas, partir una respuesta de varias opciones en sus piezas, tapar
// el término de la búsqueda en el nombre de una pregunta (para juntar la misma pregunta de distintos tableros) y reconocer las columnas que son datos de una persona (esas nunca se leen).
// Todo es puro (sin base ni red): lo usan el catálogo, la búsqueda y las pruebas.

/** «Levité» → «levite»: minúsculas, sin acentos y con espacios sencillos. */
export function normalizarTexto(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Una pieza de una respuesta: sin acentos, sin viñetas ni «1.» al principio, sin signos de puntuación en los bordes. «1) Corona » → «corona». */
export function limpiarPieza(texto: unknown): string {
  let s = normalizarTexto(texto);
  s = s.replace(/^(?:[-*•·]+|\d{1,2}\s*[.)\-:])\s*/, '');
  // Solo se quitan los signos de puntuación de los bordes (no un paréntesis que cierra: «bohemia (vienna, weizen)» queda completa).
  s = s.replace(/^[\s.,;:!?¡¿…"'“”‘’`´_*•·\-]+|[\s.,;:!?¡¿…"'“”‘’`´_*•·\-]+$/gu, '');
  return s.trim();
}

/** Como `limpiarPieza`, pero conservando los acentos: es el texto que se le muestra a la persona («la dejé de consumir…»). */
export function limpiarEtiqueta(texto: unknown): string {
  let s = String(texto ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:[-*•·]+|\d{1,2}\s*[.)\-:])\s*/, '');
  s = s.replace(/^[\s.,;:!?¡¿…"'“”‘’`´_*•·\-]+|[\s.,;:!?¡¿…"'“”‘’`´_*•·\-]+$/gu, '');
  return s.trim();
}

/** «es mi top / favorita» → «Es mi top / favorita». */
export const capitalizar = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase('es-MX') + s.slice(1) : s);

/** Más largo que esto ya no es una opción de respuesta sino una oración. */
export const MAX_LARGO_PIEZA = 80;

/**
 * Parte una respuesta de varias opciones («Corona, Modelo\nVictoria») en sus piezas, en el orden en que vienen (la primera es la «favorita» en un ranking). No parte lo que está entre paréntesis
 * («Bohemia (Vienna, Weizen)» es una pieza). Cada pieza sale una sola vez.
 */
export function partirPiezas(texto: unknown): string[] {
  const crudas: string[] = [];
  let actual = '';
  let profundidad = 0;
  for (const ch of String(texto ?? '')) {
    if (ch === '(') profundidad++;
    else if (ch === ')') profundidad = Math.max(0, profundidad - 1);
    if (profundidad === 0 && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r' || ch === '|' || ch === '•')) { crudas.push(actual); actual = ''; } else actual += ch;
  }
  crudas.push(actual);
  const vistas = new Set<string>();
  for (const c of crudas) {
    const p = limpiarPieza(c);
    if (p && p.length <= MAX_LARGO_PIEZA) vistas.add(p);
  }
  return [...vistas];
}

/** Lo que tiene que ser verdad de un término para buscarlo: al menos dos letras o números. */
export const esTerminoValido = (termino: string): boolean => (termino.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2;

/**
 * El nombre de una pregunta con el término tapado: «levite (priorizacion marcas)» buscando «levite» → ««…» (priorizacion marcas)». Así «Takis (Priorización marcas)» y «Levité (Priorización marcas)»
 * son la misma pregunta con otra marca, y se juntan las de todos los tableros. Si el término no está en el nombre, el nombre queda igual.
 */
export function plantillaDe(nombreNormalizado: string, terminoNormalizado: string): string {
  if (!terminoNormalizado) return nombreNormalizado;
  return nombreNormalizado.split(terminoNormalizado).join('«…»');
}

/** Los tipos de columna de un tablero que pueden ser una pregunta (el resto son archivos, ligas, fechas, personas, botones…). */
export const TIPOS_DE_PREGUNTA = new Set(['Texto', 'Select', 'Número', 'Status']);

// Columnas que son datos de una persona o de su casa, o nombres de personas (los reclutadores, quien invitó): nunca se leen ni se guardan sus respuestas. El nombre de la columna tiene que EMPEZAR así (no basta que
// lo contenga: «¿cuál es el nombre de la marca que más compras?» sí es una pregunta), salvo unas frases que dicen que la respuesta es de la persona («escribe tu dirección»).
const PERSONAL = /^(nombre|apellidos?|telefono|tel\b|celular|whatsapp|correo|e-?mail|email|mail|direccion|domicilio|calle|colonia|codigo postal|cp\b|identificacion|folio|curp|rfc|ine\b|clave de elector|fecha de nacimiento|aviso de privacidad|firma|nr\b|reclutador|quien (te )?invito|quien lo invito|quien te (recomendo|refirio)|referido por|recomendado por)/;
const PERSONAL_EN_CUALQUIER_PARTE = /(tu direccion|tu domicilio|direccion completa|como te llamas|tu nombre completo)/;
/** ¿La columna es un dato personal (por su nombre)? */
export const esColumnaPersonal = (nombre: string): boolean => {
  // Sin los «¿», «¡», comillas o viñetas del principio: «¿Quién te invitó?» es lo mismo que «Quién te invitó».
  const n = normalizarTexto(nombre).replace(/^[^\p{L}\p{N}]+/u, '');
  return PERSONAL.test(n) || PERSONAL_EN_CUALQUIER_PARTE.test(n);
};

// Aunque la columna tenga un nombre inocente, a veces trae datos de una persona en sus respuestas (una importación desalineada, alguien que escribió su teléfono donde iba otra cosa). Esas respuestas nunca se guardan.
const CORREO = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/;
const LIGA = /(https?:\/\/|www\.)/;
const USUARIO_DE_RED = /^@[a-z0-9._]{3,}/;
const CLAVE_CURP_RFC = /^[a-z]{4}\d{6}[a-z0-9]{0,8}$/;
/** Una respuesta con 7 o más dígitos en una sola pieza es un teléfono, una clave o una cantidad: no sirve para buscar gente y no se guarda. */
export const MIN_DIGITOS_DE_DATO_PERSONAL = 7;
/**
 * ¿La respuesta trae un dato de una persona (correo, teléfono o número largo, liga o usuario de red, clave tipo CURP o RFC)? Si es una lista se revisa pieza por pieza, así que «355 ml, 600 ml, 1 l» no cuenta como un número largo.
 */
export function esPiezaPersonal(texto: unknown): boolean {
  const s = normalizarTexto(texto);
  if (!s) return false;
  return s.split(/[,;\n\r|•]+/).map((p) => p.trim()).filter(Boolean).some((p) =>
    CORREO.test(p) || LIGA.test(p) || USUARIO_DE_RED.test(p) || CLAVE_CURP_RFC.test(p.replace(/\s/g, '')) || (p.match(/\d/g) ?? []).length >= MIN_DIGITOS_DE_DATO_PERSONAL);
}

/** Una columna entra al catálogo si puede ser una pregunta y no es un dato personal. */
export const entraAlCatalogo = (tipo: string | null | undefined, nombre: string | null | undefined): boolean =>
  !!nombre && TIPOS_DE_PREGUNTA.has(String(tipo ?? '')) && !esColumnaPersonal(nombre);

// Cuántos textos distintos puede tener una columna para tratarla «de valores» (opciones que se repiten, como «Es mi top / favorita»); más que eso es de «lista» (cada persona escribió lo suyo y se
// parte en piezas) o texto libre.
export const MAX_VALORES_DISTINTOS = 40;
export type ModoDeColumna = 'valores' | 'lista';
/** «De valores»: pocos textos distintos y cada uno se repite en promedio dos veces o más. Si no, «de lista». */
export function modoDeColumna(respondieron: number, distintos: number): ModoDeColumna {
  return distintos <= MAX_VALORES_DISTINTOS && distintos * 2 <= respondieron ? 'valores' : 'lista';
}

/** Una respuesta que aparece en menos filas que esto no se guarda: así nada identifica a una sola persona. */
export const MIN_FILAS_POR_PIEZA = 3;
/** Cuántas respuestas distintas se guardan por pregunta (las que más se repiten). */
export const MAX_PIEZAS_POR_COLUMNA = 100;
