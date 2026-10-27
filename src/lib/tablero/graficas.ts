// Tipos de gráfica del tablero y cuáles tienen sentido según cómo está armada la consulta (qué se mide, cómo se corta y si se cruza).
import { TIEMPO } from './campos';
import type { ConsultaBloque, TipoGrafica } from './tipos';

export interface GraficaDef {
  id: TipoGrafica;
  etiqueta: string;
}

export const GRAFICAS: Record<TipoGrafica, GraficaDef> = {
  kpi: { id: 'kpi', etiqueta: 'Cifra' },
  barras: { id: 'barras', etiqueta: 'Barras' },
  barrasApiladas: { id: 'barrasApiladas', etiqueta: 'Barras apiladas' },
  lineas: { id: 'lineas', etiqueta: 'Líneas' },
  area: { id: 'area', etiqueta: 'Área' },
  pie: { id: 'pie', etiqueta: 'Pastel' },
  dona: { id: 'dona', etiqueta: 'Dona' },
  ranking: { id: 'ranking', etiqueta: 'Ranking' },
  embudo: { id: 'embudo', etiqueta: 'Embudo' },
  dispersion: { id: 'dispersion', etiqueta: 'Dispersión' },
  tabla: { id: 'tabla', etiqueta: 'Tabla' },
};

type Forma = Pick<ConsultaBloque, 'filas' | 'columnas' | 'medidas'>;

/** Las gráficas que se pueden usar con esta consulta, en el orden en que conviene ofrecerlas (la primera es la sugerida). */
export function graficasValidas(c: Forma): TipoGrafica[] {
  const filas = c.filas;
  const cruce = !!c.columnas;
  if (!filas) return ['kpi', 'tabla'];
  const tiempo = filas.campo === TIEMPO;
  if (tiempo) return cruce ? ['barras', 'barrasApiladas', 'lineas', 'area', 'tabla'] : ['barras', 'lineas', 'area', 'tabla'];
  if (cruce) return ['barras', 'barrasApiladas', 'tabla'];
  if (c.medidas.length >= 2) return ['dispersion', 'tabla'];
  const base: TipoGrafica[] = filas.campo === 'fase' ? ['embudo', 'barras', 'dona', 'pie', 'ranking', 'tabla'] : ['barras', 'ranking', 'dona', 'pie', 'tabla'];
  // La dispersión necesita dos medidas; al elegirla el editor agrega la segunda.
  return [...base, 'dispersion'];
}

export const graficaSugerida = (c: Forma): TipoGrafica => graficasValidas(c)[0];

/** Cuántas medidas caben en cada gráfica: la tabla muestra varias, la dispersión compara dos y las demás dibujan una. */
export const maxMedidas = (tipo: TipoGrafica): number => (tipo === 'tabla' ? 6 : tipo === 'dispersion' ? 2 : 1);

/** Si la gráfica elegida ya no sirve con la consulta (se cambió el corte, por ejemplo), la que la reemplaza. */
export function graficaCompatible(tipo: TipoGrafica, c: Forma): TipoGrafica {
  const validas = graficasValidas(c);
  return validas.includes(tipo) ? tipo : validas[0];
}
