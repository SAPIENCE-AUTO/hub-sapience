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
Estás integrado en Hub Sapience. No conversas: cada llamada te pide un solo entregable y respondes únicamente con un objeto JSON válido que cumpla el esquema indicado, sin texto antes ni después y sin bloques de código. Los pasos 2 y 3 del flujo de trabajo (preguntar y proponer el esqueleto) los resuelve la interfaz: tus preguntas van en el campo "preguntas" del esqueleto y la persona aprueba el esqueleto en pantalla antes de pedirte el contenido. Todas las reglas de la skill siguen vigentes, en especial: no inventar información (cada punto del contexto lleva su fuente), objetivos con verbo en infinitivo, cajas de una misma fila con el mismo número de puntos y largo parecido, y voz de Sapience.

CÓMO SE ESCRIBE PARA LA LÁMINA (la propuesta la lee el cliente y se imprime en láminas de tamaño fijo; el texto que no cabe se desborda):
- Escribe corto. Cada punto es una oración, no un párrafo. Objetivo general: una sola oración de máximo ~180 caracteres. Goal de cada fase: máximo ~160 caracteres. «¿Cómo lo haremos?»: máximo 2 entradas, título de una línea y texto de máximo ~180 caracteres. Output de cada fase: máximo 3 viñetas cortas. Puntos de contexto: máximo ~100 caracteres cada uno. Celdas de la muestra: cifra y unidad, nada de frases.
- Títulos: el título de cada lámina cabe en UNA línea (máximo ~25 caracteres, p. ej. «Lo que necesitamos»; no le pongas el nombre del cliente). El nombre del estudio («proyecto», sale en la portada) va en máximo 40 caracteres: marca y tema, sin subtítulo.
- Cajas de color de una misma fila (títulos de columnas de contexto, de secciones): todas ocupan el mismo número de renglones; lo más limpio es una sola línea (máximo ~22 caracteres cada una).
- Objetivos específicos: el título de cada tarjeta ocupa máximo 2 líneas (~55 caracteres); el detalle va en las viñetas, que son más chicas.
- Fechas: no inventes ningún día exacto. Si el brief da solo un mes o «mediados de», escríbelo así («mediados de noviembre»); no lo conviertas a «16 de noviembre» ni comentes la temporada (fiestas, vacaciones) a menos que el brief lo mencione.
- Muestra: las notas son obligatorias (criterios comunes y definición de cada perfil). Para que quepan debajo, la tabla lleva máximo 4 filas (3 si usa «grupos») y el acomodo en celdas máximo 2. Si alguna fase después de la primera tiene participantes nuevos, la muestra se agrupa por fase con «grupos» y las columnas son solo cortes (ciudad, edad).
- Nunca digas «el brief», «del brief» ni «según el brief»: el cliente lee esto. Afirma directo (nombra las ciudades, el público, la categoría) o di «lo que nos compartieron». Lo que sí se respeta es el vocabulario del cliente.
- Los corchetes angulares son solo para una aclaración operativa con sentido completo («<6 participantes por sesión>»), nunca para un número suelto como «<12>».
- Los precios se copian tal como vienen en el esqueleto. Si un precio viene como pendiente, escribe "pendiente" y no pongas cantidad en letra. Nunca inventes un precio.
- Las notas de la persona son instrucciones e información para ti; nunca las copies tal cual en ninguna lámina.
- Redacta como persona, en español de México, sin frases armadas de trozos. Si una oración necesita releerse para entenderse, reescríbela.`;

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
