import { PAISES } from './paises';
import type { Pregunta, ReglaNse, Respuestas } from './tipos';

/**
 * Reglas de NSE por país, como data. Cada regla trae sus preguntas estándar
 * (con ids fijos: son claves de columna en el tablero) y sus puntos. Un
 * screener las copia al crearse (`reglaNse` y `preguntasNse`), así que
 * corregir una regla aquí no cambia los filtros ya creados.
 *
 * El NSE es indicador y alerta, nunca descarte: si no coincide con el que pide
 * un frente, la persona entra al frente con una alerta (motor.ts → evaluar).
 */

export interface ReglaNsePais {
  pais: string;
  nombre: string;
  /** Los puntos todavía hay que confirmarlos contra la versión vigente. */
  porConfirmar: boolean;
  nota: string;
  preguntas: Pregunta[];
  puntos: ReglaNse['puntos'];
  cortes: ReglaNse['cortes'];
}

const hasta4 = ['0', '1', '2', '3', '4'].map((n) => ({ id: n, label: n === '4' ? '4 o más' : n }));

export const REGLAS_NSE: Record<string, ReglaNsePais> = {
  // «Cuestionario para la aplicación de la regla AMAI 2022 y tabla de clasificación» (PDF oficial que pasó
  // Sergio el 2026-10-22). Mismos puntos que la de 2018; cambian los cortes (la de 2018 era A/B 205, C+ 166,
  // C 136, C- 112, D+ 90). Los filtros creados con la de 2018, como el ensayo de ALONG 2, conservan la suya.
  'MX-AMAI-2022': {
    pais: 'MX',
    nombre: 'AMAI 2022',
    porConfirmar: false,
    nota: 'Regla AMAI NSE 2022, la vigente: preguntas, puntos y tabla de clasificación del cuestionario oficial.',
    preguntas: [
      {
        id: 'nse_escolaridad', tipo: 'unica', texto: 'Pensando en el jefe o la jefa de tu hogar, ¿cuál fue el último año de estudios que aprobó en la escuela?',
        opciones: [
          { id: 'ninguno', label: 'No estudió' }, { id: 'prim_inc', label: 'Primaria incompleta' }, { id: 'prim', label: 'Primaria completa' },
          { id: 'sec_inc', label: 'Secundaria incompleta' }, { id: 'sec', label: 'Secundaria completa' },
          { id: 'comercial', label: 'Carrera comercial' }, { id: 'tecnica', label: 'Carrera técnica' },
          { id: 'prepa_inc', label: 'Preparatoria incompleta' }, { id: 'prepa', label: 'Preparatoria completa' },
          { id: 'lic_inc', label: 'Licenciatura incompleta' }, { id: 'lic', label: 'Licenciatura completa' },
          { id: 'posgrado', label: 'Diplomado o maestría' }, { id: 'doctorado', label: 'Doctorado' },
        ],
      },
      { id: 'nse_banos', tipo: 'unica', texto: '¿Cuántos baños completos, con regadera y excusado, hay en tu casa?', opciones: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2 o más' }] },
      { id: 'nse_autos', tipo: 'unica', texto: '¿Cuántos autos o camionetas tienen en tu casa, contando camionetas cerradas, con cabina o con caja?', opciones: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2 o más' }] },
      { id: 'nse_internet', tipo: 'unica', texto: 'Sin contar los datos del celular, ¿tu casa tiene internet?', opciones: [{ id: 'no', label: 'No' }, { id: 'si', label: 'Sí' }] },
      { id: 'nse_trabajan', tipo: 'unica', texto: 'De las personas de 14 años o más que viven en tu casa, ¿cuántas trabajaron en el último mes?', opciones: hasta4 },
      { id: 'nse_cuartos', tipo: 'unica', texto: '¿Cuántos cuartos se usan para dormir en tu casa, sin contar pasillos ni baños?', opciones: hasta4 },
    ],
    puntos: {
      nse_escolaridad: { ninguno: 0, prim_inc: 6, prim: 11, sec_inc: 12, sec: 18, comercial: 23, tecnica: 23, prepa_inc: 23, prepa: 27, lic_inc: 36, lic: 59, posgrado: 85, doctorado: 85 },
      nse_banos: { 0: 0, 1: 24, 2: 47 },
      nse_autos: { 0: 0, 1: 22, 2: 43 },
      nse_internet: { no: 0, si: 32 },
      nse_trabajan: { 0: 0, 1: 15, 2: 31, 3: 46, 4: 61 },
      nse_cuartos: { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32 },
    },
    cortes: [
      { nivel: 'A/B', desde: 202 }, { nivel: 'C+', desde: 168 }, { nivel: 'C', desde: 141 }, { nivel: 'C-', desde: 116 },
      { nivel: 'D+', desde: 95 }, { nivel: 'D', desde: 48 }, { nivel: 'E', desde: 0 },
    ],
  },
};

const reglaDelPais = (pais: string) => {
  const id = PAISES[pais]?.reglaNse;
  return id ? REGLAS_NSE[id] : undefined;
};

/** Copia de la regla del país para guardar en el screener. `undefined` si el país aún no tiene regla en el Hub. */
export function reglaNse(pais: string): ReglaNse | undefined {
  const r = reglaDelPais(pais);
  return r && structuredClone({ regla: r.nombre, porConfirmar: r.porConfirmar || undefined, puntos: r.puntos, cortes: r.cortes });
}

/** Nombre de la regla vigente del país («AMAI 2022»), para avisar si un filtro trae una anterior. */
export const reglaVigente = (pais: string) => reglaDelPais(pais)?.nombre;

/** Preguntas estándar del NSE del país, listas para una sección del screener. */
export function preguntasNse(pais: string): Pregunta[] {
  return structuredClone(reglaDelPais(pais)?.preguntas ?? []);
}

/** Puntos y nivel. `undefined` mientras falte alguna pregunta del NSE. */
export function calcularNse(regla: ReglaNse, resp: Respuestas): { puntos: number; nivel: string } | undefined {
  const ids = Object.keys(regla.puntos);
  if (!ids.every((id) => typeof resp[id] === 'string')) return undefined;
  const puntos = ids.reduce((suma, id) => suma + (regla.puntos[id][resp[id] as string] ?? 0), 0);
  return { puntos, nivel: regla.cortes.find((c) => puntos >= c.desde)?.nivel ?? '?' };
}
