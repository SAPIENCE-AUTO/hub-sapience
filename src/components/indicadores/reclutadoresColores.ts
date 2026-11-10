// Colores de la estadística por reclutador. El mismo tono siempre quiere decir lo mismo, en las barras, en la leyenda y en las cajitas:
// verde = respuestas nuevas, ámbar de claro a oscuro = repetidas (con 1, 2 … 7 u 8 o más proyectos anteriores) y gris = contacto compartido.
// Aparte de las rampas roja y azul de «no elegibles» y «elegibles» (colores.ts), para no confundir una cosa con la otra.
import { EXITO } from '../../lib/toolColors';

export const COLOR_NUEVA = EXITO;
// Ocho pasos de un solo tono, de claro a oscuro (OKLCH L .775 a .335, de 0.063 en 0.063): pasa las comprobaciones de una rampa ordinal (monótona, pasos visibles,
// el más claro a 2:1 del fondo blanco). El verde de las nuevas queda a 20 de diferencia, también para daltónicos.
export const COLORES_REPETIDA = ['#E3AB42', '#D09638', '#BD812E', '#A96D25', '#955A1D', '#814815', '#6D360D', '#582606'];
export const COLOR_COMPARTIDO = '#B8C0CC';
