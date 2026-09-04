import { z } from 'zod';
import { createEndpoint, Deals, ZiteError } from '../../server/compat';
import OpenAI from 'openai';

// Historial completo de Deals — 421 filas en producción al momento de escribir
// esto, lo bastante chico para mandarlo completo como contexto en cada
// pregunta. Si el volumen crece a miles, esto habría que revisitarlo con
// function-calling/paginación en vez de un fetch total.
async function fetchAllDeals(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (true) {
    const { records, hasMore } = await Deals.findAll({
      limit: 2000,
      offset,
      fields: [
        'dealName', 'phase', 'client', 'projectType', 'tematica', 'proposalDate',
        'approvalDate', 'clientPrice', 'quotedCost', 'currency', 'statusPropuesta',
        'fechaPerdida', 'gerente', 'createdAt',
      ],
    });
    all.push(...records);
    if (!hasMore) break;
    offset += records.length;
  }
  return all;
}

function toCsv(deals: any[]): string {
  const cols = [
    'dealName', 'client', 'phase', 'statusPropuesta', 'projectType', 'tematica',
    'gerente', 'currency', 'clientPrice', 'quotedCost', 'proposalDate',
    'approvalDate', 'fechaPerdida', 'createdAt',
  ];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const d of deals) lines.push(cols.map(c => escape(d[c])).join(','));
  return lines.join('\n');
}

const SYSTEM_PROMPT = `Eres un analista comercial senior de Sapience, una agencia de investigación de mercados en México. Tienes acceso al historial COMPLETO de deals (ventas/propuestas comerciales) de la agencia, en formato CSV, y debes responder preguntas del dueño de la agencia sobre tendencias, comparativas y desempeño de ventas.

DATOS: cada fila es un deal. "clientPrice"/"quotedCost" están en la moneda de "currency" (normalmente MXN). "phase"/"statusPropuesta" indican si el deal está ganado, perdido o en curso — infiere el significado de los valores reales que veas en los datos, no asumas nombres fijos. Las fechas relevantes para "cuándo pasó" son "approvalDate" (cuando se ganó) y "fechaPerdida" (cuando se perdió); usa "proposalDate"/"createdAt" como respaldo si esas vienen vacías.

FORMATO DE RESPUESTA: responde ÚNICAMENTE con un JSON válido, sin markdown alrededor, con esta forma exacta:
{
  "text": "tu respuesta en markdown — siempre presente, es la narrativa/explicación",
  "table": { "headers": ["..."], "rows": [["...", "..."]] } | null,
  "html": "<!doctype html>...documento HTML completo autocontenido..." | null
}

Reglas:
- "text" siempre lleva contenido — nunca lo dejes vacío, aunque también incluyas table/html.
- "table" solo si el usuario pidió (o claramente se beneficia de) un desglose tabular.
- "html" solo si el usuario pidió una gráfica/visualización, o la pregunta se presta obviamente a una. Si no aplica, usa null — no fuerces una gráfica en cada respuesta.
- Cuando generes "html": debe ser un documento HTML COMPLETO y autocontenido (con <!doctype html>), que cargue Chart.js desde este CDN exacto: <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script> — no uses otra librería, otra versión ni otro CDN (esta versión y ruta están verificadas contra cdnjs; cualquier otra puede no existir y dar 404, dejando la gráfica en blanco sin ningún error visible). El gráfico SIEMPRE debe dibujarse en un elemento <canvas> (Chart.js lo hace por defecto) — esto es un requisito técnico del sistema que lo va a mostrar, no solo una preferencia visual. Usa colores planos y legibles, fondo blanco, tamaño responsivo (canvas dentro de un contenedor con width:100%).
- Sé específico con números reales calculados de los datos — nunca inventes cifras.`;

export default createEndpoint({
  authenticated: true,
  description: 'Chat de análisis de ventas (Deals) con IA — historial completo, solo para el rol Owner',
  inputSchema: z.object({
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).min(1),
  }),
  outputSchema: z.object({
    text: z.string(),
    table: z.object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    }).nullable(),
    html: z.string().nullable(),
  }),
  execute: async ({ input, context }) => {
    // Gate real (no solo de UI): este módulo expone el historial completo de
    // ventas de la agencia a un LLM externo — se restringe al rol Owner, no a
    // un correo hardcodeado, para que sobreviva si algún día hay más de un
    // Owner. La ocultación de la página/nav es solo UX; esto es lo que de
    // verdad protege el endpoint si alguien lo llama directo.
    if (context.user?.role !== 'Owner') {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'No tienes acceso a este módulo' });
    }

    const deals = await fetchAllDeals();
    const csv = toCsv(deals);

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nHISTORIAL COMPLETO DE DEALS (CSV, ${deals.length} filas):\n${csv}` },
        ...input.messages,
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 16384,
    });

    let parsed: { text?: string; table?: { headers: string[]; rows: string[][] } | null; html?: string | null };
    try {
      parsed = JSON.parse(completion.choices[0].message.content ?? '{}');
    } catch {
      parsed = { text: 'No se pudo generar el análisis. Intenta reformular la pregunta.', table: null, html: null };
    }

    return {
      text: parsed.text ?? 'No se pudo generar el análisis. Intenta reformular la pregunta.',
      table: parsed.table ?? null,
      html: parsed.html ?? null,
    };
  },
});
