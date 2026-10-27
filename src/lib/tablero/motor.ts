// Motor del tablero comercial: ejecuta la «receta» de un bloque (medidas, cortes, cruce, filtros, periodo y comparación) sobre los deals y devuelve una tabla lista
// para dibujar. No sabe de gráficas ni de pantallas: las medidas y los cortes salen del registro (campos.ts) y los periodos de periodos.ts.
import { ISO, iso, parseISO, sumarAnios, trimestreDe, MESES_ETIQUETA } from './fechas';
import { resolverPeriodos } from './periodos';
import type { Rango, PeriodosResueltos } from './periodos';
import { DIMENSIONES, MEDIDAS, TIEMPO, clavesDe, fechaDeDeal, monedaDe, propio } from './campos';
import type {
  CeldaRes, ConsultaBloque, ConsultaCompleta, Contexto, Deal, DimensionRef, EjeItem, FilaRes, Filtro, Granularidad, MedidaDef, MonedaAlcance, Resultado, Tablero,
} from './tipos';

type Lado = 'actual' | 'previo';
interface Opciones { moneda: MonedaAlcance }

/** Junta lo que el bloque hereda del tablero (periodo, comparación, fecha y filtros) con lo suyo. */
export function resolverConsulta(c: ConsultaBloque, t: Pick<Tablero, 'periodo' | 'comparacion' | 'fecha' | 'filtros'>): ConsultaCompleta {
  return {
    ...c,
    filtros: [...t.filtros, ...c.filtros],
    periodo: c.periodo ?? t.periodo,
    comparacion: c.comparacion ?? t.comparacion,
    fecha: c.fecha ?? t.fecha,
  };
}

// ── Tiempo ────────────────────────────────────────────────────────────────────

/** Número consecutivo del mes, trimestre o año de una fecha; sirve para alinear periodos distintos posición por posición. */
function numeroBucket(fecha: ISO, g: Granularidad): number {
  const { y, m } = parseISO(fecha);
  if (g === 'anio') return y;
  if (g === 'trimestre') return y * 4 + trimestreDe(m) - 1;
  return y * 12 + m - 1;
}

function inicioBucket(n: number, g: Granularidad): ISO {
  if (g === 'anio') return iso(n, 1, 1);
  if (g === 'trimestre') return iso(Math.floor(n / 4), (n % 4) * 3 + 1, 1);
  return iso(Math.floor(n / 12), (n % 12) + 1, 1);
}

function etiquetaBucket(n: number, g: Granularidad, sinAnio: boolean): string {
  if (g === 'anio') return String(n);
  if (g === 'trimestre') return sinAnio ? `Q${(n % 4) + 1}` : `Q${(n % 4) + 1} ${Math.floor(n / 4)}`;
  return sinAnio ? MESES_ETIQUETA[n % 12] : `${MESES_ETIQUETA[n % 12]} ${Math.floor(n / 12)}`;
}

interface EjeConstruido {
  esTiempo: boolean;
  items: EjeItem[];
  /** Las claves de un deal en este eje, ya alineadas con el periodo actual (un deal del periodo previo cae en la misma posición que su equivalente de ahora). */
  claveDe: (d: Deal, lado: Lado) => string[];
}

function ejeDeTiempo(
  g: Granularidad, actuales: Deal[], per: PeriodosResueltos, ctx: Contexto, fechaDe: (d: Deal) => ISO | undefined,
): EjeConstruido {
  let inicioN: number;
  let finN: number;
  if (per.actual) {
    inicioN = numeroBucket(per.actual.inicio, g);
    finN = numeroBucket(per.actual.fin, g);
  } else {
    // Todo el historial: de la primera a la última fecha que hay, sin contar las que no pueden ser reales (un año mal tecleado alargaría la gráfica a cientos de tramos).
    const techo = sumarAnios(ctx.hoy, 2);
    const fechas = actuales.map(fechaDe).filter((f): f is ISO => !!f && f >= '1990-01-01' && f <= techo).sort();
    if (fechas.length === 0) return { esTiempo: true, items: [], claveDe: () => [] };
    inicioN = numeroBucket(fechas[0], g);
    finN = numeroBucket(fechas[fechas.length - 1], g);
  }
  const inicioPrevN = per.previo ? numeroBucket(per.previo.inicio, g) : 0;
  const n = Math.min(
    600,
    Math.max(finN - inicioN + 1, per.previo ? numeroBucket(per.previo.fin, g) - inicioPrevN + 1 : 0),
  );
  const hoyN = numeroBucket(ctx.hoy, g);
  const sinAnio = g !== 'anio' && Math.floor((inicioN) / (g === 'mes' ? 12 : 4)) === Math.floor((inicioN + n - 1) / (g === 'mes' ? 12 : 4));
  const items: EjeItem[] = Array.from({ length: Math.max(0, n) }, (_, i) => ({
    clave: String(i),
    etiqueta: etiquetaBucket(inicioN + i, g, sinAnio),
    futuro: inicioN + i > hoyN,
  }));
  return {
    esTiempo: true,
    items,
    claveDe: (d, lado) => {
      const f = fechaDe(d);
      if (!f) return [];
      const idx = numeroBucket(f, g) - (lado === 'actual' ? inicioN : inicioPrevN);
      return idx >= 0 && idx < items.length ? [String(idx)] : [];
    },
  };
}

function ejeDeCategoria(campo: string, actuales: Deal[], previos: Deal[] | null, ctx: Contexto): EjeConstruido | null {
  const def = propio(DIMENSIONES, campo) ? DIMENSIONES[campo] : undefined;
  if (!def || def.tipo === 'tiempo') return null;
  const vistos = new Set<string>();
  const items: EjeItem[] = [];
  // Un eje de calendario muestra siempre todos sus valores (los 12 meses, los 4 trimestres), tengan o no deals.
  if (def.calendario) for (const k of def.natural ?? []) { vistos.add(k); items.push({ clave: k, etiqueta: k }); }
  for (const ds of [actuales, previos ?? []]) {
    for (const d of ds) {
      for (const k of clavesDe(def, d, ctx)) {
        if (!vistos.has(k)) { vistos.add(k); items.push({ clave: k, etiqueta: k }); }
      }
    }
  }
  return { esTiempo: false, items, claveDe: d => clavesDe(def, d, ctx) };
}

function construirEje(
  ref: DimensionRef | undefined, actuales: Deal[], previos: Deal[] | null, per: PeriodosResueltos, ctx: Contexto, fechaDe: (d: Deal) => ISO | undefined,
): EjeConstruido | null {
  if (!ref) return null;
  if (ref.campo === TIEMPO) return ejeDeTiempo(ref.granularidad ?? 'mes', actuales, per, ctx, fechaDe);
  return ejeDeCategoria(ref.campo, actuales, previos, ctx);
}

// ── Filtros y periodos ────────────────────────────────────────────────────────

function cumpleFiltros(d: Deal, filtros: Filtro[], ctx: Contexto): boolean {
  for (const f of filtros) {
    const def = propio(DIMENSIONES, f.campo) ? DIMENSIONES[f.campo] : undefined;
    if (!def || def.tipo === 'tiempo' || f.valores.length === 0) continue;
    const coincide = clavesDe(def, d, ctx).some(k => f.valores.includes(k));
    if (f.excluir ? coincide : !coincide) return false;
  }
  return true;
}

/** Los deals con fecha dentro del rango. Con un rango activo, un deal sin esa fecha se queda fuera (igual que el dashboard anterior). */
function enRango(ds: Deal[], r: Rango | null, fechaDe: (d: Deal) => ISO | undefined): Deal[] {
  if (!r) return ds;
  return ds.filter(d => {
    const f = fechaDe(d);
    return !!f && f >= r.inicio && f <= r.fin;
  });
}

// ── Celdas ────────────────────────────────────────────────────────────────────

const unicos = (listas: Deal[][]): Deal[] => {
  const vistos = new Set<string>();
  const out: Deal[] = [];
  for (const l of listas) for (const d of l) if (!vistos.has(d.id)) { vistos.add(d.id); out.push(d); }
  return out;
};

/** Los deals que entran en la cifra de una celda: los que cuentan para alguna de sus medidas (ver `MedidaDef.cuenta`). Es lo que se ve al abrir el detalle. */
function queCuentan(ds: Deal[], medidas: MedidaDef[]): Deal[] {
  if (medidas.length === 0 || medidas.some(m => !m.cuenta)) return ds;
  return ds.filter(d => medidas.some(m => m.cuenta!(d)));
}

function celda(actual: Deal[], previo: Deal[] | null, medidas: MedidaDef[], opciones: Opciones, futuro: boolean): CeldaRes {
  // Un tramo que todavía no llega y no tiene deals es «sin dato»; si ya tiene deals (una fecha adelantada) sí se cuentan, para que el total y la serie cuadren.
  const oculto = futuro && actual.length === 0;
  return {
    valores: oculto ? medidas.map(() => null) : medidas.map(m => m.calcular(actual, opciones)),
    previos: previo ? medidas.map(m => m.calcular(previo, opciones)) : null,
    deals: oculto ? [] : queCuentan(actual, medidas),
    dealsPrevios: previo ? queCuentan(previo, medidas) : [],
  };
}

type Matriz = Map<string, Map<string, Deal[]>>;

function agrupar(ds: Deal[], lado: Lado, filas: EjeConstruido | null, cols: EjeConstruido | null): Matriz {
  const m: Matriz = new Map();
  for (const d of ds) {
    const fs = filas ? filas.claveDe(d, lado) : ['_'];
    const cs = cols ? cols.claveDe(d, lado) : ['_'];
    for (const f of fs) {
      let fila = m.get(f);
      if (!fila) { fila = new Map(); m.set(f, fila); }
      for (const c of cs) {
        const l = fila.get(c);
        if (l) l.push(d); else fila.set(c, [d]);
      }
    }
  }
  return m;
}

const vacia = (m: Matriz, f: string, c: string): Deal[] => m.get(f)?.get(c) ?? [];
const todasDeFila = (m: Matriz, f: string): Deal[] => unicos([...(m.get(f)?.values() ?? [])]);

function orden(a: number | null | undefined, b: number | null | undefined, dir: 'desc' | 'asc'): number {
  const x = a ?? 0;
  const y = b ?? 0;
  return dir === 'desc' ? y - x : x - y;
}

/** Un renglón o una columna tiene algo que mostrar si al menos un deal cuenta para sus medidas (ahora o en el periodo de comparación), aunque su cifra salga en cero. */
const hayAlgo = (c: CeldaRes): boolean => c.deals.length > 0 || c.dealsPrevios.length > 0;

// ── Ejecución ─────────────────────────────────────────────────────────────────

export function ejecutar(c: ConsultaCompleta, todos: Deal[], ctx: Contexto): Resultado {
  const medidas = c.medidas.filter(id => propio(MEDIDAS, id)).map(id => MEDIDAS[id]);
  const moneda = c.moneda ?? 'todas';
  const opciones = { moneda };
  const cx: Contexto = { ...ctx, fecha: c.fecha };
  const per = resolverPeriodos(c.periodo, c.comparacion, cx.hoy);
  const fechaDe = (d: Deal) => fechaDeDeal(d, c.fecha);

  const base = todos.filter(d => (moneda === 'todas' || monedaDe(d) === moneda) && cumpleFiltros(d, c.filtros, cx));
  const actuales = enRango(base, per.actual, fechaDe);
  const previos = per.previo ? enRango(base, per.previo, fechaDe) : null;

  const ejeF = construirEje(c.filas, actuales, previos, per, cx, fechaDe);
  let ejeC = construirEje(c.columnas, actuales, previos, per, cx, fechaDe);
  // Cruzar un corte consigo mismo no dice nada: se ignora.
  if (ejeC && c.filas && c.columnas && c.columnas.campo === c.filas.campo && c.columnas.campo !== TIEMPO) ejeC = null;

  const mA = agrupar(actuales, 'actual', ejeF, ejeC);
  const mP = previos ? agrupar(previos, 'previo', ejeF, ejeC) : null;
  const vacioP: Matriz = new Map();
  const matP = mP ?? vacioP;
  const deDeColumna = (mat: Matriz, clave: string): Deal[] => unicos([...mat.keys()].map(f => vacia(mat, f, clave)));

  // ── Columnas: orden, límite y «Otros» ──
  let itemsC: EjeItem[] = ejeC ? ejeC.items : [{ clave: '_', etiqueta: medidas.length === 1 ? medidas[0].etiqueta : 'Valor' }];
  if (ejeC && !ejeC.esTiempo) {
    const def = DIMENSIONES[c.columnas!.campo];
    const total = (clave: string): number => {
      const v = medidas[0]?.calcular(deDeColumna(mA, clave), opciones);
      return v ? v : (medidas[0]?.calcular(deDeColumna(matP, clave), opciones) ?? 0);
    };
    // Una columna en la que ningún deal cuenta (solo perdidos para los ingresos, p. ej.) no aporta: no se muestra. Las de calendario (los 12 meses) salen todas.
    const conValor = (clave: string): boolean =>
      queCuentan(deDeColumna(mA, clave), medidas).length > 0 || (!!previos && queCuentan(deDeColumna(matP, clave), medidas).length > 0);
    itemsC = itemsC.filter(i => (def?.calendario && def.natural?.includes(i.clave)) || conValor(i.clave));
    const pesos = new Map(itemsC.map(i => [i.clave, total(i.clave)]));
    const nat = def?.natural ?? [];
    itemsC = [...itemsC].sort((a, b) => {
      const ia = nat.indexOf(a.clave);
      const ib = nat.indexOf(b.clave);
      if (nat.length && (ia !== -1 || ib !== -1)) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      if (def?.ordenDefault === 'etiqueta') return a.etiqueta.localeCompare(b.etiqueta, 'es');
      return orden(pesos.get(a.clave), pesos.get(b.clave), 'desc');
    });
    const limiteC = def?.calendario ? itemsC.length : Math.max(1, c.limiteColumnas ?? 8); // los meses del año no se juntan en «Otros»
    if (itemsC.length > limiteC) {
      const resto = new Set(itemsC.slice(limiteC - 1).map(i => i.clave));
      itemsC = [...itemsC.slice(0, limiteC - 1), { clave: '__otros', etiqueta: 'Otros', esOtros: true }];
      for (const m of [mA, matP]) {
        for (const fila of m.values()) {
          const juntar: Deal[][] = [];
          for (const k of resto) { const l = fila.get(k); if (l) { juntar.push(l); fila.delete(k); } }
          if (juntar.length) fila.set('__otros', unicos(juntar));
        }
      }
    }
  }

  // ── Filas ──
  const itemsF: EjeItem[] = ejeF ? ejeF.items : [{ clave: '_', etiqueta: 'Total' }];
  const futuroC = (clave: string): boolean => !!itemsC.find(i => i.clave === clave)?.futuro;

  let filas: FilaRes[] = itemsF.map(item => {
    const celdas = itemsC.map(col => celda(vacia(mA, item.clave, col.clave), mP ? vacia(matP, item.clave, col.clave) : null, medidas, opciones, !!item.futuro || futuroC(col.clave)));
    const total = celda(todasDeFila(mA, item.clave), mP ? todasDeFila(matP, item.clave) : null, medidas, opciones, !!item.futuro);
    return { ...item, celdas, total };
  });

  if (ejeF && !ejeF.esTiempo) {
    const def = DIMENSIONES[c.filas!.campo];
    const nat = def?.natural ?? [];
    const modo = c.orden ?? (nat.length ? 'natural' : def?.ordenDefault === 'etiqueta' ? 'etiqueta' : 'valor-desc');
    // Un renglón en el que ningún deal cuenta (solo perdidos para los ingresos, p. ej.) no aporta; uno que sí tiene deals se queda aunque su cifra sea 0 (0 % de cierre).
    filas = filas.filter(f => hayAlgo(f.total) || (def?.calendario && nat.includes(f.clave)));
    const valor = (f: FilaRes) => f.total.valores[0] ?? f.total.previos?.[0] ?? 0;
    filas.sort((a, b) => {
      if (modo === 'natural') {
        const ia = nat.indexOf(a.clave);
        const ib = nat.indexOf(b.clave);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        return valor(b) - valor(a);
      }
      if (modo === 'etiqueta') return a.etiqueta.localeCompare(b.etiqueta, 'es');
      return orden(valor(a), valor(b), modo === 'valor-asc' ? 'asc' : 'desc');
    });
    filas = filas.slice(0, Math.max(1, c.limite ?? 50));
  }

  // ── Acumulado a lo largo del tiempo ──
  if (c.acumulado && ejeF?.esTiempo) {
    medidas.forEach((m, k) => {
      if (!m.acumulable) return;
      itemsC.forEach((_, j) => {
        let corridoA = 0;
        let corridoP = 0;
        for (const f of filas) {
          const ce = f.celdas[j];
          if (ce.valores[k] !== null) { corridoA += ce.valores[k] as number; ce.valores[k] = corridoA; }
          if (ce.previos && ce.previos[k] !== null) { corridoP += ce.previos[k] as number; ce.previos[k] = corridoP; }
        }
      });
      // El total de cada renglón (todas las columnas juntas) corre igual, para que la columna «Total» de la tabla siga a las celdas.
      let totalA = 0;
      let totalP = 0;
      for (const f of filas) {
        const t = f.total;
        if (t.valores[k] !== null) { totalA += t.valores[k] as number; t.valores[k] = totalA; }
        if (t.previos && t.previos[k] !== null) { totalP += t.previos[k] as number; t.previos[k] = totalP; }
      }
    });
  }

  const total = celda(actuales, previos, medidas, opciones, false);
  // El total de cada columna sobre todos los renglones, también los que el límite dejó fuera (sin cruce, la única columna es el total).
  const totalColumnas = ejeC
    ? itemsC.map(col => celda(deDeColumna(mA, col.clave), mP ? deDeColumna(matP, col.clave) : null, medidas, opciones, !!col.futuro))
    : [total];
  return {
    medidas,
    filas,
    columnas: itemsC,
    hayCruce: !!ejeC,
    filasEsTiempo: !!ejeF?.esTiempo,
    columnasEsTiempo: !!ejeC?.esTiempo,
    total,
    totalColumnas,
    periodos: per,
    sinDatos: actuales.length === 0 && (previos?.length ?? 0) === 0,
  };
}
