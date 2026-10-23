import { z } from 'zod';
import { TIPOS, type Condicion, type TipoPregunta } from '../../lib/formularios/tipos';

// Lo que devuelve la IA en cada llamada del generador de Filtros, validado con zod antes de usarlo.
// Los campos opcionales aceptan null (la IA a veces lo manda) y se quitan después con `sinVacios`.

const TIPO = z.enum(Object.keys(TIPOS) as [TipoPregunta, ...TipoPregunta[]]);
const texto = z.string().nullish();
const si = z.boolean().nullish();
const numero = z.number().nullish();
const ids = z.array(z.string());

export const CondicionZ: z.ZodType<Condicion> = z.lazy(() => z.union([
  z.object({ todas: z.array(CondicionZ).min(1) }),
  z.object({ alguna: z.array(CondicionZ).min(1) }),
  z.object({ no: CondicionZ }),
  z.object({ nse: ids }),
  z.object({ bloque: z.string(), opcion: z.string() }),
  z.object({ instanciaEs: ids }),
  z.object({ numero: z.string(), entre: z.tuple([z.number(), z.number()]), instancia: z.string().optional() }),
  z.object({ pregunta: z.string(), incluye: ids, instancia: z.string().optional() }),
  z.object({ pregunta: z.string(), noIncluye: ids, instancia: z.string().optional() }),
  z.object({ pregunta: z.string(), incluyeTodas: ids, instancia: z.string().optional() }),
])) as z.ZodType<Condicion>;

const OpcionZ = z.object({
  id: z.string().min(1), label: z.string(), corto: texto, imagen: texto,
  termina: texto, descarta: texto, excluyeGrupos: ids.nullish(), otra: si, exclusiva: si, fija: si,
});

export const PreguntaZ = z.object({
  id: z.string().min(1),
  tipo: TIPO,
  texto: z.string().default(''),
  ayuda: texto, imagen: texto, opcional: si,
  opciones: z.array(OpcionZ).nullish(),
  opcionesDe: texto,
  opcionesExtra: z.array(OpcionZ).nullish(),
  filas: z.array(z.object({ id: z.string().min(1), label: z.string() })).nullish(),
  reglasMatriz: z.array(z.object({ fila: z.string(), columnas: ids, termina: texto, excluyeGrupos: ids.nullish() })).nullish(),
  aleatorio: si,
  maxOpciones: numero, min: numero, max: numero, paso: numero,
  etiquetas: z.object({ min: texto, max: texto }).nullish(),
  terminaFuera: z.object({ min: z.number(), max: z.number(), motivo: z.string() }).nullish(),
  patron: texto, patronMensaje: texto,
  terminaSi: z.object({ si: CondicionZ, motivo: z.string() }).nullish(),
  mostrarSi: CondicionZ.nullish(),
  nota: texto,
});

export const SeccionZ = z.object({
  id: z.string().min(1),
  titulo: texto, intro: texto,
  mostrarSi: CondicionZ.nullish(),
  repetirPor: texto,
  repetirSolo: ids.nullish(),
  preguntas: z.array(PreguntaZ).min(1),
});

export const FrenteZ = z.object({
  id: z.string().min(1),
  nombre: z.string().min(1),
  grupo: z.string().default('general'),
  meta: z.coerce.number().int().min(1),
  califica: CondicionZ,
});

export const AlertaZ = z.object({
  texto: z.string().min(1),
  si: CondicionZ.nullish(),
  contar: z.object({ pregunta: z.string(), masDe: z.number() }).nullish(),
});

const supuestos = z.array(z.string()).default([]);

// ── etapa 1 ──
const PreguntaPlanZ = z.object({
  id: z.string().min(1),
  tipo: TIPO,
  texto: z.string(),
  opciones: z.array(z.object({ id: z.string().min(1), label: z.string(), corto: texto })).nullish(),
  filas: z.array(z.object({ id: z.string().min(1), label: z.string() })).nullish(),
  opcionesDe: texto, soloSi: texto, logica: texto,
});

export const EstructuraZ = z.object({
  pais: z.string().default('MX'),
  tituloPublico: z.string().default('Estudio de opinión'),
  perfil: z.string().default(''),
  frentes: z.array(z.object({
    id: z.string().min(1), nombre: z.string().min(1), grupo: z.string().default('general'),
    meta: z.coerce.number().int().min(1), quien: z.string().default(''),
  })).default([]),
  secciones: z.array(z.object({
    id: z.string().min(1),
    titulo: z.string().default(''),
    para: z.string().default(''),
    aparece: texto, repetirPor: texto, repetirSolo: ids.nullish(), nse: si, cambia: si,
    preguntas: z.array(PreguntaPlanZ).default([]),
  })).min(1),
  supuestos,
});

// ── etapa 2 y lógica final ──
export const RespuestaSeccionZ = z.object({ seccion: SeccionZ, supuestos });

export const RespuestaLogicaZ = z.object({
  frentes: z.array(FrenteZ).min(1),
  alertas: z.array(AlertaZ).default([]),
  claves: z.object({ nombre: texto, telefono: texto, edad: texto, genero: texto }).default({}),
  textos: z.object({ tituloPublico: texto, bienvenida: texto, despedida: texto, noCalifica: texto }).default({}),
  supuestos,
});

// ── cambios pedidos con palabras ──
export const RespuestaCambioPreguntaZ = z.object({ pregunta: PreguntaZ, explicacion: z.string().default('') });

export const RespuestaCambioSeccionZ = z.object({
  secciones: z.array(SeccionZ).default([]),
  orden: ids.nullish(),
  quitarSecciones: ids.nullish(),
  frentes: z.array(FrenteZ).nullish(),
  alertas: z.array(AlertaZ).nullish(),
  explicacion: z.string().default(''),
});

/** Quita los campos vacíos (null o undefined) que la IA manda de más: el contrato los omite. */
export function sinVacios<T>(x: T): T {
  return JSON.parse(JSON.stringify(x, (_k, v) => (v === null ? undefined : v)));
}
