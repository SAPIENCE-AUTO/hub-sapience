import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { ZiteError } from '../../../server/compat';

// Llamadas a Claude para las guías, con el mismo patrón que propuestas/claude.ts: el system prompt
// es la skill (SKILL.md + redacción + estructura) más «MODO HUB», con caché; la respuesta se valida
// con zod y, si no cumple, se reintenta UNA vez pidiendo solo el JSON; va con streaming porque un
// bloque largo no cabe en una llamada sin streaming del SDK.
//
// Como en el generador original (nivel «complex» para escribir): el roadmap con un modelo rápido y
// la redacción de la guía con el más capaz. Es lo que hace la guía exhaustiva.
export const MODELO_ROADMAP = process.env.GUIAS_MODELO_ROADMAP || 'claude-sonnet-5-5';
export const MODELO_BLOQUE = process.env.GUIAS_MODELO_BLOQUE || 'claude-opus-5-5';

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
Estás integrado en Hub Sapience. No conversas: cada llamada te pide un solo entregable (un roadmap o un bloque) y respondes únicamente con un objeto JSON válido con el formato de references/estructura.md, sin texto antes ni después y sin bloques de código. Los pasos de reunir datos, aprobar el roadmap y construir el Word los resuelve la interfaz. Todas las reglas de la skill siguen vigentes, en especial el volumen por tiempo (una pregunta principal cada 2 minutos de bloque; unas 2,000 palabras para 120 minutos), no sesgar la conversación y no inventar información.`;

let systemCache: string | null = null;
export function systemPrompt(): string {
  if (!systemCache) systemCache = [leer('SKILL.md'), leer('references', 'redaccion.md'), leer('references', 'estructura.md'), MODO_HUB].join('\n\n');
  return systemCache;
}

function extraerJSON(texto: string): unknown {
  const t = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('la respuesta no contiene JSON');
  return JSON.parse(t.slice(i, j + 1));
}

export async function llamarJSON<S extends z.ZodTypeAny>(opts: {
  usuario: string; esquema: S; modelo: string; maxTokens: number;
}): Promise<z.infer<S>> {
  const system: Anthropic.Messages.TextBlockParam[] = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: opts.usuario }];
  let ultimoError = '';
  for (let intento = 0; intento < 2; intento++) {
    const msg = await getClient().messages.stream({ model: opts.modelo, max_tokens: opts.maxTokens, system, messages }).finalMessage();
    const u = msg.usage as any;
    console.log(`[guias] ${opts.modelo} · ${u.input_tokens} in (+${u.cache_read_input_tokens ?? 0} de caché) · ${u.output_tokens} out · ${msg.stop_reason}`);
    // Cortada por largo = JSON incompleto: error claro en vez de media guía.
    if (msg.stop_reason === 'max_tokens') {
      throw new ZiteError({ code: 'INTERNAL_ERROR', message: 'La respuesta de Claude se cortó por largo. Vuelve a intentar.' });
    }
    const texto = msg.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map((b) => b.text).join('');
    try {
      const parsed = opts.esquema.safeParse(extraerJSON(texto));
      if (parsed.success) return parsed.data;
      ultimoError = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      ultimoError = (e as Error).message;
    }
    messages.push({ role: 'assistant', content: texto || '(vacío)' });
    messages.push({ role: 'user', content: `Tu respuesta anterior no es válida (${ultimoError}). Responde solo con el JSON, sin texto ni bloques de código.` });
  }
  throw new ZiteError({ code: 'INTERNAL_ERROR', message: `Claude no devolvió un JSON válido tras reintentar: ${ultimoError}` });
}

/** Mantiene viva la conexión (y muestra avance) mientras Claude trabaja: un bloque tarda de 20 s a 1 min. */
export function conLatido<T>(stream: { write: (c: any) => void } | undefined, mensaje: string, trabajo: () => Promise<T>): Promise<T> {
  stream?.write({ paso: mensaje });
  const t = setInterval(() => stream?.write({ paso: mensaje, latido: true }), 15_000);
  return trabajo().finally(() => clearInterval(t));
}
