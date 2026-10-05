import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const PORTADAS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'skill/assets/portadas.json'), 'utf8')) as Record<string, { nombre: string; huecos: unknown[] }>;
export const PORTADA_IDS = Object.keys(PORTADAS);
export const huecosDePortada = (id: string) => PORTADAS[id]?.huecos.length ?? 0;

const HEX = z.string().regex(/^#?[0-9a-fA-F]{6}$/).transform(s => s.replace('#', '').toUpperCase());
export const TIPOS_LAMINA = ['contexto', 'punto_partida', 'objetivos', 'enfoque', 'detalle_fase', 'muestra', 'entregables', 'tiempos', 'inversion', 'seccion', 'cierre'] as const;

export const Paleta = z.object({ acento: HEX, secundario: HEX, fases: z.array(HEX).min(1).max(8) });
export const PaletasPropuestas = z.array(Paleta.extend({ nombre: z.string(), tono: z.string() })).min(1).max(3);

export const Esqueleto = z.object({
  resumen_brief: z.string(),
  preguntas: z.array(z.string()).default([]),
  // Diagnóstico (lo llena el endpoint, no Claude): cada pregunta que Claude ha devuelto y si se respondió.
  preguntas_estado: z.array(z.object({ pregunta: z.string(), respondida: z.boolean(), respuesta: z.string().optional() })).default([]),
  metodo: z.enum(['cualitativo', 'cuantitativo', 'mixto']),
  fases: z.array(z.object({
    nombre: z.string(), etapa: z.string().nullable().optional(), icono: z.string().default('FiCircle'),
    goal: z.string().default(''), tecnica: z.string().default(''), muestra: z.string().default(''),
    participantes: z.enum(['nuevos', 'mismos']).default('nuevos'), razon_participantes: z.string().default(''),
  })).min(1),
  indice: z.array(z.object({
    tipo: z.enum(TIPOS_LAMINA), titulo: z.string().default(''), resumen: z.string().default(''),
    incluir: z.boolean().default(true), razon: z.string().default(''),
  })).min(1),
  precio: z.object({
    modo: z.enum(['unico', 'por_fase']),
    partidas: z.array(z.object({ fase: z.number().int(), descripcion: z.string().default(''), precio: z.string() })).default([]),
    total: z.string(), letra: z.string().default(''),
  }),
  tiempos: z.object({
    fecha_inicio: z.string().nullable().default(null),
    actividades: z.array(z.object({
      nombre: z.string(), fase: z.number().int().nullable().default(null),
      inicio_semana: z.number().min(0), duracion_semanas: z.number().positive(),
    })).default([]),
  }),
  diseno: z.object({
    estilo: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']),
    portada: z.string().refine(id => PORTADA_IDS.includes(id), { message: `portada debe ser una de: ${PORTADA_IDS.join(', ')}` }),
    razon: z.string().default(''), ilustraciones: z.boolean().default(false),
    paleta: Paleta.optional().nullable(),
  }),
});
export type EsqueletoT = z.infer<typeof Esqueleto>;

// El contenido lo valida de fondo el revisor y el constructor; aquí solo la
// forma mínima para no dejar pasar algo que ni siquiera tenga láminas.
export const Contenido = z.object({
  proyecto: z.string(), cliente: z.string(), fecha: z.string(), tipo: z.string().default('Propuesta de trabajo'),
  estilo: z.string(), laminas: z.array(z.object({ tipo: z.string() }).passthrough()).min(1),
}).passthrough();
