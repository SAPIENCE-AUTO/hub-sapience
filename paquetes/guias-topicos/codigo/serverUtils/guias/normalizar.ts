// Limpia lo que devuelve Claude (después de validarlo con zod): sin vacíos y con largos acotados.
import type { BloqueGuia, Roadmap } from './types';

const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const lista = (v: unknown[] | undefined, max: number, len: number) => (v ?? []).map((x) => t(x, len)).filter(Boolean).slice(0, max);

export function limpiarRoadmap(o: { muestra?: string[]; bloques: { nombre: string; minutos: number; objetivos?: string[] }[]; supuestos?: string[]; proyecto?: string; duracion?: number }) {
  const roadmap: Roadmap = {
    muestra: lista(o.muestra, 20, 500).map((m) => m.replace(/\*\*/g, '')),
    bloques: o.bloques.map((b) => ({ nombre: t(b.nombre, 200), minutos: Math.min(Math.max(b.minutos || 0, 0), 600), objetivos: lista(b.objetivos, 15, 500) }))
      .filter((b) => b.nombre).slice(0, 20),
  };
  return { roadmap, supuestos: lista(o.supuestos, 20, 1000), proyecto: o.proyecto ? t(o.proyecto, 300) : undefined, duracion: o.duracion || undefined };
}

export function limpiarBloque(o: BloqueGuia): BloqueGuia {
  return {
    moderador: t(o.moderador, 3000),
    secciones: o.secciones.slice(0, 20).map((s) => ({
      subtema: t(s.subtema, 300),
      intro: s.intro ? t(s.intro, 2000) : undefined,
      preguntas: s.preguntas.slice(0, 80).map((q) => (typeof q === 'string' ? t(q, 2000) : { texto: t(q.texto, 2000), sub: lista(q.sub, 30, 500) }))
        .filter((q) => (typeof q === 'string' ? q : q.texto)),
      notas: lista(s.notas, 20, 2000),
    })),
  };
}
