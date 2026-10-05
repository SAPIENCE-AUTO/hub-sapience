// Spec §9: convierte esqueleto.tiempos.actividades en la lámina `tiempos` que
// entiende el constructor ({ semanas, barras[{fase, inicio, fin, etiqueta}] }).
// Es determinista a propósito: las duraciones las propone Claude en el esqueleto
// y la persona las ajusta en pantalla — aquí NO se fija ninguna regla de
// duración (la tabla de tiempos está PENDIENTE DE CONFIRMAR CON SERGIO).
export interface Actividad { nombre: string; fase: number | null; inicio_semana: number; duracion_semanas: number }
export interface TiemposEsqueleto { fecha_inicio: string | null; actividades: Actividad[] }

// Análisis de una fase: no baja de 1 semana sin que la persona lo cambie a mano.
// PENDIENTE DE CONFIRMAR CON SERGIO: la precarga de 1.5 semanas.
export const ANALISIS_MINIMO_SEMANAS = 1;
export const ANALISIS_PRECARGA_SEMANAS = 1.5;
export function precargarAnalisis(t: TiemposEsqueleto): TiemposEsqueleto {
  return { ...t, actividades: (t.actividades ?? []).map(a =>
    /^an[aá]lisis/i.test(a.nombre.trim()) && a.duracion_semanas < ANALISIS_MINIMO_SEMANAS ? { ...a, duracion_semanas: ANALISIS_PRECARGA_SEMANAS } : a) };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function rangoSemana(inicio: Date, n: number): string {
  const a = new Date(inicio); a.setUTCDate(a.getUTCDate() + n * 7);
  const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
  const dm = (d: Date) => `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()} – ${dm(b)}` : `${dm(a)} – ${dm(b)}`;
}

export function tiemposALamina(t: TiemposEsqueleto, titulo?: string): any {
  const acts = t.actividades ?? [];
  const nSemanas = Math.max(1, Math.ceil(Math.max(0, ...acts.map(a => a.inicio_semana + a.duracion_semanas))));
  const base = t.fecha_inicio ? new Date(`${t.fecha_inicio}T00:00:00Z`) : null;
  const semanas = Array.from({ length: nSemanas }, (_, i) => (base && !isNaN(base.getTime()) ? rangoSemana(base, i) : `Semana ${i + 1}`));
  const barras = acts.map(a => {
    const b: any = { fase: a.fase ?? null, inicio: a.inicio_semana, fin: a.inicio_semana + a.duracion_semanas };
    if (a.fase === null || a.fase === undefined || a.nombre) b.etiqueta = a.nombre;
    return b;
  });
  return { tipo: 'tiempos', ...(titulo ? { titulo } : {}), semanas, barras };
}
