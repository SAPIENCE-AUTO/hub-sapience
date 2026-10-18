// Pagos de análisis / management: cómo se reparte el presupuesto de cada proyecto (el Management del deal y, si se quiere, otros rubros de la
// cotización) entre quienes participan (de 1 a 5 personas, internas o externas, cada una con un porcentaje) y cuánto lleva acumulado cada persona.
// Lo comparten el servidor (que valida y guarda) y la pantalla (que suma por periodo), así que las reglas viven en un solo lugar. Repartir menos de
// 100 % o pasarse de 100 % está permitido: la pantalla avisa en los dos casos, pero deja guardar.
import { restarMeses, type Periodo } from '../indicadores/reclutamiento';

export const MONEDAS = ['MXN', 'USD', 'EUR'] as const;
export type Moneda = (typeof MONEDAS)[number];

/** Cuántas personas caben en un reparto: «generalmente de 1 a 5», con holgura. */
export const MAX_PERSONAS = 30;

/**
 * El porcentaje más alto que se acepta para una persona: más que eso es casi seguro un error de dedo. Pasarse de 100 % en total sí vale (a veces se
 * paga de más): se avisa, pero se deja guardar.
 */
export const MAX_PORCENTAJE = 1000;

/**
 * Los porcentajes se guardan con 6 decimales. Con menos, un monto escrito a mano no volvería igual (5,000 de 37,500 es 13.333333 %: con 4 decimales
 * saldría 4,999.99), y con 6 vuelve exacto en presupuestos de hasta cientos de miles. También permite partes iguales entre 3 (33.333334 + 33.333333 + 33.333333 = 100).
 */
const UNIDADES_POR_PUNTO = 1_000_000;
const CIEN = 100 * UNIDADES_POR_PUNTO;
/** Cuánto se tolera de más o de menos para decir que un reparto está completo: unos centavos de diferencia al escribir montos no lo vuelven «incompleto». */
const TOLERANCIA = 0.0001 * UNIDADES_POR_PUNTO;

// ── Rubros del presupuesto ───────────────────────────────────────────────────
/** Los rubros de una cotización, con Management primero: es el que trae por omisión. */
export const RUBROS = ['Management', 'Reclutamiento e incentivos', 'Moderación', 'Logística y operación', 'Back office'] as const;
export type Rubro = (typeof RUBROS)[number];
export const RUBRO_PREDETERMINADO: Rubro = 'Management';
/** Nombres cortos, para donde falta lugar (la tabla). */
export const RUBRO_CORTO: Record<Rubro, string> = {
  Management: 'Management', 'Reclutamiento e incentivos': 'Reclutamiento', 'Moderación': 'Moderación', 'Logística y operación': 'Logística', 'Back office': 'Back office',
};

/** Lo que dice el deal de un rubro: el costo (cantidad × componentes × costo unitario) de sus líneas en las cotizaciones incluidas, y lo mismo con markup. */
export interface MontoRubro { costo: number; conMarkup: number }
/** Los rubros del deal que traen monto. */
export type RubrosDeal = Partial<Record<Rubro, MontoRubro>>;
/** Un rubro que forma parte del presupuesto de un proyecto; `monto` null = vale el que dice el deal. */
export interface RubroPresupuesto { rubro: Rubro; monto: number | null }

export interface PersonaReparto {
  id?: string;
  /** Usuario interno; null para una persona externa. */
  userId: string | null;
  nombre: string;
  externo: boolean;
  /** Mayor a 0 y hasta MAX_PORCENTAJE, con hasta 6 decimales. Lo normal es que todos sumen 100, pero se pueden pasar. */
  porcentaje: number;
}

/** Una persona del equipo a la que se le puede repartir. */
export interface UsuarioReparto { id: string; nombre: string; departamento?: string }

/** Una parte de lo cotizado de Management: `cantidad` unidades a `precio` cada una. */
export interface UnidadCotizada { precio: number; cantidad: number }

/**
 * Un deal con Management cotizado. Un deal puede fragmentarse en varios proyectos: cada uno se lleva una parte de lo cotizado y entre todos
 * suman qué porcentaje ya está repartido.
 */
export interface DealManagement {
  dealId: string;
  nombre: string;
  cliente?: string;
  moneda: Moneda;
  /** Lo que cotizó de Management (costo, sin markup): lo que hay para repartir entre sus proyectos. */
  cotizado: number;
  /** Cómo se cotizó, por precio unitario: «40 × $2,000». De referencia y para sumar rápido el monto de un proyecto. */
  unidades: UnidadCotizada[];
  /** Cuándo se aprobó (AAAA-MM-DD; si no, cuándo se propuso), para el periodo. */
  inicio?: string;
}

/** Un proyecto sin monto de management en su deal ni reparto: se puede agregar a mano, poniéndole un presupuesto. */
export interface ProyectoDisponible {
  projectId: string; codigo: string; nombre?: string; cliente?: string; estado?: string; inicio?: string; dealNombre?: string; monedaDeal: Moneda;
  /** Lo que su deal trae de los demás rubros (nunca Management: si lo trajera no estaría aquí). */
  rubrosDeal: RubrosDeal;
  /** El deal del que sale su Management: el que se le asignó en este módulo o, si no, el vinculado. */
  dealId?: string | null;
  /** El deal vinculado al proyecto (el que usan presupuesto, costos y cobranza) y el que se le asignó aquí, si es otro. */
  dealVinculadoId?: string | null;
  dealVinculadoNombre?: string;
  dealAsignadoId?: string | null;
  /** El deal está repartido entre varios proyectos: su Management no se le ofrece a este como suyo, se escribe lo que se lleva. */
  dealFragmentado?: boolean;
}

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
  /** Lo que dice el deal, rubro por rubro: el costo sin markup (el de la pestaña Presupuesto del proyecto) y, de referencia, con markup. */
  rubrosDeal: RubrosDeal;
  monedaDeal: Moneda;
  /** Los rubros que forman el presupuesto, en su orden. Por omisión solo Management; cada uno vale lo del deal salvo que se haya puesto un monto a mano. */
  rubros: RubroPresupuesto[];
  /** La moneda que vale: la elegida a mano si se puso algún monto, si no la del deal. */
  moneda: Moneda;
  personas: PersonaReparto[];
  eliminado: boolean;
  /** El deal del que sale su Management: el que se le asignó en este módulo o, si no, el vinculado (`dealNombre` es el suyo). */
  dealId?: string | null;
  /** El deal vinculado al proyecto (el que usan presupuesto, costos y cobranza) y el que se le asignó aquí, si es otro. */
  dealVinculadoId?: string | null;
  dealVinculadoNombre?: string;
  dealAsignadoId?: string | null;
  /** El deal está repartido entre varios proyectos: sin reparto propio, su Management no se le ofrece a este como suyo (se escribe lo que se lleva). */
  dealFragmentado?: boolean;
}

export interface PagosManagement {
  /** Los proyectos con monto de management en su deal o con algún reparto registrado, del más reciente al más viejo. */
  proyectos: ProyectoManagement[];
  /** Todos los demás proyectos: se pueden agregar a mano, poniéndoles un presupuesto. */
  disponibles: ProyectoDisponible[];
  /** Los deals con Management cotizado (los ganados y los que ya tienen algún proyecto), a los que se les asignan proyectos. */
  deals: DealManagement[];
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

/** Los rubros con los que arranca un proyecto: solo Management, con lo que diga el deal. */
export const rubrosPorOmision = (): RubroPresupuesto[] => [{ rubro: RUBRO_PREDETERMINADO, monto: null }];
export const esPorOmision = (rubros: RubroPresupuesto[]): boolean => rubros.length === 1 && rubros[0].rubro === RUBRO_PREDETERMINADO && rubros[0].monto === null;

/** Lo que dice el deal de un rubro (sin markup); 0 si no trae. */
export const costoDealDe = (rubrosDeal: RubrosDeal, rubro: Rubro): number => rubrosDeal[rubro]?.costo ?? 0;

/** Lo que vale un rubro del presupuesto: el monto puesto a mano o, si no, el del deal. */
export const montoDeRubro = (rubrosDeal: RubrosDeal, r: RubroPresupuesto): number => r.monto ?? costoDealDe(rubrosDeal, r.rubro);

/** El presupuesto de hoy: la suma de sus rubros. */
export const presupuestoDe = (p: Pick<ProyectoManagement, 'rubros' | 'rubrosDeal'>): number => redondear(p.rubros.reduce((s, r) => s + montoDeRubro(p.rubrosDeal, r), 0));

/** ¿Se cambió algún monto respecto al deal? Solo cuenta donde el deal trae un monto con el cual comparar. */
export const esEditado = (p: Pick<ProyectoManagement, 'rubros' | 'rubrosDeal'>): boolean => p.rubros.some((r) => r.monto !== null && costoDealDe(p.rubrosDeal, r.rubro) > 0);

/** Los rubros del presupuesto en una línea: «Management + Moderación». */
export const etiquetaRubros = (rubros: RubroPresupuesto[]): string => rubros.map((r) => RUBRO_CORTO[r.rubro]).join(' + ');

/** El primer problema de los rubros del presupuesto, en palabras llanas, o null si están bien. */
export function validarRubros(rubros: RubroPresupuesto[]): string | null {
  if (rubros.length === 0) return 'El presupuesto necesita al menos un rubro.';
  const vistos = new Set<Rubro>();
  for (const r of rubros) {
    if (vistos.has(r.rubro)) return `«${r.rubro}» está dos veces en el presupuesto.`;
    vistos.add(r.rubro);
    if (r.monto !== null && (!Number.isFinite(r.monto) || r.monto < 0)) return `El monto de ${r.rubro} no es válido.`;
  }
  return null;
}

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

/** Un porcentaje escrito a mano: «33.33», «33,33» o «33%» → ese número; vacío → null; mayor a MAX_PORCENTAJE o no numérico → undefined. */
export function leerPorcentaje(texto: string): number | null | undefined {
  const t = texto.trim().replace(/%$/, '').trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const v = Number(t);
  return v >= 0 && v <= MAX_PORCENTAJE ? redondearPorcentaje(v) : undefined;
}

/** Para mostrar un número en un campo de texto sin ceros de sobra: 33.333334 → «33.333334», 50 → «50», 12.5 → «12.5». */
export const textoNumero = (n: number): string => String(redondearPorcentaje(n));

// ── Validación (la misma en la pantalla y en el servidor) ────────────────────
export const normalizarNombre = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** El primer problema del reparto, en palabras llanas, o null si está bien. Repartir menos de 100 % (se completa después) o pasarse de 100 % no son problemas. */
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
    if (p.porcentaje > MAX_PORCENTAJE) return `Un porcentaje no puede pasar de ${MAX_PORCENTAJE}.`;
  }
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

export interface TotalesManagement {
  presupuestado: Record<Moneda, number>;
  repartido: Record<Moneda, number>;
  /** Lo que todavía falta repartir: la suma de lo que le falta a cada proyecto (un proyecto que se pasó no le resta a otro). */
  porRepartir: Record<Moneda, number>;
  /** Lo que se repartió de más sobre el presupuesto de cada proyecto que se pasó, y cuántos proyectos son. */
  excedido: Record<Moneda, number>;
  proyectosExcedidos: number;
}

/** Los totales de un conjunto de proyectos, por moneda: lo presupuestado, lo ya repartido, lo que falta y lo que se pasó. */
export function totalesPorMoneda(proyectos: ProyectoManagement[]): TotalesManagement {
  const presupuestado = sinMonedas();
  const repartido = sinMonedas();
  const porRepartir = sinMonedas();
  const excedido = sinMonedas();
  let proyectosExcedidos = 0;
  for (const p of proyectos) {
    const base = presupuestoDe(p);
    let repartidoDelProyecto = 0;
    for (const monto of montosDe(base, p.personas)) repartidoDelProyecto = redondear(repartidoDelProyecto + monto);
    presupuestado[p.moneda] = redondear(presupuestado[p.moneda] + base);
    repartido[p.moneda] = redondear(repartido[p.moneda] + repartidoDelProyecto);
    const estado = estadoReparto(p.personas);
    // Un reparto completo no deja resto aunque sobren o falten unos centavos al escribir montos.
    const resto = estado === 'completo' ? 0 : redondear(base - repartidoDelProyecto);
    if (resto > 0) porRepartir[p.moneda] = redondear(porRepartir[p.moneda] + resto);
    if (resto < 0) excedido[p.moneda] = redondear(excedido[p.moneda] - resto);
    if (estado === 'excedido') proyectosExcedidos++;
  }
  return { presupuestado, repartido, porRepartir, excedido, proyectosExcedidos };
}

// ── Deals: cuánto de lo cotizado ya está repartido en proyectos ──────────────
/**
 * Lo que un proyecto se lleva del Management de su deal: el monto de su rubro Management (el puesto a mano o, si no, el de su deal). Los demás
 * rubros no cuentan: lo que se reparte entre los proyectos de un deal es solo su Management.
 */
export const managementDe = (p: Pick<ProyectoManagement, 'rubros' | 'rubrosDeal'>): number =>
  redondear(p.rubros.filter((r) => r.rubro === 'Management').reduce((s, r) => s + montoDeRubro(p.rubrosDeal, r), 0));

export interface ProyectoDeDeal {
  projectId: string;
  codigo: string;
  cliente?: string;
  estado?: string;
  inicio?: string;
  /** Lo que se lleva del Management del deal; 0 si todavía no tiene monto. */
  monto: number;
  repartoId: string | null;
  estadoReparto: EstadoReparto;
}

export interface ResumenDeal {
  deal: DealManagement;
  /** Los proyectos que se llevan Management de este deal, del más reciente al más viejo (sin fecha al final). */
  proyectos: ProyectoDeDeal[];
  /** Lo que ya se llevaron los proyectos. */
  asignado: number;
  /** Lo que queda de lo cotizado; negativo si los proyectos se llevaron más (se avisa, pero se deja). */
  disponible: number;
  /** Qué parte de lo cotizado ya está repartida entre proyectos, en %: más de 100 es que se pasa. */
  porcentaje: number;
}

export type EstadoDeal = 'sinAsignar' | 'parcial' | 'completo' | 'excedido';

/** Cuánto de lo cotizado de un deal ya se repartió entre proyectos, con los proyectos que lo forman. No depende del periodo. */
export function resumenDeDeal(deal: DealManagement, proyectos: ProyectoManagement[], disponibles: ProyectoDisponible[]): ResumenDeal {
  const lista: ProyectoDeDeal[] = [];
  for (const p of proyectos) {
    if (p.eliminado || !p.projectId || p.dealId !== deal.dealId) continue;
    lista.push({ projectId: p.projectId, codigo: p.codigo, cliente: p.cliente, estado: p.estado, inicio: p.inicio, monto: managementDe(p), repartoId: p.repartoId, estadoReparto: estadoReparto(p.personas) });
  }
  for (const p of disponibles) {
    if (p.dealId !== deal.dealId) continue;
    lista.push({ projectId: p.projectId, codigo: p.codigo, cliente: p.cliente, estado: p.estado, inicio: p.inicio, monto: 0, repartoId: null, estadoReparto: 'sinRepartir' });
  }
  lista.sort((a, b) => (b.inicio ?? '').localeCompare(a.inicio ?? '') || a.codigo.localeCompare(b.codigo));
  const asignado = redondear(lista.reduce((s, p) => s + p.monto, 0));
  const porcentaje = deal.cotizado > 0 ? (asignado / deal.cotizado) * 100 : 0;
  return { deal, proyectos: lista, asignado, disponible: redondear(deal.cotizado - asignado), porcentaje };
}

/** Nada asignado, falta, justo lo cotizado (unos centavos de diferencia no cuentan) o se pasa. */
export function estadoDeDeal(r: Pick<ResumenDeal, 'asignado' | 'disponible'>): EstadoDeal {
  if (r.disponible < -0.005) return 'excedido';
  if (r.disponible <= 0.005) return r.asignado > 0 ? 'completo' : 'sinAsignar';
  return r.asignado > 0 ? 'parcial' : 'sinAsignar';
}

export interface TotalesDeals {
  cotizado: Record<Moneda, number>;
  asignado: Record<Moneda, number>;
  /** Lo que falta por asignar: la suma de lo que le falta a cada deal (uno que se pasó no le resta a otro). */
  porAsignar: Record<Moneda, number>;
  /** Lo que se asignó de más sobre lo cotizado de cada deal que se pasó, y cuántos son. */
  excedido: Record<Moneda, number>;
  dealsExcedidos: number;
}

/** Los totales de un conjunto de deals, por moneda. */
export function totalesDeDeals(resumenes: ResumenDeal[]): TotalesDeals {
  const cotizado = sinMonedas();
  const asignado = sinMonedas();
  const porAsignar = sinMonedas();
  const excedido = sinMonedas();
  let dealsExcedidos = 0;
  for (const r of resumenes) {
    const m = r.deal.moneda;
    cotizado[m] = redondear(cotizado[m] + r.deal.cotizado);
    asignado[m] = redondear(asignado[m] + r.asignado);
    if (r.disponible > 0) porAsignar[m] = redondear(porAsignar[m] + r.disponible);
    if (r.disponible < -0.005) { excedido[m] = redondear(excedido[m] - r.disponible); dealsExcedidos++; }
  }
  return { cotizado, asignado, porAsignar, excedido, dealsExcedidos };
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
