import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

// Spec §2: "el más nuevo" (Sergio); configurable por ANTHROPIC_MODEL.
export const MODELO = process.env.ANTHROPIC_MODEL || 'claude-fable-5-1';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  client = new Anthropic({ apiKey });
  return client;
}

const SKILL_DIR = path.join(import.meta.dirname, 'skill');
const leer = (...p: string[]) => fs.readFileSync(path.join(SKILL_DIR, ...p), 'utf8');

// Spec §8: SKILL.md + estructura + redacción + diseño, y al final MODO HUB.
const MODO_HUB = `MODO HUB
Estás integrado en Hub Sapience. No conversas: cada llamada te pide un solo entregable y respondes únicamente con un objeto JSON válido que cumpla el esquema indicado, sin texto antes ni después y sin bloques de código. Los pasos 2 y 3 del flujo de trabajo (preguntar y proponer el esqueleto) los resuelve la interfaz: tus preguntas van en el campo "preguntas" del esqueleto y la persona aprueba el esqueleto en pantalla antes de pedirte el contenido. Todas las reglas de la skill siguen vigentes, en especial: no inventar información (cada punto del contexto lleva su fuente), objetivos con verbo en infinitivo, cajas de una misma fila con el mismo número de puntos y largo parecido, y voz de Sapience.`;

let systemCache: string | null = null;
export function systemPrompt(): string {
  if (!systemCache) {
    systemCache = [leer('SKILL.md'), leer('references', 'estructura.md'), leer('references', 'redaccion.md'), leer('references', 'diseno.md'), MODO_HUB].join('\n\n');
  }
  return systemCache;
}

export type Contenido = string | Anthropic.Messages.ContentBlockParam[];

function extraerJSON(texto: string): unknown {
  let t = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const i = Math.min(...['{', '['].map(c => t.indexOf(c)).filter(n => n >= 0));
  const j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (!isFinite(i) || j < i) throw new Error('la respuesta no contiene JSON');
  return JSON.parse(t.slice(i, j + 1));
}

// Spec §8 "Validación de JSON": se valida con zod y, si no es JSON válido o no
// cumple el esquema, se reintenta UNA vez pidiendo «solo el JSON».
// Va con streaming: una respuesta larga (el contenido completo) no cabe en una
// llamada sin streaming del SDK.
export async function llamarJSON<S extends z.ZodTypeAny>(opts: {
  usuario: Contenido; esquema: S; maxTokens: number;
}): Promise<z.infer<S>> {
  const system: Anthropic.Messages.TextBlockParam[] = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: opts.usuario }];
  let ultimoError = '';
  for (let intento = 0; intento < 2; intento++) {
    const stream = getClient().messages.stream({ model: MODELO, max_tokens: opts.maxTokens, system, messages });
    const msg = await stream.finalMessage();
    const texto = msg.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join('');
    try {
      const parsed = opts.esquema.safeParse(extraerJSON(texto));
      if (parsed.success) return parsed.data;
      ultimoError = parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    } catch (e) {
      ultimoError = (e as Error).message;
    }
    messages.push({ role: 'assistant', content: texto || '(vacío)' });
    messages.push({ role: 'user', content: `Tu respuesta anterior no es válida (${ultimoError}). Responde solo con el JSON, sin texto ni bloques de código.` });
  }
  throw new Error(`Claude no devolvió un JSON válido tras reintentar: ${ultimoError}`);
}
