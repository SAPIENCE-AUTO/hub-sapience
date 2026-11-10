// Colores de la estadística por reclutador. El mismo tono siempre quiere decir lo mismo, en las barras, en la leyenda y en las cajitas:
// verde = respuestas nuevas, ámbar de claro a oscuro = repetidas (con 1, 2, 3 o 4 o más proyectos anteriores) y gris = contacto compartido.
// Aparte de las rampas roja y azul de «no elegibles» y «elegibles» (colores.ts), para no confundir una cosa con la otra.
import { EXITO } from '../../lib/toolColors';

export const COLOR_NUEVA = EXITO;
export const COLORES_REPETIDA = ['#F8D49A', '#F0AC52', '#DC7A09', '#9A4F05'];
export const COLOR_COMPARTIDO = '#B8C0CC';
