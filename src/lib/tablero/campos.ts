// Registro de campos del tablero: los cortes (dimensiones) y las cuentas (medidas) que se pueden usar en un bloque. Es el único lugar donde se declaran: un
// campo nuevo (p. ej. «motivo de pérdida») se agrega aquí y aparece solo en todos los menús del constructor, sin tocar el motor ni las gráficas.
import type { ISO } from './fechas';
import { diasEntre, parseISO, trimestreDe, MESES_ETIQUETA } from './fechas';
import type { Contexto, Deal, FechaRef, MedidaDef, MonedaAlcance } from './tipos';

export const FASES = ['Prospecto', 'Brief recibido', 'Cotización enviada', 'Negociación', 'Ganado', 'Perdido'];
const FASES_CON_COTIZACION = ['Cotización enviada', 'Negociación', 'Ganado', 'Perdido'];

// ── Cuentas de dinero ─────────────────────────────────────────────────────────

/** Moneda del deal sin la bandera: «MXN», «USD», «EUR». Sin moneda cuenta como MXN, igual que el dashboard anterior. */
export function monedaDe(d: Deal): string {
  if (!d.currency) return 'MXN';
  const c = d.currency.trim().slice(0, 3).toUpperCase();
  return c || 'MXN';
}

/** Qué tipo de cambio se usa cuando un deal en otra moneda no trae el suyo (igual que el dashboard anterior). */
export const TIPO_DE_CAMBIO_SUPUESTO = 20;

/** Precio y costo en pesos. Lo que no es MXN se multiplica por su tipo de cambio, o por 20 si no lo tiene (o lo tiene en cero). */
export function aMXN(d: Deal): { ingreso: number; costo: number } {
  const esMXN = !d.currency || d.currency.startsWith('MXN');
  const tc = esMXN ? 1 : (d.exchangeRate || TIPO_DE_CAMBIO_SUPUESTO);
  return { ingreso: (d.clientPrice ?? 0) * tc, costo: (d.quotedCost ?? 0) * tc };
}

/** Un nombre de campo que viene de afuera (una vista guardada) solo vale si está de verdad en el registro: «constructor» o «__proto__» no. */
export const propio = (registro: object, clave: string): boolean => Object.prototype.hasOwnProperty.call(registro, clave);

const precio = (d: Deal, m: MonedaAlcance) => (m === 'todas' ? aMXN(d).ingreso : (d.clientPrice ?? 0));
const costo = (d: Deal, m: MonedaAlcance) => (m === 'todas' ? aMXN(d).costo : (d.quotedCost ?? 0));
const esGanado = (d: Deal) => d.phase === 'Ganado';
const esPerdido = (d: Deal) => d.phase === 'Perdido';
const llegoACotizacion = (d: Deal) => FASES_CON_COTIZACION.includes(d.phase ?? '');
const conPrecio = (d: Deal) => (d.clientPrice ?? 0) > 0;
/** Días entre la propuesta y la aprobación de un deal ganado; null si le falta alguna de las dos fechas o salen al revés. */
function diasDeCierre(d: Deal): number | null {
  if (!esGanado(d) || !d.proposalDate || !d.approvalDate) return null;
  const n = diasEntre(d.proposalDate.slice(0, 10), d.approvalDate.slice(0, 10));
  return n >= 0 ? n : null;
}
const suma = (ds: Deal[], f: (d: Deal) => number) => ds.reduce((s, d) => s + f(d), 0);

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

// ── Fechas del deal ───────────────────────────────────────────────────────────

/** La fecha que cuenta para ubicar un deal en el tiempo, según la referencia elegida; undefined si no la tiene. */
export function fechaDeDeal(d: Deal, ref: FechaRef): ISO | undefined {
  const propias: Record<FechaRef['campo'], string | undefined> = {
    aprobacion: d.approvalDate, propuesta: d.proposalDate, brief: d.fechaDeBrief, perdida: d.fechaPerdida,
  };
  let f = propias[ref.campo];
  if (!f && ref.alterna && (ref.campo === 'aprobacion' || ref.campo === 'propuesta')) {
    f = ref.campo === 'aprobacion' ? d.proposalDate : d.approvalDate;
  }
  return f ? f.slice(0, 10) : undefined;
}

export const FECHAS_ETIQUETA: Record<FechaRef['campo'], string> = {
  aprobacion: 'Fecha de aprobación',
  propuesta: 'Fecha de propuesta',
  brief: 'Fecha de brief',
  perdida: 'Fecha de pérdida',
};

// ── Medidas ───────────────────────────────────────────────────────────────────

const medida = (m: MedidaDef): MedidaDef => m;

export const MEDIDAS: Record<string, MedidaDef> = {
  ingresos: medida({
    id: 'ingresos', etiqueta: 'Ingresos', formato: 'moneda', acumulable: true,
    descripcion: 'Suma del precio de los deals ganados, en pesos (lo que no está en pesos se convierte con su tipo de cambio; si un deal no lo tiene se usa 20).',
    cuenta: esGanado,
    calcular: (ds, o) => suma(ds.filter(esGanado), d => precio(d, o.moneda)),
  }),
  dealsGanados: medida({
    id: 'dealsGanados', etiqueta: 'Deals ganados', formato: 'numero', acumulable: true,
    descripcion: 'Cuántos deals están en fase Ganado.',
    cuenta: esGanado,
    calcular: ds => ds.filter(esGanado).length,
  }),
  deals: medida({
    id: 'deals', etiqueta: 'Deals (todos)', formato: 'numero', acumulable: true,
    descripcion: 'Cuántos deals hay, en cualquier fase.',
    calcular: ds => ds.length,
  }),
  perdidos: medida({
    id: 'perdidos', etiqueta: 'Deals perdidos', formato: 'numero', acumulable: true, mejor: 'baja',
    descripcion: 'Cuántos deals están en fase Perdido.',
    cuenta: esPerdido,
    calcular: ds => ds.filter(esPerdido).length,
  }),
  ticket: medida({
    id: 'ticket', etiqueta: 'Deal promedio', formato: 'moneda', acumulable: false,
    descripcion: 'Precio promedio de los deals ganados que tienen precio.',
    cuenta: d => esGanado(d) && conPrecio(d),
    calcular: (ds, o) => {
      const w = ds.filter(d => esGanado(d) && conPrecio(d));
      return w.length === 0 ? 0 : suma(w, d => precio(d, o.moneda)) / w.length;
    },
  }),
  conversion: medida({
    id: 'conversion', etiqueta: 'Tasa de cierre', formato: 'porcentaje', acumulable: false,
    descripcion: 'Ganados entre los deals que llegaron a cotización enviada, negociación, ganado o perdido.',
    cuenta: llegoACotizacion,
    calcular: ds => {
      const base = ds.filter(llegoACotizacion);
      return base.length === 0 ? null : base.filter(esGanado).length / base.length;
    },
  }),
  cicloMediano: medida({
    id: 'cicloMediano', etiqueta: 'Días de cierre (mediana)', formato: 'dias', acumulable: false, mejor: 'baja',
    descripcion: 'Mediana de días entre la propuesta y la aprobación, en los deals ganados que tienen las dos fechas.',
    cuenta: d => diasDeCierre(d) !== null,
    calcular: ds => mediana(ds.map(diasDeCierre).filter((n): n is number => n !== null)),
  }),
  costo: medida({
    id: 'costo', etiqueta: 'Costo cotizado', formato: 'moneda', acumulable: true, mejor: 'baja',
    descripcion: 'Suma del «costo cotizado» de los deals ganados. Ojo: ese campo no siempre es el costo real del proyecto.',
    cuenta: esGanado,
    calcular: (ds, o) => suma(ds.filter(esGanado), d => costo(d, o.moneda)),
  }),
  margen: medida({
    id: 'margen', etiqueta: 'Margen (precio − costo cotizado)', formato: 'moneda', acumulable: true,
    descripcion: 'Precio menos «costo cotizado» de los deals ganados. Ojo: el costo cotizado no siempre es el costo real, así que el margen puede no ser confiable.',
    cuenta: esGanado,
    calcular: (ds, o) => suma(ds.filter(esGanado), d => precio(d, o.moneda) - costo(d, o.moneda)),
  }),
};

export const MEDIDAS_ORDEN = ['ingresos', 'dealsGanados', 'deals', 'ticket', 'conversion', 'cicloMediano', 'perdidos', 'costo', 'margen'];

// ── Cortes (dimensiones) ──────────────────────────────────────────────────────

export interface DimensionDef {
  id: string;
  etiqueta: string;
  grupo: 'Tiempo' | 'Comercial' | 'Proyecto';
  tipo: 'tiempo' | 'categoria';
  /** Cómo se llama lo que no tiene valor. */
  vacio: string;
  /** Valores con un orden propio (p. ej. las fases del embudo); lo demás va después. */
  natural?: string[];
  /** Sin lista natural, cómo se ordena si nadie pidió otra cosa: por lo que valen (por defecto) o por su nombre. */
  ordenDefault?: 'valor' | 'etiqueta';
  /** Eje de calendario (los 12 meses, los 4 trimestres): se muestran siempre todos sus valores naturales, aunque alguno no tenga nada, para no comprimir el eje. */
  calendario?: boolean;
  claves: (d: Deal, ctx: Contexto) => string[];
}

export const TIEMPO = 'tiempo';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const porTexto = (campo: (d: Deal) => unknown) => (d: Deal): string[] => {
  const t = texto(campo(d));
  return t ? [t] : [];
};

function responsableDe(d: Deal, ctx: Contexto): string[] {
  const o = Array.isArray(d.owner) ? d.owner : d.owner ? [d.owner] : [];
  const id = o.find(x => texto(x));
  return id ? [ctx.nombreDe?.(id) ?? id] : [];
}

const FECHA_BASE: FechaRef = { campo: 'aprobacion', alterna: true };
const deFecha = (parte: (f: ISO) => string) => (d: Deal, ctx: Contexto): string[] => {
  const f = fechaDeDeal(d, ctx.fecha ?? FECHA_BASE);
  return f ? [parte(f)] : [];
};

export const DIMENSIONES: Record<string, DimensionDef> = {
  [TIEMPO]: { id: TIEMPO, etiqueta: 'Tiempo', grupo: 'Tiempo', tipo: 'tiempo', vacio: 'Sin fecha', claves: () => [] },
  cliente: { id: 'cliente', etiqueta: 'Cliente', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin cliente', claves: porTexto(d => d.client) },
  fase: { id: 'fase', etiqueta: 'Fase', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin fase', natural: FASES, claves: porTexto(d => d.phase) },
  responsable: { id: 'responsable', etiqueta: 'Responsable', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin responsable', claves: responsableDe },
  hechaPor: { id: 'hechaPor', etiqueta: 'Cotizó', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin dato', claves: porTexto(d => d.hechaPor) },
  empresaOperadora: { id: 'empresaOperadora', etiqueta: 'Empresa operadora', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin empresa', claves: porTexto(d => d.empresaOperadora) },
  moneda: { id: 'moneda', etiqueta: 'Moneda', grupo: 'Comercial', tipo: 'categoria', vacio: 'Sin moneda', claves: d => [monedaDe(d)] },
  anio: { id: 'anio', etiqueta: 'Año', grupo: 'Tiempo', tipo: 'categoria', vacio: 'Sin fecha', ordenDefault: 'etiqueta', claves: deFecha(f => String(parseISO(f).y)) },
  trimestreAnio: { id: 'trimestreAnio', etiqueta: 'Trimestre (Q1–Q4)', grupo: 'Tiempo', tipo: 'categoria', vacio: 'Sin fecha', natural: ['Q1', 'Q2', 'Q3', 'Q4'], calendario: true, claves: deFecha(f => `Q${trimestreDe(parseISO(f).m)}`) },
  mesAnio: { id: 'mesAnio', etiqueta: 'Mes (Ene–Dic)', grupo: 'Tiempo', tipo: 'categoria', vacio: 'Sin fecha', natural: MESES_ETIQUETA, calendario: true, claves: deFecha(f => MESES_ETIQUETA[parseISO(f).m - 1]) },
  tipoProyecto: { id: 'tipoProyecto', etiqueta: 'Tipo de proyecto', grupo: 'Proyecto', tipo: 'categoria', vacio: 'Sin tipo', claves: porTexto(d => d.projectType) },
  tematica: { id: 'tematica', etiqueta: 'Temática', grupo: 'Proyecto', tipo: 'categoria', vacio: 'Sin temática', claves: porTexto(d => d.tematica) },
  statusPropuesta: { id: 'statusPropuesta', etiqueta: 'Estado de la propuesta', grupo: 'Proyecto', tipo: 'categoria', vacio: 'Sin dato', claves: porTexto(d => d.statusPropuesta) },
};

export const DIMENSIONES_ORDEN = ['tiempo', 'anio', 'trimestreAnio', 'mesAnio', 'cliente', 'fase', 'responsable', 'hechaPor', 'empresaOperadora', 'moneda', 'tipoProyecto', 'tematica', 'statusPropuesta'];

/** Las claves de un deal en un corte; si no tiene valor, la etiqueta de «sin dato». */
export function clavesDe(def: DimensionDef, d: Deal, ctx: Contexto): string[] {
  const k = def.claves(d, ctx);
  return k.length ? k : [def.vacio];
}

/** Valores que existen en los deals para un corte, con cuántos deals tienen cada uno; para armar un filtro. */
export function valoresDe(campo: string, deals: Deal[], ctx: Contexto): { valor: string; n: number }[] {
  const def = propio(DIMENSIONES, campo) ? DIMENSIONES[campo] : undefined;
  if (!def || def.tipo === 'tiempo') return [];
  const cuenta = new Map<string, number>();
  for (const d of deals) for (const k of clavesDe(def, d, ctx)) cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  const lista = [...cuenta.entries()].map(([valor, n]) => ({ valor, n }));
  const nat = def.natural ?? [];
  return lista.sort((a, b) => {
    const ia = nat.indexOf(a.valor);
    const ib = nat.indexOf(b.valor);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return b.n - a.n || a.valor.localeCompare(b.valor, 'es');
  });
}
