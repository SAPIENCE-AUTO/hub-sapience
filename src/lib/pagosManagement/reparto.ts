// Pagos de análisis / management: cómo se reparte el monto de Management de cada proyecto entre quienes participan (de 1 a 5 personas, internas
// o externas, cada una con un porcentaje) y cuánto lleva acumulado cada persona. Lo comparten el servidor (que valida y guarda) y la pantalla
// (que suma por periodo), así que las reglas viven en un solo lugar.
import { restarMeses, type Periodo } from '../indicadores/reclutamiento';

export const MONEDAS = ['MXN', 'USD', 'EUR'] as const;
export type Moneda = (typeof MONEDAS)[number];

/** Cuántas personas caben en un reparto: «generalmente de 1 a 5», con holgura. */
export const MAX_PERSONAS = 30;

/**
 * Los porcentajes se guardan con 6 decimales. Con menos, un monto escrito a mano no volvería igual (5,000 de 37,500 es 13.333333 %: con 4 decimales
 * saldría 4,999.99), y con 6 vuelve exacto en presupuestos de hasta cientos de miles. También permite partes iguales entre 3 (33.333334 + 33.333333 + 33.333333 = 100).
 */
const UNIDADES_POR_PUNTO = 1_000_000;
const CIEN = 100 * UNIDADES_POR_PUNTO;
/** Cuánto se tolera de más o de menos para decir que un reparto está completo: unos centavos de diferencia al escribir montos no lo vuelven «incompleto». */
const TOLERANCIA = 0.0001 * UNIDADES_POR_PUNTO;

export interface PersonaReparto {
  id?: string;
  /** Usuario interno; null para una persona externa. */
  userId: string | null;
  nombre: string;
  externo: boolean;
  /** De 0 a 100, hasta 6 decimales. */
  porcentaje: number;
}

/** Una persona del equipo a la que se le puede repartir. */
export interface UsuarioReparto { id: string; nombre: string; departamento?: string }

/** Un proyecto sin monto de management en su deal ni reparto: se puede agregar a mano, poniéndole un presupuesto. */
export interface ProyectoDisponible { projectId: string; codigo: string; nombre?: string; cliente?: string; estado?: string; inicio?: string; dealNombre?: string; monedaDeal: Moneda }

export interface ProyectoManagement {
  /** La fila del reparto si ya se registró algo de este proyecto. */
  repartoId: string | null;
  /** null si el proyecto se eliminó después de repartir (el reparto se conserva: es plata que se debe). */
  projectId: string | null;
  codigo: string;
  nombre?: string;
  cliente?: string;
  estado?: string;
  /** Inicio del proyecto (AAAA-MM-DD). */
  inicio?: string;
  dealNombre?: string;
  /** Lo que dice el deal: el costo del rubro Management en las cotizaciones incluidas (el de la pestaña Presupuesto), sin markup. */
  montoDeal: number;
  /** Lo mismo con markup, solo de referencia. */
  montoDealConMarkup: number;
  monedaDeal: Moneda;
  /** Lo que se puso a mano cuando no sirve el del deal; null = vale el del deal. */
  presupuesto: number | null;
  /** La moneda que vale: la elegida a mano si se cambió el monto, si no la del deal. */
  moneda: Moneda;
  personas: PersonaReparto[];
  eliminado: boolean;
}

export interface PagosManagement {
  /** Los proyectos con monto de management en su deal o con algún reparto registrado, del más reciente al más viejo. */
  proyectos: ProyectoManagement[];
  /** Todos los demás proyectos: se pueden agregar a mano, poniéndoles un presupuesto. */
  disponibles: ProyectoDisponible[];
  usuarios: UsuarioReparto[];
  /** Personas externas que ya se han usado en algún reparto, para no escribir dos veces el mismo nombre. */
  externos: string[];
  /** true si todavía no existen las tablas del módulo: se puede ver, pero no guardar. */
  sinTablas: boolean;
}

// ── Montos y porcentajes ─────────────────────────────────────────────────────
export const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const redondearPorcentaje = (n: number): number => Math.round((n + Number.EPSILON) * UNIDADES_POR_PUNTO) / UNIDADES_POR_PUNTO;
const unidades = (porcentaje: number): number => Math.round(porcentaje * UNIDADES_POR_PUNTO);

/** El monto que vale hoy: el que se puso a mano o, si no, el del deal. */
export const presupuestoDe = (p: Pick<ProyectoManagement, 'presupuesto' | 'montoDeal'>): number => p.presupuesto ?? p.montoDeal;

export const montoDe = (presupuesto: number, porcentaje: number): number => redondear((presupuesto * porcentaje) / 100);

/**
 * Lo que le toca a cada persona de un presupuesto, en pesos con centavos y de modo que SUMEN EXACTO lo repartido: si 20,000 entre tres sale a
 * 6,666.67 + 6,666.67 + 6,666.67 (20,000.01), los centavos de más se quitan a quien tenía la fracción más chica (6,666.67, 6,666.67 y 6,666.66).
 * `porcentajes` van en el mismo orden que lo que devuelve.
 */
export function repartirMonto(presupuesto: number, porcentajes: number[]): number[] {
  const exactos = porcentajes.map((p) => presupuesto * p); // en centavos: pesos × porcentaje = pesos × 100 × porcentaje / 100
  const total = Math.round(exactos.reduce((s, x) => s + x, 0));
  const centavos = exactos.map((x) => Math.floor(x + 1e-7)); // la tolerancia es por el ruido de los decimales
  let sobran = total - centavos.reduce((s, c) => s + c, 0);
  const porFraccion = exactos.map((x, i) => ({ i, resto: x - centavos[i] })).sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (let k = 0; sobran > 0 && porFraccion.length > 0; k = (k + 1) % porFraccion.length) { centavos[porFraccion[k].i]++; sobran--; }
  return centavos.map((c) => c / 100);
}

/** El monto de cada persona de un reparto, en su orden (ver repartirMonto). */
export const montosDe = (presupuesto: number, personas: Array<{ porcentaje: number }>): number[] => repartirMonto(presupuesto, personas.map((p) => p.porcentaje));

/** Lo que representa un monto escrito a mano dentro del presupuesto. Sin presupuesto no hay porcentaje que calcular. */
export const porcentajeDeMonto = (presupuesto: number, monto: number): number => (presupuesto > 0 ? redondearPorcentaje((monto / presupuesto) * 100) : 0);

export const sumaPorcentajes = (personas: Array<{ porcentaje: number }>): number => personas.reduce((s, p) => s + unidades(p.porcentaje), 0) / UNIDADES_POR_PUNTO;

export type EstadoReparto = 'sinRepartir' | 'incompleto' | 'completo' | 'excedido';

export function estadoReparto(personas: Array<{ porcentaje: number }>): EstadoReparto {
  const suma = personas.reduce((s, p) => s + unidades(p.porcentaje), 0);
  if (personas.length === 0 || suma === 0) return 'sinRepartir';
  if (suma > CIEN + TOLERANCIA) return 'excedido';
  return suma >= CIEN - TOLERANCIA ? 'completo' : 'incompleto';
}

/** `n` porcentajes iguales que suman exactamente 100: si no se divide justo, las primeras personas llevan la diferencia (33.333334, 33.333333, 33.333333). */
export function partesIguales(n: number): number[] {
  if (!Number.isInteger(n) || n <= 0) return [];
  const base = Math.floor(CIEN / n);
  const sobran = CIEN - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobran ? 1 : 0)) / UNIDADES_POR_PUNTO);
}

// ── Lo que se escribe en los campos ──────────────────────────────────────────
/**
 * Un monto escrito a mano: «25000», «25,000», «$25,000.50» → ese número; «5,5» → 5.5 (coma decimal); vacío → null; otra cosa o negativo → undefined (no vale).
 * La coma es de miles solo si separa grupos de tres cifras («25,000»).
 */
export function leerMonto(texto: string): number | null | undefined {
  const t = texto.trim().replace(/^\$/, '').replace(/\s/g, '');
  if (t === '') return null;
  let limpio: string;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) limpio = t.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(t)) limpio = t.replace(',', '.');
  else if (/^\d+(\.\d+)?$/.test(t)) limpio = t;
  else return undefined;
  const v = Number(limpio);
  return Number.isFinite(v) && v <= 1_000_000_000 ? redondear(v) : undefined;
}

/** Un porcentaje escrito a mano: «33.33», «33,33» o «33%» → ese número; vacío → null; fuera de 0–100 o no numérico → undefined. */
export function leerPorcentaje(texto: string): number | null | undefined {
  const t = texto.trim().replace(/%$/, '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const v = Number(t);
  return v >= 0 && v <= 100 ? redondearPorcentaje(v) : undefined;
}

/** Para mostrar un número en un campo de texto sin ceros de sobra: 33.333334 → «33.333334», 50 → «50», 12.5 → «12.5». */
export const textoNumero = (n: number): string => String(redondearPorcentaje(n));

// ── Validación (la misma en la pantalla y en el servidor) ────────────────────
export const normalizarNombre = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** El primer problema del reparto, en palabras llanas, o null si está bien. Repartir menos de 100 % sí vale (se completa después). */
export function validarReparto(personas: PersonaReparto[]): string | null {
  if (personas.length > MAX_PERSONAS) return `Un reparto no puede tener más de ${MAX_PERSONAS} personas.`;
  const internos = new Set<string>();
  const externos = new Set<string>();
  for (const p of personas) {
    const nombre = p.nombre.trim();
    if (p.externo) {
      if (nombre === '') return 'Escribe el nombre de la persona externa.';
      if (nombre.length > 120) return 'El nombre de una persona externa es demasiado largo.';
      const clave = normalizarNombre(nombre);
      if (externos.has(clave)) return `«${nombre}» está dos veces en el reparto.`;
      externos.add(clave);
    } else {
      if (!p.userId) return 'Elige a la persona de cada renglón.';
      if (internos.has(p.userId)) return `«${nombre || 'Una persona'}» está dos veces en el reparto.`;
      internos.add(p.userId);
    }
    if (!Number.isFinite(p.porcentaje) || p.porcentaje <= 0) return `Pon un porcentaje mayor a cero para ${nombre || 'cada persona'}.`;
    if (p.porcentaje > 100) return 'Un porcentaje no puede pasar de 100.';
  }
  if (estadoReparto(personas) === 'excedido') return `Los porcentajes suman ${textoNumero(sumaPorcentajes(personas))} % y no pueden pasar de 100 %.`;
  return null;
}

// ── Acumulado por persona ────────────────────────────────────────────────────
export interface DetalleAcumulado { codigo: string; cliente?: string; moneda: Moneda; porcentaje: number; monto: number }
export interface AcumuladoPersona {
  /** El usuario si es interno; si no, el nombre normalizado (para que «Ana  Pérez» y «ana perez» sean la misma persona). */
  clave: string;
  nombre: string;
  externo: boolean;
  proyectos: number;
  porMoneda: Record<Moneda, number>;
  detalle: DetalleAcumulado[];
}

const sinMonedas = (): Record<Moneda, number> => ({ MXN: 0, USD: 0, EUR: 0 });

/** Lo que lleva cada persona sumando los proyectos que se le pasen (el periodo ya viene filtrado). De más a menos. */
export function acumuladoPorPersona(proyectos: ProyectoManagement[]): AcumuladoPersona[] {
  const porClave = new Map<string, AcumuladoPersona>();
  for (const proyecto of proyectos) {
    const montos = montosDe(presupuestoDe(proyecto), proyecto.personas);
    for (const [i, persona] of proyecto.personas.entries()) {
      const clave = persona.userId ?? `ext:${normalizarNombre(persona.nombre)}`;
      let acumulado = porClave.get(clave);
      if (!acumulado) {
        acumulado = { clave, nombre: persona.nombre, externo: persona.externo, proyectos: 0, porMoneda: sinMonedas(), detalle: [] };
        porClave.set(clave, acumulado);
      }
      const monto = montos[i];
      acumulado.proyectos++;
      acumulado.porMoneda[proyecto.moneda] = redondear(acumulado.porMoneda[proyecto.moneda] + monto);
      acumulado.detalle.push({ codigo: proyecto.codigo, cliente: proyecto.cliente, moneda: proyecto.moneda, porcentaje: persona.porcentaje, monto });
    }
  }
  const lista = [...porClave.values()];
  for (const a of lista) a.detalle.sort((x, y) => y.monto - x.monto || x.codigo.localeCompare(y.codigo));
  return lista.sort((a, b) => b.porMoneda.MXN - a.porMoneda.MXN || b.porMoneda.USD - a.porMoneda.USD || b.porMoneda.EUR - a.porMoneda.EUR || a.nombre.localeCompare(b.nombre));
}

/** Los totales de un conjunto de proyectos, por moneda: lo presupuestado y lo ya repartido. */
export function totalesPorMoneda(proyectos: ProyectoManagement[]): { presupuestado: Record<Moneda, number>; repartido: Record<Moneda, number> } {
  const presupuestado = sinMonedas();
  const repartido = sinMonedas();
  for (const p of proyectos) {
    const base = presupuestoDe(p);
    presupuestado[p.moneda] = redondear(presupuestado[p.moneda] + base);
    for (const monto of montosDe(base, p.personas)) repartido[p.moneda] = redondear(repartido[p.moneda] + monto);
  }
  return { presupuestado, repartido };
}

// ── Periodo ──────────────────────────────────────────────────────────────────
/**
 * Los proyectos que empezaron dentro del periodo. A diferencia de los indicadores, los que aún no empiezan sí entran (un proyecto recién ganado
 * ya tiene su management por repartir). Sin fecha de inicio solo aparece en «todo». `hoy` es AAAA-MM-DD.
 */
export function enPeriodo<T extends { inicio?: string }>(proyectos: T[], periodo: Periodo, hoy: string): T[] {
  if (periodo === 'todo') return proyectos;
  const desde = periodo === '12m' ? restarMeses(hoy, 12) : periodo === '6m' ? restarMeses(hoy, 6) : `${hoy.slice(0, 4)}-01-01`;
  return proyectos.filter((p) => !!p.inicio && p.inicio >= desde);
}
