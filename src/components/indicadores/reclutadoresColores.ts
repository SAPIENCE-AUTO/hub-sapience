// Colores de la estadística por reclutador. El mismo tono siempre quiere decir lo mismo, en las barras, en la leyenda, en las cajitas y en las gráficas de la evolución:
// morado = respuestas nuevas, ámbar de claro a oscuro = repetidas (con 1, 2 … 7 u 8 o más proyectos anteriores) y gris = contacto compartido.
// Aparte de las rampas roja y azul de «no elegibles» y «elegibles» (colores.ts), para no confundir una cosa con la otra.
import { AZUL, ROJO } from './colores';

// Nuevas en morado y no en verde (2026-11-10, por accesibilidad: lo tiene que poder leer quien no distingue rojo y verde): esa persona ve el verde de antes (#257E55)
// casi igual a los cafés de en medio (repetidas con 3 a 6 proyectos; distancia 5.5 de 8 que se piden). El morado queda a 26 de todos los tonos de la barra para el daltonismo
// rojo-verde y a 15 para el azul-amarillo, que es lo más raro (medido con la simulación de Machado 2009 y la distancia OKLab x100 de la skill dataviz); sobre blanco, contraste 5.8:1.
// Al azul de «elegibles» un daltónico rojo-verde lo ve parecido, pero nunca van en la misma gráfica. Si se cambia algún tono, volver a medir contra TODA la barra, no solo contra el vecino.
export const COLOR_NUEVA = '#6F4FC9';
// Ocho pasos de un solo tono, de claro a oscuro (OKLCH L .775 a .335, de 0.063 en 0.063): pasa las comprobaciones de una rampa ordinal (monótona, pasos visibles,
// el más claro a 2:1 del fondo blanco). El daltonismo no cambia la claridad, así que la rampa se lee igual de claro a oscuro; entre vecinos hay poco más de 6 de distancia,
// por eso el número exacto de cada tramo va también en el texto que sale al pasar el cursor, en la tabla de la evolución y no solo en el color.
export const COLORES_REPETIDA = ['#E3AB42', '#D09638', '#BD812E', '#A96D25', '#955A1D', '#814815', '#6D360D', '#582606'];
export const COLOR_COMPARTIDO = '#B8C0CC';

// La evolución mes por mes (EvolucionReclutador.tsx). Las repetidas se juntan en 4 tramos (1, 2 o 3, 4 a 7, 8 o más) con el tono de en medio de cada uno; «entraron» y los
// porcentajes de elegibles y no elegibles llevan los mismos azul y rojo de las rampas de colores.ts, y el porcentaje de repetidas el ámbar de en medio de la barra.
export const COLORES_TRAMOS_EVOLUCION = [COLORES_REPETIDA[0], COLORES_REPETIDA[2], COLORES_REPETIDA[5], COLORES_REPETIDA[7]] as const;
export const COLOR_ENTRARON_ELEGIBLES = AZUL[2];
export const COLOR_ENTRARON_NO_ELEGIBLES = ROJO[3];
export const COLOR_PCT_REPETIDAS = COLORES_REPETIDA[2];
export const COLOR_PCT_NO_ELEGIBLES = ROJO[3];
export const COLOR_PCT_ENTRO = AZUL[2];
