import { z } from 'zod';
import { TIPOS_SESION } from './types';

// Esquemas zod: lo que entra a los endpoints (con topes) y lo que debe devolver Claude.

const txt = (max: number) => z.string().max(max);

export const BloqueRoadmapZ = z.object({
  nombre: z.string().trim().max(200),
  minutos: z.coerce.number().int().min(0).max(600).catch(0),
  objetivos: z.array(z.string()).max(15).default([]),
});
export const PreguntaZ = z.union([z.string(), z.object({ texto: z.string(), sub: z.array(z.string()).default([]) })]);
export const SeccionZ = z.object({
  subtema: z.string().default(''),
  intro: z.string().optional(),
  preguntas: z.array(PreguntaZ).default([]),
  notas: z.array(z.string()).default([]),
});
export const BloqueGuiaZ = z.object({ moderador: z.string().default(''), secciones: z.array(SeccionZ).min(1) });

/** Lo que devuelve Claude al leer, proponer o ajustar el roadmap. */
export const RoadmapIAZ = z.object({
  proyecto: z.string().optional(),
  tipo: z.string().optional(),
  duracion: z.coerce.number().int().optional().catch(undefined),
  muestra: z.array(z.string()).default([]),
  bloques: z.array(BloqueRoadmapZ).min(1),
  supuestos: z.array(z.string()).default([]),
});

/** El estado que manda el front (validado con topes antes de guardar o de pedirle algo a Claude). */
export const EstadoGuiaZ = z.object({
  modo: z.enum(['roadmap', 'brief', 'tema']),
  paso: z.enum(['proyecto', 'roadmap', 'guia']),
  proyecto: txt(300),
  tipo: z.enum(TIPOS_SESION as [string, ...string[]]),
  duracion: z.number().int().min(15).max(480),
  muestraText: txt(4000),
  estimulos: txt(4000),
  notas: txt(4000),
  tema: txt(4000),
  briefText: txt(60000),
  roadmap: z.object({
    muestra: z.array(txt(500)).max(20),
    bloques: z.array(z.object({ nombre: txt(200), minutos: z.number().int().min(0).max(600), objetivos: z.array(txt(500)).max(15) })).max(20),
  }).nullable(),
  supuestos: z.array(txt(1000)).max(20),
  guia: z.array(z.object({
    moderador: txt(3000),
    secciones: z.array(z.object({
      subtema: txt(300),
      intro: txt(2000).optional(),
      preguntas: z.array(z.union([txt(2000), z.object({ texto: txt(2000), sub: z.array(txt(500)).max(30) })])).max(80),
      notas: z.array(txt(2000)).max(20),
    })).max(20),
  }).nullable()).max(20),
});
