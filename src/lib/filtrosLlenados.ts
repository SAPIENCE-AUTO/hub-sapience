// «Cuántos filtros ha llenado» una persona (pedido de Sergio, 2026-11-10): el número que ve el equipo en el tablero de Reclutamiento, junto con qué tan seguro es.
// Lógica pura: la usan el tablero (getBoardDuplicateBadges), la ventana de historial (searchParticipantHistory) y «Por reclutador» (para decidir qué es un contacto compartido),
// así las tres dan siempre la misma cifra. Ver docs/filtros-llenados.md.
//
// Un filtro llenado es UNA respuesta (src/lib/respuestaFillout.ts): si el mismo filtro está vinculado a varios tableros, su respuesta se copia a cada uno y esas filas cuentan una sola vez.
// Las filas sin id de respuesta (capturadas a mano, importadas de Excel) no se pueden reconocer como un filtro llenado: no cuentan, y se avisa cuántas son.
import { isPlaceholderName, normalizeEmail, normalizeName, normalizePhone, type IdentityRow } from './duplicateIdentity';
import { respuestaDe } from './respuestaFillout';

/** Una «persona» con al menos tantas respuestas y tantos nombres distintos es, casi seguro, un correo o teléfono compartido (quien recluta en campo llena por varios). */
export const MIN_RESPUESTAS_COMPARTIDO = 5;
export const MIN_NOMBRES_COMPARTIDO = 3;
export const esContactoCompartido = (respuestas: number, nombres: number): boolean =>
  respuestas >= MIN_RESPUESTAS_COMPARTIDO && nombres >= MIN_NOMBRES_COMPARTIDO;

/**
 * Qué tan seguro es que todas las filas de la persona sean la misma persona, por lo que varían sus datos (teléfono, correo y nombre ya normalizados):
 * `segura`: todas coinciden; `probable`: algún dato tiene 2 valores (otro teléfono, otro correo o el nombre escrito distinto); `revisar`: algún dato tiene 3 o más,
 * y pudieron juntarse dos personas distintas (o una que cambió mucho de datos).
 */
export type Confianza = 'segura' | 'probable' | 'revisar';

export interface ResumenFiltros {
  /** Cuántas veces llenó un filtro (respuestas distintas). `null` si es un contacto compartido: ahí no hay un número confiable. */
  filtrosLlenados: number | null;
  /** Filas de la persona sin id de respuesta: no se cuentan como filtros llenados. */
  filasSinFiltro: number;
  compartido: boolean;
  confianza: Confianza;
}

const nombreDe = (f: IdentityRow) => normalizeName(f.participantName as string | undefined);

/**
 * Las llaves de identidad de una fila, con la misma regla con la que se agrupa a las personas (duplicateIdentity.ts): un correo no vacío, un nombre de más de 2 letras que no sea un
 * placeholder y un teléfono de 7 dígitos o más.
 */
function llavesDeLaFila(f: IdentityRow): { email?: string; name?: string; phone?: string } {
  const llaves: { email?: string; name?: string; phone?: string } = {};
  if (f.email) { const e = normalizeEmail(f.email); if (e) llaves.email = e; }
  const n = nombreDe(f);
  if (n.length > 2 && !isPlaceholderName(n)) llaves.name = n;
  if (f.phone) { const t = normalizePhone(f.phone); if (t.length >= 7) llaves.phone = t; }
  return llaves;
}

export function contarFiltrosLlenados(filas: ReadonlyArray<IdentityRow>): ResumenFiltros {
  const respuestas = new Set<string>();
  let sinFiltro = 0;
  const nombres = new Set<string>();
  const telefonos = new Set<string>(), correos = new Set<string>(), nombresClave = new Set<string>();
  for (const f of filas) {
    const id = respuestaDe(f);
    if (id) respuestas.add(id); else sinFiltro++;
    const n = nombreDe(f);
    if (n) nombres.add(n);
    const k = llavesDeLaFila(f);
    if (k.phone) telefonos.add(k.phone);
    if (k.email) correos.add(k.email);
    if (k.name) nombresClave.add(k.name);
  }
  // Igual que «Por reclutador»: una fila sin id es una respuesta aparte a la hora de decidir si el contacto es compartido.
  const compartido = esContactoCompartido(respuestas.size + sinFiltro, nombres.size);
  const variacion = Math.max(telefonos.size, correos.size, nombresClave.size);
  return {
    filtrosLlenados: compartido ? null : respuestas.size,
    filasSinFiltro: sinFiltro,
    compartido,
    confianza: variacion <= 1 ? 'segura' : variacion === 2 ? 'probable' : 'revisar',
  };
}

/** Un filtro llenado, tal como se lista en el historial: con los datos que la persona usó esa vez. */
export interface FiltroLlenado {
  respuestaId: string;
  /** El nombre del filtro (sin el prefijo del Hub). */
  filtro?: string;
  /** El proyecto de la copia más antigua de la respuesta: donde se recibió. */
  proyecto: string;
  /** AAAA-MM-DD de inicio de ese proyecto. */
  fecha?: string;
  /** En cuántos otros tableros está copiada esta misma respuesta (no son otras veces que llenó el filtro). */
  copiasEn: number;
  nombre?: string;
  correo?: string;
  telefono?: string;
}

/** «Formulario Hub · Mi filtro|abc» → «Mi filtro». */
export function nombreDelFiltro(sourceForm?: string | null): string | undefined {
  const origen = typeof sourceForm === 'string' ? sourceForm : '';
  const i = origen.lastIndexOf('|');
  const nombre = (i >= 0 ? origen.slice(0, i) : origen).replace(/^Formulario Hub\s*·\s*/, '').trim();
  return nombre || undefined;
}

/** Los filtros que llenó la persona, uno por respuesta distinta, del más reciente al más antiguo. `fechaDe` da la fecha de inicio de un proyecto. */
export function filtrosLlenadosDe(filas: ReadonlyArray<IdentityRow>, fechaDe: (codigoProyecto: string) => string | undefined): FiltroLlenado[] {
  const grupos = new Map<string, IdentityRow[]>();
  for (const f of filas) {
    const id = respuestaDe(f);
    if (!id) continue;
    const grupo = grupos.get(id);
    if (grupo) grupo.push(f); else grupos.set(id, [f]);
  }
  const fecha = (f: IdentityRow) => { const x = fechaDe(typeof f.projectCode === 'string' ? f.projectCode : ''); return x ? String(x).slice(0, 10) : undefined; };
  const lista: FiltroLlenado[] = [];
  for (const [respuestaId, copias] of grupos) {
    // La copia más antigua (la primera con fecha) es donde se recibió la respuesta.
    const ordenadas = [...copias].sort((a, b) => (fecha(a) ?? '9999').localeCompare(fecha(b) ?? '9999') || String(a.id).localeCompare(String(b.id)));
    const origen = ordenadas[0];
    const tableros = new Set(copias.map((c) => `${c.projectCode ?? ''}||${c.boardName ?? ''}`));
    lista.push({
      respuestaId,
      filtro: nombreDelFiltro(origen.sourceForm),
      proyecto: typeof origen.projectCode === 'string' ? origen.projectCode : '',
      fecha: ordenadas.map(fecha).find(Boolean),
      copiasEn: Math.max(0, tableros.size - 1),
      nombre: (origen.participantName as string | undefined) || undefined,
      correo: (origen.email as string | undefined) || undefined,
      telefono: (origen.phone as string | undefined) || undefined,
    });
  }
  return lista.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || a.respuestaId.localeCompare(b.respuestaId));
}
