// Tablero guardado: cómo se arma uno nuevo, cómo se lee lo que viene de la base (sin confiar en que esté completo), cómo se guarda y cómo se traen las vistas del
// dashboard anterior. Las vistas del tablero nuevo viven en la misma tabla de vistas del dashboard (commercial_dashboard_views), con un viewId que empieza con «t2_»
// y un widgetsJson que es el tablero completo; el dashboard anterior ignora las que empiezan así.
import { DIMENSIONES, MEDIDAS, TIEMPO, propio } from './campos';
import { ANIO_MAX, ANIO_MIN, ISO, fechaValida, parseISO } from './fechas';
import { GRAFICAS, graficaCompatible, maxMedidas } from './graficas';
import type { Comparacion, Periodo } from './periodos';
import { PALETAS, PALETA_BASE } from './paletas';
import { COLUMNAS, MAX_BLOQUES, normalizar } from './rejilla';
import type { Bloque, ConsultaBloque, DimensionRef, Estilo, FechaRef, Filtro, Granularidad, MonedaAlcance, Pos, Tablero, TipoGrafica } from './tipos';

export const VISTA_PREFIJO = 't2_';
export const esVistaTablero = (viewId: string): boolean => viewId.startsWith(VISTA_PREFIJO);
export const nuevoIdVista = (): string => `${VISTA_PREFIJO}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const nuevoIdBloque = (): string => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const ESTILO_BASE: Estilo = { paleta: PALETA_BASE, etiquetas: false, leyenda: true, orientacion: 'auto' };
export const FECHA_BASE: FechaRef = { campo: 'aprobacion', alterna: true };

/** Lo más chico que puede quedar un bloque de cada tipo (una cifra cabe en poco; una gráfica necesita aire). */
export const minimoPorTipo = (tipo: TipoGrafica): { w: number; h: number } => (tipo === 'kpi' ? { w: 2, h: 2 } : { w: 3, h: 4 });

/** Tamaño (en la rejilla) con el que nace cada tipo de bloque. */
export const TAMANO_INICIAL: Record<TipoGrafica, { w: number; h: number }> = {
  kpi: { w: 3, h: 3 }, barras: { w: 6, h: 8 }, barrasApiladas: { w: 6, h: 8 }, lineas: { w: 6, h: 8 }, area: { w: 6, h: 8 },
  pie: { w: 4, h: 8 }, dona: { w: 4, h: 8 }, ranking: { w: 6, h: 8 }, embudo: { w: 4, h: 8 }, dispersion: { w: 6, h: 8 }, tabla: { w: 6, h: 8 },
};

const TITULO_MEDIDA = (id: string) => MEDIDAS[id]?.etiqueta ?? id;
const TITULO_DIM = (d?: DimensionRef) => (d ? (d.campo === TIEMPO ? { mes: 'mes', trimestre: 'trimestre', anio: 'año' }[d.granularidad ?? 'mes'] : DIMENSIONES[d.campo]?.etiqueta.toLowerCase() ?? d.campo) : '');

/** Un título razonable para un bloque, a partir de lo que mide y cómo lo corta. */
export function tituloSugerido(c: Pick<ConsultaBloque, 'medidas' | 'filas' | 'columnas'>): string {
  const medida = TITULO_MEDIDA(c.medidas[0] ?? '');
  const filas = TITULO_DIM(c.filas);
  const cruce = TITULO_DIM(c.columnas);
  if (!filas) return medida;
  return cruce ? `${medida} por ${filas} y ${cruce}` : `${medida} por ${filas}`;
}

export function bloqueNuevo(tipo: TipoGrafica, consulta: ConsultaBloque, pos: Pos, titulo?: string): Bloque {
  return { id: nuevoIdBloque(), titulo: titulo ?? tituloSugerido(consulta), tipo, consulta, estilo: { ...ESTILO_BASE }, pos };
}

// ── Tablero inicial ───────────────────────────────────────────────────────────

export function tableroInicial(hoy: ISO): Tablero {
  const anio = parseISO(hoy).y;
  const kpi = (medida: string, x: number): Bloque => bloqueNuevo('kpi', { medidas: [medida], filtros: [] }, { x, y: 0, w: 3, h: 3 });
  return {
    v: 2,
    periodo: { modo: 'anio', anio },
    comparacion: { modo: 'mismaFecha' },
    fecha: { ...FECHA_BASE },
    filtros: [],
    bloques: [
      kpi('ingresos', 0), kpi('dealsGanados', 3), kpi('ticket', 6), kpi('conversion', 9),
      bloqueNuevo('barras', { medidas: ['ingresos'], filas: { campo: TIEMPO, granularidad: 'mes' }, filtros: [] }, { x: 0, y: 3, w: 8, h: 8 }),
      bloqueNuevo('embudo', { medidas: ['deals'], filas: { campo: 'fase' }, filtros: [], comparacion: { modo: 'ninguna' } }, { x: 8, y: 3, w: 4, h: 8 }, 'Embudo comercial'),
      bloqueNuevo('ranking', { medidas: ['ingresos'], filas: { campo: 'cliente' }, limite: 10, filtros: [] }, { x: 0, y: 11, w: 6, h: 8 }),
      bloqueNuevo('dona', { medidas: ['ingresos'], filas: { campo: 'tipoProyecto' }, limite: 8, filtros: [], comparacion: { modo: 'ninguna' } }, { x: 6, y: 11, w: 6, h: 8 }),
    ],
  };
}

// ── Lectura defensiva ─────────────────────────────────────────────────────────

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const esNumero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const esTexto = (x: unknown): x is string => typeof x === 'string';
const esFecha = fechaValida;
const anioValido = (x: unknown): x is number => esNumero(x) && x >= ANIO_MIN && x <= ANIO_MAX;

function periodoValido(x: unknown): Periodo | undefined {
  if (!esObjeto(x)) return undefined;
  switch (x.modo) {
    case 'todo': return { modo: 'todo' };
    case 'anio': return anioValido(x.anio) ? { modo: 'anio', anio: Math.round(x.anio) } : undefined;
    case 'trimestre': return anioValido(x.anio) && esNumero(x.trimestre) && x.trimestre >= 1 && x.trimestre <= 4 ? { modo: 'trimestre', anio: Math.round(x.anio), trimestre: Math.round(x.trimestre) } : undefined;
    case 'mes': return anioValido(x.anio) && esNumero(x.mes) && x.mes >= 1 && x.mes <= 12 ? { modo: 'mes', anio: Math.round(x.anio), mes: Math.round(x.mes) } : undefined;
    case 'rango': return { modo: 'rango', inicio: esFecha(x.inicio) ? x.inicio.slice(0, 10) : undefined, fin: esFecha(x.fin) ? x.fin.slice(0, 10) : undefined };
    case 'ultimos': return esNumero(x.cantidad) && x.cantidad > 0 && x.cantidad <= 3650 && (x.unidad === 'dias' || x.unidad === 'meses') ? { modo: 'ultimos', cantidad: Math.max(1, Math.round(x.cantidad)), unidad: x.unidad } : undefined;
    default: return undefined;
  }
}

const leerPeriodo = (x: unknown, hoy: ISO): Periodo => periodoValido(x) ?? { modo: 'anio', anio: parseISO(hoy).y };

function leerComparacion(x: unknown): Comparacion | undefined {
  if (!esObjeto(x)) return undefined;
  switch (x.modo) {
    case 'ninguna': case 'mismaFecha': case 'anioCompleto': case 'anterior': return { modo: x.modo };
    case 'rango': return { modo: 'rango', inicio: esFecha(x.inicio) ? x.inicio.slice(0, 10) : undefined, fin: esFecha(x.fin) ? x.fin.slice(0, 10) : undefined };
    default: return undefined;
  }
}

function leerFecha(x: unknown): FechaRef | undefined {
  if (!esObjeto(x)) return undefined;
  const campos = ['aprobacion', 'propuesta', 'brief', 'perdida'];
  return esTexto(x.campo) && campos.includes(x.campo) ? { campo: x.campo as FechaRef['campo'], alterna: x.alterna !== false } : undefined;
}

function leerFiltros(x: unknown): Filtro[] {
  if (!Array.isArray(x)) return [];
  const out: Filtro[] = [];
  for (const f of x) {
    if (!esObjeto(f) || !esTexto(f.campo) || !propio(DIMENSIONES, f.campo) || DIMENSIONES[f.campo].tipo === 'tiempo') continue;
    const valores = Array.isArray(f.valores) ? f.valores.filter(esTexto) : [];
    if (valores.length) out.push({ campo: f.campo, valores, ...(f.excluir ? { excluir: true } : {}) });
  }
  return out;
}

function leerDimension(x: unknown): DimensionRef | undefined {
  if (!esObjeto(x) || !esTexto(x.campo) || !propio(DIMENSIONES, x.campo)) return undefined;
  if (x.campo === TIEMPO) {
    const g = ['mes', 'trimestre', 'anio'].includes(x.granularidad as string) ? (x.granularidad as Granularidad) : 'mes';
    return { campo: TIEMPO, granularidad: g };
  }
  return { campo: x.campo };
}

function leerConsulta(x: unknown): ConsultaBloque | null {
  if (!esObjeto(x)) return null;
  const medidas = (Array.isArray(x.medidas) ? x.medidas : []).filter((m): m is string => esTexto(m) && propio(MEDIDAS, m)).slice(0, 6);
  if (medidas.length === 0) return null;
  const c: ConsultaBloque = { medidas, filtros: leerFiltros(x.filtros) };
  const filas = leerDimension(x.filas);
  const columnas = leerDimension(x.columnas);
  if (filas) c.filas = filas;
  if (columnas && filas && !(columnas.campo === filas.campo && columnas.campo !== TIEMPO)) c.columnas = columnas;
  if (['valor-desc', 'valor-asc', 'etiqueta', 'natural'].includes(x.orden as string)) c.orden = x.orden as ConsultaBloque['orden'];
  if (esNumero(x.limite) && x.limite > 0) c.limite = Math.round(x.limite);
  if (esNumero(x.limiteColumnas) && x.limiteColumnas > 0) c.limiteColumnas = Math.round(x.limiteColumnas);
  if (x.acumulado === true) c.acumulado = true;
  if (x.moneda === 'MXN' || x.moneda === 'USD') c.moneda = x.moneda as MonedaAlcance;
  const periodo = periodoValido(x.periodo);
  if (periodo) c.periodo = periodo;
  const comp = leerComparacion(x.comparacion);
  if (comp) c.comparacion = comp;
  const fecha = leerFecha(x.fecha);
  if (fecha) c.fecha = fecha;
  return c;
}

function leerEstilo(x: unknown): Estilo {
  const e = esObjeto(x) ? x : {};
  return {
    paleta: esTexto(e.paleta) && propio(PALETAS, e.paleta) ? e.paleta : ESTILO_BASE.paleta,
    etiquetas: e.etiquetas === true,
    leyenda: e.leyenda !== false,
    orientacion: e.orientacion === 'vertical' || e.orientacion === 'horizontal' ? e.orientacion : 'auto',
  };
}

function leerBloque(x: unknown, usados: Set<string>): Bloque | null {
  if (!esObjeto(x)) return null;
  const consulta = leerConsulta(x.consulta);
  if (!consulta) return null;
  const tipoPedido = esTexto(x.tipo) && propio(GRAFICAS, x.tipo) ? (x.tipo as TipoGrafica) : 'barras';
  const tipo = graficaCompatible(tipoPedido, consulta);
  consulta.medidas = consulta.medidas.slice(0, maxMedidas(tipo));
  let id = esTexto(x.id) && x.id ? x.id : nuevoIdBloque();
  while (usados.has(id)) id = nuevoIdBloque();
  usados.add(id);
  const p = esObjeto(x.pos) ? x.pos : {};
  const pos: Pos = { x: Number(p.x) || 0, y: Number(p.y) || 0, w: Number(p.w) || TAMANO_INICIAL[tipo].w, h: Number(p.h) || TAMANO_INICIAL[tipo].h };
  return { id, titulo: esTexto(x.titulo) && x.titulo.trim() ? x.titulo : tituloSugerido(consulta), tipo, consulta, estilo: leerEstilo(x.estilo), pos };
}

/** Convierte lo guardado en un tablero válido: lo que no sirve se descarta o se reemplaza por su valor de siempre; nunca truena. */
export function sanearTablero(x: unknown, hoy: ISO): Tablero {
  const r = esObjeto(x) ? x : {};
  const usados = new Set<string>();
  const bloques = (Array.isArray(r.bloques) ? r.bloques.slice(0, MAX_BLOQUES) : []).map(b => leerBloque(b, usados)).filter((b): b is Bloque => !!b);
  return {
    v: 2,
    periodo: leerPeriodo(r.periodo, hoy),
    comparacion: leerComparacion(r.comparacion) ?? { modo: 'mismaFecha' },
    fecha: leerFecha(r.fecha) ?? { ...FECHA_BASE },
    filtros: leerFiltros(r.filtros),
    bloques: normalizar(bloques),
  };
}

export function leerTablero(json: string, hoy: ISO): Tablero | null {
  try {
    const x = JSON.parse(json);
    return esObjeto(x) && x.v === 2 ? sanearTablero(x, hoy) : null;
  } catch {
    return null;
  }
}

export const serializarTablero = (t: Tablero): string => JSON.stringify(t);

// ── Vistas del dashboard anterior ─────────────────────────────────────────────

const METRICA_ANTERIOR: Record<string, string> = {
  revenue: 'ingresos', dealCount: 'deals', avgTicket: 'ticket', margin: 'margen', cost: 'costo', conversionRate: 'conversion',
};
const CORTE_ANTERIOR: Record<string, string> = {
  client: 'cliente', projectType: 'tipoProyecto', tematica: 'tematica', owner: 'responsable', empresaOperadora: 'empresaOperadora', phase: 'fase',
};
const GRAFICA_ANTERIOR: Record<string, TipoGrafica> = {
  bar: 'barras', line: 'lineas', pie: 'pie', donut: 'dona', rankingTable: 'ranking', funnel: 'embudo', scatter: 'dispersion', combo: 'barras',
};
const TIEMPO_ANTERIOR: Record<string, Granularidad> = { month: 'mes', quarter: 'trimestre', year: 'anio' };

function dimensionAnterior(g: unknown, otro?: unknown): DimensionRef | undefined {
  if (!esTexto(g)) return undefined;
  if (propio(TIEMPO_ANTERIOR, g)) {
    // «Mes por año» (comparar años mes a mes) se vuelve mes del año contra año.
    if (otro === 'year' && g !== 'year') return { campo: g === 'month' ? 'mesAnio' : 'trimestreAnio' };
    return { campo: TIEMPO, granularidad: TIEMPO_ANTERIOR[g] };
  }
  return propio(CORTE_ANTERIOR, g) ? { campo: CORTE_ANTERIOR[g] } : undefined;
}

function periodoDeVistaAnterior(p: unknown, hoy: ISO): Periodo {
  if (!esObjeto(p)) return { modo: 'todo' };
  const anio = esNumero(p.year) ? p.year : parseISO(hoy).y;
  const candidato = ((): Record<string, unknown> => {
    switch (p.mode) {
      case 'year': return { modo: 'anio', anio };
      case 'quarter': return { modo: 'trimestre', anio, trimestre: esNumero(p.quarter) ? p.quarter : 1 };
      case 'month': return { modo: 'mes', anio, mes: esNumero(p.month) ? p.month : 1 };
      case 'custom': return { modo: 'rango', inicio: p.startDate, fin: p.endDate };
      default: return { modo: 'todo' };
    }
  })();
  return periodoValido(candidato) ?? { modo: 'todo' };
}

/**
 * Convierte una vista del dashboard anterior en un tablero nuevo: los mismos filtros, la misma fecha de referencia y las mismas gráficas, más una fila de cifras
 * arriba (el dashboard anterior siempre las mostraba). Las gráficas se quedan sin comparar, como estaban.
 */
export function desdeVistaAnterior(
  v: { filtersJson: string; widgetsJson: string; dateReference: string },
  hoy: ISO,
  nombreDe?: (id: string) => string | undefined,
): Tablero {
  let filtros: Record<string, unknown> = {};
  try { const f = JSON.parse(v.filtersJson); if (esObjeto(f)) filtros = f; } catch { /* vista vieja sin filtros válidos */ }
  let widgets: unknown[] = [];
  try { const w = JSON.parse(v.widgetsJson); if (Array.isArray(w)) widgets = w; } catch { /* idem */ }

  const lista = (x: unknown): string[] => (Array.isArray(x) ? x.filter(esTexto) : []);
  const filtrosNuevos: Filtro[] = [];
  const agregar = (campo: string, valores: string[]) => { if (valores.length) filtrosNuevos.push({ campo, valores }); };
  agregar('cliente', lista(filtros.clients));
  agregar('tipoProyecto', lista(filtros.projectTypes));
  agregar('moneda', lista(filtros.currencies).map(c => c.trim().slice(0, 3).toUpperCase()));
  agregar('responsable', lista(filtros.owners).map(o => nombreDe?.(o) ?? o));
  agregar('empresaOperadora', lista(filtros.empresaOperadora));
  agregar('fase', lista(filtros.phases));

  const comp = filtros.compareMode === 'yoy' ? { modo: 'anioCompleto' as const } : filtros.compareMode === 'none' ? { modo: 'ninguna' as const } : { modo: 'anterior' as const };
  const kpi = (medida: string, x: number): Bloque => bloqueNuevo('kpi', { medidas: [medida], filtros: [] }, { x, y: 0, w: 3, h: 3 });
  const bloques: Bloque[] = [kpi('ingresos', 0), kpi('dealsGanados', 3), kpi('ticket', 6), kpi('conversion', 9)];

  let y = 3;
  let x = 0;
  for (const w of widgets) {
    if (!esObjeto(w)) continue;
    const medida = esTexto(w.metric) && propio(METRICA_ANTERIOR, w.metric) ? METRICA_ANTERIOR[w.metric] : undefined;
    const filas = dimensionAnterior(w.groupBy, w.compareBy);
    if (!medida || !filas) continue;
    const opciones = esObjeto(w.displayOptions) ? w.displayOptions : {};
    const cruce = esTexto(w.compareBy) && w.compareBy !== w.groupBy ? dimensionAnterior(w.compareBy) : undefined;
    // La dispersión del dashboard anterior comparaba dos métricas (la segunda, `metricY`, era el número de deals si no se elegía otra).
    const segunda = w.chartType === 'scatter' ? (esTexto(w.metricY) && propio(METRICA_ANTERIOR, w.metricY) ? METRICA_ANTERIOR[w.metricY] : 'deals') : undefined;
    const consulta: ConsultaBloque = { medidas: segunda ? [medida, segunda] : [medida], filas, filtros: [], comparacion: { modo: 'ninguna' } };
    if (cruce) {
      consulta.columnas = w.compareBy === 'year' && (w.groupBy === 'month' || w.groupBy === 'quarter') ? { campo: 'anio' } : cruce;
      const valores = lista(w.compareValues);
      if (valores.length && w.compareMode === 'manual' && consulta.columnas.campo !== TIEMPO) consulta.filtros.push({ campo: consulta.columnas.campo, valores });
    }
    if (esNumero(opciones.limit)) consulta.limite = opciones.limit;
    if (opciones.sortDirection === 'asc') consulta.orden = 'valor-asc';
    if (w.currency === 'MXN' || w.currency === 'USD') consulta.moneda = w.currency;
    if (w.metric === 'revenue' && w.groupBy === 'phase') consulta.orden = 'natural';

    const pedida = esTexto(w.chartType) && propio(GRAFICA_ANTERIOR, w.chartType) ? GRAFICA_ANTERIOR[w.chartType] : 'barras';
    const tipo = graficaCompatible(opciones.stacked === true && cruce && pedida === 'barras' ? 'barrasApiladas' : pedida, consulta);
    consulta.medidas = consulta.medidas.slice(0, maxMedidas(tipo));
    const ancho = w.size === 'full' ? 12 : 6;
    if (x + ancho > COLUMNAS) { x = 0; y += 8; }
    const bloque = bloqueNuevo(tipo, consulta, { x, y, w: ancho, h: 8 }, esTexto(w.name) && w.name.trim() ? w.name : undefined);
    bloque.estilo = { ...ESTILO_BASE, leyenda: opciones.showLegend === true, etiquetas: opciones.showDataLabels === true };
    bloques.push(bloque);
    x += ancho;
    if (x >= COLUMNAS) { x = 0; y += 8; }
  }

  return {
    v: 2,
    periodo: periodoDeVistaAnterior(filtros.period, hoy),
    comparacion: comp,
    fecha: { campo: v.dateReference === 'approvalDate' ? 'aprobacion' : 'propuesta', alterna: true },
    filtros: filtrosNuevos,
    bloques: normalizar(bloques),
  };
}
