// Tipos del tablero comercial. La idea central: un bloque es una «receta» guardada (qué mido, cómo lo corto, con qué lo cruzo, qué gráfica, qué estilo y qué
// filtros) y el motor (motor.ts) la ejecuta sobre los deals. Nada está fijo en listas dentro del motor: las medidas y los cortes viven en un registro (campos.ts).
import type { ISO } from './fechas';
import type { Comparacion, Periodo, PeriodosResueltos } from './periodos';

/** Un deal tal como lo manda getDeals. Solo lo que el tablero usa. */
export interface Deal {
  id: string;
  dealName?: string;
  phase?: string;
  client?: string;
  projectType?: string;
  tematica?: string;
  owner?: string[] | string;
  proposalDate?: string;
  approvalDate?: string;
  fechaDeBrief?: string;
  fechaPerdida?: string;
  currency?: string;
  clientPrice?: number;
  quotedCost?: number;
  exchangeRate?: number;
  empresaOperadora?: string;
  statusPropuesta?: string;
  hechaPor?: string;
}

export interface Contexto {
  /** Fecha de hoy (AAAA-MM-DD). Se inyecta para poder probar con cualquier fecha. */
  hoy: ISO;
  /** Id de usuario → nombre, para mostrar a la persona responsable y no su identificador. */
  nombreDe?: (id: string) => string | undefined;
  /** La fecha de referencia de la consulta en curso; la ponen los cortes que dependen de ella (año, trimestre y mes del año). */
  fecha?: FechaRef;
}

// ── Fechas de referencia ──────────────────────────────────────────────────────

export type FechaCampo = 'aprobacion' | 'propuesta' | 'brief' | 'perdida';

export interface FechaRef {
  campo: FechaCampo;
  /** Si al deal le falta esa fecha, usar la otra (aprobación ↔ propuesta) en lugar de dejarlo fuera. Así contaba el dashboard anterior. */
  alterna: boolean;
}

// ── Consulta ──────────────────────────────────────────────────────────────────

export type Granularidad = 'mes' | 'trimestre' | 'anio';
export type MonedaAlcance = 'todas' | 'MXN' | 'USD';

export interface DimensionRef {
  campo: string;
  /** Solo para el campo de tiempo. */
  granularidad?: Granularidad;
}

export interface Filtro {
  campo: string;
  valores: string[];
  /** true = dejar fuera lo que coincida en lugar de dejar solo eso. */
  excluir?: boolean;
}

export type OrdenFilas = 'valor-desc' | 'valor-asc' | 'etiqueta' | 'natural';

/** Lo que se guarda en un bloque. Los campos opcionales de periodo, comparación y fecha, si faltan, se heredan del tablero. */
export interface ConsultaBloque {
  medidas: string[];
  filas?: DimensionRef;
  columnas?: DimensionRef;
  /** Filtros propios del bloque; se suman a los del tablero. */
  filtros: Filtro[];
  orden?: OrdenFilas;
  limite?: number;
  limiteColumnas?: number;
  /** Suma corrida a lo largo del tiempo (solo con filas de tiempo y medidas que se pueden sumar). */
  acumulado?: boolean;
  moneda?: MonedaAlcance;
  periodo?: Periodo;
  comparacion?: Comparacion;
  fecha?: FechaRef;
}

/** La consulta ya resuelta con lo heredado del tablero: lo que ejecuta el motor. */
export interface ConsultaCompleta extends Omit<ConsultaBloque, 'periodo' | 'comparacion' | 'fecha'> {
  periodo: Periodo;
  comparacion: Comparacion;
  fecha: FechaRef;
}

// ── Resultado ─────────────────────────────────────────────────────────────────

export type Formato = 'moneda' | 'numero' | 'porcentaje' | 'dias';

export interface MedidaDef {
  id: string;
  etiqueta: string;
  formato: Formato;
  /** Qué cuenta y con qué reglas, para mostrarlo a quien lo use. */
  descripcion: string;
  /** Se puede sumar a lo largo del tiempo (acumulado). Los promedios y porcentajes no. */
  acumulable: boolean;
  /** Si subir es bueno o malo (deals perdidos, días de cierre y costo: bajar es mejor); decide el color de los cambios. */
  mejor?: 'sube' | 'baja';
  /**
   * Qué deals entran en la cifra (ganados para los ingresos, los que llegaron a cotización para la tasa de cierre…). Es lo que se ve al abrir el detalle de una celda y
   * lo que decide si un renglón o una columna tiene algo que mostrar. Si falta, entran todos. Debe cumplirse que `calcular(ds)` sea igual a `calcular(ds.filter(cuenta))`.
   */
  cuenta?: (deal: Deal) => boolean;
  calcular: (deals: Deal[], opciones: { moneda: MonedaAlcance }) => number | null;
}

export interface CeldaRes {
  /** Un valor por medida; null = sin dato (p. ej. un mes que todavía no llega). */
  valores: (number | null)[];
  /** Lo mismo del periodo con el que se compara; null si no se compara. */
  previos: (number | null)[] | null;
  /** Los deals que entran en la cifra (los que cuentan para sus medidas, ver `MedidaDef.cuenta`). */
  deals: Deal[];
  dealsPrevios: Deal[];
}

export interface EjeItem {
  clave: string;
  etiqueta: string;
  /** Agrupa lo que no cupo en el límite de columnas. */
  esOtros?: boolean;
  /** Tramo de tiempo que todavía no llega. */
  futuro?: boolean;
}

export interface FilaRes extends EjeItem {
  celdas: CeldaRes[];
  total: CeldaRes;
}

export interface Resultado {
  medidas: MedidaDef[];
  filas: FilaRes[];
  /** Una columna implícita cuando no hay cruce. */
  columnas: EjeItem[];
  hayCruce: boolean;
  filasEsTiempo: boolean;
  columnasEsTiempo: boolean;
  /** Todo junto, sin importar el límite de renglones. */
  total: CeldaRes;
  /** El total de cada columna sobre todos los renglones (también los que el límite dejó fuera), en el orden de `columnas`. */
  totalColumnas: CeldaRes[];
  periodos: PeriodosResueltos;
  sinDatos: boolean;
}

// ── Bloques y tablero ─────────────────────────────────────────────────────────

export type TipoGrafica =
  | 'kpi' | 'barras' | 'barrasApiladas' | 'lineas' | 'area'
  | 'pie' | 'dona' | 'ranking' | 'embudo' | 'dispersion' | 'tabla';

export interface Estilo {
  paleta: string;
  etiquetas: boolean;
  leyenda: boolean;
  orientacion: 'auto' | 'vertical' | 'horizontal';
}

export interface Pos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bloque {
  id: string;
  titulo: string;
  tipo: TipoGrafica;
  consulta: ConsultaBloque;
  estilo: Estilo;
  pos: Pos;
}

export interface Tablero {
  v: 2;
  periodo: Periodo;
  comparacion: Comparacion;
  fecha: FechaRef;
  filtros: Filtro[];
  bloques: Bloque[];
}
