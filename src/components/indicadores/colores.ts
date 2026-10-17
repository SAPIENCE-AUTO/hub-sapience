// Rampas del número de veces que una persona ya había participado, de claro (1 vez) a oscuro (5 o más): rojo para los no elegibles y azul
// para los elegibles. El mismo tono siempre quiere decir lo mismo, en las cajitas, en las barras y en la leyenda.
import type { Grupo, Veces } from '../../lib/indicadores/reclutamiento';

export const ROJO = ['#F7C1C1', '#F09595', '#E24B4A', '#A32D2D', '#791F1F'];
export const AZUL = ['#B5D4F4', '#85B7EB', '#378ADD', '#185FA5', '#0C447C'];

export const colorVeces = (grupo: Grupo, veces: Veces): string => (grupo === 'noElegibles' ? ROJO : AZUL)[veces - 1];
