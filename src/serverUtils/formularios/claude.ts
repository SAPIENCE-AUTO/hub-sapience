import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { ZiteError } from '../../../server/compat';

// Llamadas a Claude del generador de Filtros (fase 3), con el patrón de Propuestas y de la guía de
// tópicos: el system prompt es la skill (SKILL.md + references + ejemplos) más «MODO HUB», con caché;
// la respuesta se valida con zod y, si no cumple, se reintenta UNA vez pidiendo solo el JSON; va con
// streaming porque una sección larga no cabe en una llamada sin streaming del SDK.
//
// Un modelo por etapa: la estructura, las secciones y la lógica con el más capaz (son las que deciden y
// las que tienen que salir bien armadas); los cambios a una pregunta con uno rápido.
export const MODELOS = {
  estructura: process.env.FORMULARIOS_MODELO_ESTRUCTURA || 'claude-opus-5-5',
  preguntas: process.env.FORMULARIOS_MODELO_PREGUNTAS || 'claude-opus-5-5',
  cambios: process.env.FORMULARIOS_MODELO_CAMBIOS || 'claude-sonnet-5-5',
};

export type Esfuerzo = 'low' | 'medium' | 'high';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'Falta ANTHROPIC_API_KEY en el servidor' });
  client = new Anthropic({ apiKey });
  return client;
}

const SKILL_DIR = path.join(import.meta.dirname, 'skill');
const leer = (...p: string[]) => fs.readFileSync(path.join(SKILL_DIR, ...p), 'utf8');

const MODO_HUB = `MODO HUB
Estás integrado en Hub Sapience, en Filtros. No conversas: cada llamada te pide un solo entregable (una estructura, una sección, la lógica final o un cambio) y respondes únicamente con un objeto JSON válido con el formato que pide la llamada, sin texto antes ni después y sin bloques de código. Leer archivos, aprobar la estructura, mostrar los cambios antes de aplicarlos y armar el Word lo resuelve la interfaz. Todas las reglas de la skill siguen vigentes, en especial: no inventar (lo decidido va en supuestos, con de dónde salió), máximo 10 minutos, nunca mencionar al cliente, no escribir las preguntas del NSE, y conservar tal cual cada id que te den. En "supuestos" y en "explicacion" la persona no ve ids: nombra cada pregunta por su texto y cada opción por su etiqueta.`;

let systemCache: string | null = null;
export function systemPrompt(): string {
  if (!systemCache) {
    const ejemplos = ['hogar_word.md', 'hogar.json', 'bebidas_frias.md', 'refrescos_cr.md']
      .map((f) => `=== assets/ejemplos/${f} ===\n${leer('assets', 'ejemplos', f)}`);
    systemCache = [
      leer('SKILL.md'),
      ...['reglas.md', 'redaccion.md', 'contrato.md', 'estructura.md'].map((f) => `=== references/${f} ===\n${leer('references', f)}`),
      ...ejemplos,
      MODO_HUB,
    ].join('\n\n');
  }
  return systemCache;
}

export type Contenido = Anthropic.Beta.Messages.BetaContentBlockParam[];

export function extraerJSON(texto: string): unknown {
  const t = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('la respuesta no contiene JSON');
  return JSON.parse(t.slice(i, j + 1));
}

/**
 * Un error de la API de la IA, dicho en palabras: si la cuenta se quedó sin
 * saldo, la llave no sirve o la IA está saturada, se dice eso (no «Error
 * interno») y que el filtro no tiene nada mal.
 */
export function errorDeLaIA(err: unknown): unknown {
  if (err instanceof ZiteError) return err;
  const zite = (message: string) => new ZiteError({ code: 'INTERNAL_ERROR', message });
  if (err instanceof Anthropic.APIConnectionError) return zite('No se pudo conectar con la IA. Vuelve a intentar en un momento.');
  if (!(err instanceof Anthropic.APIError)) return err;
  // La API no da un código propio para el saldo: solo lo dice en el mensaje.
  if (/credit balance/i.test(err.message ?? '')) {
    return zite('La cuenta de la IA (Anthropic) se quedó sin saldo. Hay que cargar crédito en la consola de Anthropic, en Plans & Billing. El filtro no tiene nada mal: con saldo, dale «Reintentar».');
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return zite('La llave de la IA no es válida o no tiene permiso (ANTHROPIC_API_KEY). El filtro no tiene nada mal.');
  }
  if (err instanceof Anthropic.RateLimitError) return zite('La IA está recibiendo demasiadas peticiones. Espera un minuto y dale «Reintentar».');
  if (err.status === 529 || err instanceof Anthropic.InternalServerError) return zite('La IA está saturada en este momento. Espera un minuto y dale «Reintentar».');
  return zite(`La IA respondió con un error (${err.status ?? 'sin código'}). Vuelve a intentar.`);
}

/** Lo que gastó una llamada (para el registro de uso). */
export interface Gasto { modelo: string; entrada: number; cacheLeidos: number; cacheEscritos: number; salida: number }

/**
 * Llama a Claude y devuelve el JSON validado. `revisar` puede encontrar
 * problemas en lo que ya pasó el esquema (lógica mal armada, ids que no
 * son): cuenta como respuesta inválida y gasta el mismo reintento.
 */
export async function llamarJSON<S extends z.ZodTypeAny>(opts: {
  usuario: Contenido;
  esquema: S;
  modelo: string;
  esfuerzo: Esfuerzo;
  maxTokens?: number;
  revisar?: (r: z.infer<S>) => string[];
  /** Si tras el reintento sigue algo mal armado, devolverlo igual (quien llama muestra los problemas). */
  aceptarConProblemas?: boolean;
  onGasto?: (g: Gasto) => void;
}): Promise<z.infer<S>> {
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: 'user', content: opts.usuario }];
  let ultimoError = '';
  let conProblemas: { data: z.infer<S> } | null = null;
  for (let intento = 0; intento < 2; intento++) {
    let msg: Anthropic.Beta.Messages.BetaMessage;
    try {
      msg = await getClient().beta.messages.stream({
        model: opts.modelo,
        max_tokens: opts.maxTokens ?? 64000,
        system,
        messages,
        output_config: { effort: opts.esfuerzo },
        // Si la IA se niega por un falso positivo de sus filtros, la API reintenta sola con otro modelo.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }).finalMessage();
    } catch (err) {
      throw errorDeLaIA(err);
    }
    const u = msg.usage;
    const gasto: Gasto = {
      modelo: msg.model, entrada: u.input_tokens, cacheLeidos: u.cache_read_input_tokens ?? 0, cacheEscritos: u.cache_creation_input_tokens ?? 0, salida: u.output_tokens,
    };
    opts.onGasto?.(gasto);
    console.log(`[filtros] ${gasto.modelo} · ${gasto.entrada} in (+${gasto.cacheLeidos} de caché, ${gasto.cacheEscritos} a caché) · ${gasto.salida} out · ${msg.stop_reason}`);
    if (msg.stop_reason === 'refusal') {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La IA no quiso responder a esto. Reformula el pedido o inténtalo otra vez.' });
    }
    // Cortada por largo = JSON incompleto: error claro en vez de medio filtro.
    if (msg.stop_reason === 'max_tokens') {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La respuesta de la IA se cortó por largo. Vuelve a intentar; si sigue, pide algo más corto.' });
    }
    const texto = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
    try {
      const parsed = opts.esquema.safeParse(extraerJSON(texto));
      if (parsed.success) {
        const problemas = opts.revisar?.(parsed.data) ?? [];
        if (!problemas.length) return parsed.data;
        conProblemas = { data: parsed.data };
        ultimoError = `el Hub encontró esto mal armado: ${problemas.slice(0, 12).join(' ')}`;
      } else {
        ultimoError = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      }
    } catch (e) {
      ultimoError = (e as Error).message;
    }
    // Se devuelve la respuesta tal cual (con su razonamiento): la API no deja editar lo que el modelo pensó.
    messages.push({ role: 'assistant', content: msg.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    messages.push({ role: 'user', content: `Tu respuesta anterior no es válida (${ultimoError}). Corrígelo y responde solo con el JSON completo, sin texto ni bloques de código.` });
  }
  if (opts.aceptarConProblemas && conProblemas) return conProblemas.data;
  throw new ZiteError({ code: 'INTERNAL_ERROR', message: `La IA no devolvió algo bien armado tras reintentar: ${ultimoError.slice(0, 400)}` });
}

/** Mantiene viva la conexión (y muestra avance) mientras la IA trabaja: una sección tarda de 20 s a 1 min. */
export function conLatido<T>(stream: { write: (c: unknown) => void } | undefined, mensaje: string, trabajo: () => Promise<T>): Promise<T> {
  stream?.write({ paso: mensaje });
  const t = setInterval(() => stream?.write({ paso: mensaje, latido: true }), 15_000);
  return trabajo().finally(() => clearInterval(t));
}
