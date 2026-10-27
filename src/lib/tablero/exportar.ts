// Saca los datos de un bloque como texto para pegar en Excel o en un correo: una línea por renglón, columnas separadas por tabulador.
import { formatear } from './formato';
import type { MonedaAlcance, Resultado } from './tipos';

/** Una etiqueta con tabulador o salto de línea correría las columnas al pegar en Excel. */
const limpia = (t: string): string => t.replace(/[\t\r\n]+/g, ' ');

export function tablaComoTexto(res: Resultado, moneda: MonedaAlcance = 'todas'): string {
  const f = (v: number | null, k: number) => (v === null ? '' : formatear(v, res.medidas[k].formato, moneda, false));
  const comparando = !!res.periodos.previo;
  const lineas: string[][] = [];
  if (res.hayCruce) {
    lineas.push(['', ...res.columnas.map(c => limpia(c.etiqueta)), 'Total']);
    for (const fila of res.filas) lineas.push([limpia(fila.etiqueta), ...fila.celdas.map(c => f(c.valores[0], 0)), f(fila.total.valores[0], 0)]);
  } else {
    const cabecera = ['', ...res.medidas.flatMap(m => (comparando ? [`${m.etiqueta} (${res.periodos.etiquetaActual})`, `${m.etiqueta} (${res.periodos.etiquetaPrevio})`] : [m.etiqueta]))];
    lineas.push(cabecera);
    for (const fila of res.filas) {
      lineas.push([limpia(fila.etiqueta), ...res.medidas.flatMap((_, k) => (comparando ? [f(fila.celdas[0].valores[k], k), f(fila.celdas[0].previos?.[k] ?? null, k)] : [f(fila.celdas[0].valores[k], k)]))]);
    }
  }
  return lineas.map(l => l.join('\t')).join('\n');
}
