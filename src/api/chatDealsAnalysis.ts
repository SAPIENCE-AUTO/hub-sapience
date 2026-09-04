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
        'approvalDate', 'clientPrice', 'quotedCost', 'currency', 'exchangeRate', 'statusPropuesta',
        'fechaPerdida', 'gerente', 'createdAt',
      ],
    });
    all.push(...records);
    if (!hasMore) break;
    offset += records.length;
  }
  return all;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(deals: any[]): string {
  const cols = [
    'dealName', 'client', 'phase', 'statusPropuesta', 'projectType', 'tematica',
    'gerente', 'currency', 'clientPrice', 'quotedCost', 'exchangeRate', 'proposalDate',
    'approvalDate', 'fechaPerdida', 'createdAt',
  ];
  const lines = [cols.join(',')];
  for (const d of deals) lines.push(cols.map(c => csvEscape(d[c])).join(','));
  return lines.join('\n');
}

function yearOf(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string' || dateStr.length < 4) return null;
  const y = Number(dateStr.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

// Mismo criterio de conversión que ya usa el Dashboard Comercial
// (src/lib/commercial-dashboard/metrics.ts): MXN a la par, USD con su
// "exchangeRate" propio (fijado al momento del deal), con 20 de respaldo
// si el deal no tiene exchangeRate capturado. Se reutiliza tal cual para
// que el total consolidado de este módulo no invente su propio criterio.
//
// Confirmado en vivo (Danone 2026 saliendo en ~$18.7M cuando lo real son
// ~$5M): un puñado de deals no tienen "currency" capturado en absoluto
// (campo vacío, ni "MXN" ni "USD"). Antes, cualquier cosa que no empezara
// con "MXN" caía al branch de conversión con el respaldo ×20 — un deal de
// $690,000 sin moneda se convertía en $13,800,000. La moneda por default
// de la agencia es MXN (ver DATOS en el prompt de sistema), así que sin
// moneda registrada se asume MXN, no una divisa extranjera a convertir.
function toMxn(currency: unknown, clientPrice: unknown, exchangeRate: unknown): number {
  const price = Number(clientPrice) || 0;
  const cur = typeof currency === 'string' ? currency : '';
  if (!cur || cur.startsWith('MXN')) return price;
  const rate = Number(exchangeRate);
  return price * (Number.isFinite(rate) && rate > 0 ? rate : 20);
}

// GPT-4o sumando cifras "a ojo" sobre 421 filas de CSV en texto es
// estructuralmente poco confiable (confirmado en vivo: reportó $0 para un
// año con deals reales de millones de pesos) — no es un problema de qué
// campo usar, sino de pedirle aritmética exacta a un LLM sobre texto plano
// en vez de hacerla en código. Se resuelve pre-agregando aquí (año de
// ingreso real vía la misma regla de la REGLA CRÍTICA DE FECHAS del
// system prompt: approvalDate si está ganado, fechaPerdida si está
// perdido, nunca proposalDate/createdAt) y dándole al modelo sumas ya
// calculadas para lo que casi siempre pregunta: totales por cliente/año/
// moneda. El CSV de detalle se mantiene para cortes que esto no cubre
// (rubro, tipo de proyecto, gerente, deals individuales).
//
// Cada combinación cliente/año/estatus sale dos veces: una fila por cada
// moneda real (montos SIN convertir, tal como están en el deal) y una fila
// "TODAS (convertido a MXN)" con el consolidado — así el modelo tiene listo
// tanto el desglose por moneda como el total, sin tener que sumar monedas
// distintas él mismo (que es exactamente el tipo de suma que no debe hacer
// a mano).
function buildRevenueSummary(deals: any[]): string {
  type Row = { client: string; year: number | null; bucket: string; currency: string; count: number; sumClientPrice: number; sumQuotedCost: number };
  const byCurrency = new Map<string, Row>();
  const totalMxn = new Map<string, Row>();

  const bump = (m: Map<string, Row>, key: string, seed: Pick<Row, 'client' | 'year' | 'bucket' | 'currency'>, price: number, cost: number) => {
    const existing = m.get(key) ?? { ...seed, count: 0, sumClientPrice: 0, sumQuotedCost: 0 };
    existing.count += 1;
    existing.sumClientPrice += price;
    existing.sumQuotedCost += cost;
    m.set(key, existing);
  };

  for (const d of deals) {
    const approvalYear = yearOf(d.approvalDate);
    const lostYear = yearOf(d.fechaPerdida);
    let bucket: string;
    let year: number | null;
    if (approvalYear !== null) { bucket = 'Ganado'; year = approvalYear; }
    else if (lostYear !== null) { bucket = 'Perdido'; year = lostYear; }
    else { bucket = 'Sin fecha de aprobación/pérdida'; year = null; }
    const clientName = d.client || '(sin cliente)';
    const currency = d.currency || '(sin moneda)';
    const price = Number(d.clientPrice) || 0;
    const cost = Number(d.quotedCost) || 0;
    const priceMxn = toMxn(d.currency, d.clientPrice, d.exchangeRate);

    bump(byCurrency, `${clientName}|${year}|${bucket}|${currency}`, { client: clientName, year, bucket, currency }, price, cost);
    bump(totalMxn, `${clientName}|${year}|${bucket}`, { client: clientName, year, bucket, currency: 'TODAS (convertido a MXN)' }, priceMxn, cost);
  }

  const rows = [...byCurrency.values(), ...totalMxn.values()].sort((a, b) =>
    a.client.localeCompare(b.client) || (a.year ?? 0) - (b.year ?? 0) || a.bucket.localeCompare(b.bucket) || a.currency.localeCompare(b.currency)
  );
  const lines = ['client,year,bucket,currency,numDeals,sumClientPrice,sumQuotedCost'];
  for (const r of rows) {
    lines.push([r.client, r.year ?? '', r.bucket, r.currency, r.count, r.sumClientPrice, r.sumQuotedCost].map(csvEscape).join(','));
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `Eres un analista comercial senior de Sapience, una agencia de investigación de mercados en México. Tienes acceso al historial COMPLETO de deals (ventas/propuestas comerciales) de la agencia, en formato CSV, y debes responder preguntas del dueño de la agencia sobre tendencias, comparativas y desempeño de ventas.

DATOS: cada fila es un deal. "clientPrice"/"quotedCost" están en la moneda de "currency" (normalmente MXN). "phase"/"statusPropuesta" indican si el deal está ganado, perdido o en curso — infiere el significado de los valores reales que veas en los datos, no asumas nombres fijos.

REGLA CRÍTICA DE FECHAS — a qué año/periodo pertenece cada deal (síguela exactamente, es la causa de errores de cálculo si se ignora):
- Para un deal GANADO: el año/periodo de esa venta es EXCLUSIVAMENTE el de "approvalDate" (cuando se ganó). NUNCA uses "proposalDate" para esto, aunque "approvalDate" esté vacío — un deal propuesto en diciembre 2025 y ganado el 1 de enero de 2026 cuenta como venta de 2026, punto, sin importar cuándo se propuso.
- Para un deal PERDIDO: el año/periodo es EXCLUSIVAMENTE el de "fechaPerdida".
- "createdAt" es una fecha técnica de cuándo se cargó el registro en el sistema (migración), NO una fecha de negocio — jamás la uses para determinar año, periodo o para ningún análisis temporal.
- "proposalDate" solo sirve para analizar cuándo se PROPONEN deals (ej. "¿cuántas propuestas mandamos en 2025?"), nunca para atribuir ingresos/ventas ya ganadas o perdidas a un año.
- Si un deal ganado no tiene "approvalDate" (o uno perdido no tiene "fechaPerdida"), NO le asignes un año adivinando con otro campo — exclúyelo de la agregación por año y, si es relevante, menciónalo aparte en el texto ("hay N deals ganados sin fecha de aprobación registrada, no incluidos en el desglose anual").

RESUMEN PRE-CALCULADO (client, year, bucket, currency, numDeals, sumClientPrice, sumQuotedCost): viene ya agregado en código (no por ti) siguiendo exactamente la regla de fechas de arriba — úsalo SIEMPRE que la pregunta sea sobre totales, sumas o conteos por cliente y/o año y/o moneda, en vez de sumar tú mismo filas del CSV de detalle. No eres confiable sumando manualmente decenas de filas de texto — usa estos números ya calculados tal cual, no los recalcules ni los ajustes. Solo recurre al CSV de detalle fila por fila para preguntas que este resumen no cubre (desglose por rubro/tipo de proyecto/gerente, o el detalle de un deal específico).

REGLA CRÍTICA DE MONEDA — nunca sumes MXN y USD como si fueran la misma unidad:
- Por cada combinación cliente/año/estatus, el resumen trae una fila POR MONEDA REAL (montos sin convertir) y además una fila con currency="TODAS (convertido a MXN)" que ya es el consolidado correcto en pesos (usa el exchangeRate real de cada deal, igual que el Dashboard Comercial del Hub).
- Si el usuario pide "el total" sin especificar moneda: usa la fila "TODAS (convertido a MXN)" para el número consolidado, Y ADEMÁS muestra el desglose por moneda real (las filas individuales MXN/USD) en la misma respuesta — nunca entregues solo uno de los dos si no te lo piden explícitamente así.
- Nunca sumes sumClientPrice de filas con distinta "currency" entre sí — esa suma ya está hecha (mal, mezclando unidades) si la haces tú; usa la fila "TODAS" para eso.

NUNCA prometas un análisis y no lo entregues en la misma respuesta. No hay una siguiente vuelta donde "vas a calcular algo" — ya tienes AHORA MISMO todos los datos (el resumen pre-calculado y el CSV completo) para responder por completo. Está PROHIBIDO responder con frases como "voy a analizar...", "a continuación te mostraré...", "dame un momento", o cualquier variante que describa una acción futura sin ya haberla hecho — eso dejaría al usuario sin respuesta real. Cada respuesta debe entregar el análisis/tabla/cifras completos y finales, ya calculados, en el mismo "text"/"table"/"html" de esa respuesta.

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
- Cuando generes "html": debe ser un documento HTML COMPLETO y autocontenido (con <!doctype html>), que cargue Chart.js desde este CDN exacto: <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.5.1/chart.umd.min.js"></script> — no uses otra librería, otra versión ni otro CDN (esta versión y ruta están verificadas contra cdnjs; cualquier otra puede no existir y dar 404, dejando la gráfica en blanco sin ningún error visible). El gráfico SIEMPRE debe dibujarse en un elemento <canvas> (Chart.js lo hace por defecto) — esto es un requisito técnico del sistema que lo va a mostrar, no solo una preferencia visual.

DISEÑO DE LA GRÁFICA — esto no es opcional ni cosmético, la gráfica representa a la marca de Sapience y NUNCA debe verse como un ejemplo default de tutorial:
- Tipografía: carga Inter de Google Fonts (<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap">) y úsala en todo el documento (font-family: 'Inter', sans-serif en el body). Los números de los ejes/leyendas van en JetBrains Mono si quieres distinguir datos de texto (opcional, Inter para todo también es válido).
- Paleta — usa EXCLUSIVAMENTE estos colores de marca, nunca el azul/rojo/verde default de Chart.js: Teal #0F3D4D, Teal oscuro #0A303D, Gold #F4C025, Info #1795D3, Éxito #257E55, Neutral #5B687B. Para una sola serie usa Teal sólido; para varias series/categorías, rota entre Teal, Gold, Info, Éxito, Neutral en ese orden — nunca un color aleatorio ni el set por default de la librería.
- Fondo blanco (#ffffff) o gris muy claro (#F7F9FA), nunca transparente ni gris de Chart.js por default.
- Título del gráfico: usa el plugin de título de Chart.js (plugins.title) con fontSize 16-18, bold, color Teal — nunca dejar la gráfica sin título.
- Ejes: gridlines sutiles (color rgba(15,61,77,0.08) o similar, casi invisibles) — nunca las líneas grises gruesas por default. Etiquetas de eje en gris neutral (#5B687B), tamaño 12-13px.
- Barras: bordes redondeados si Chart.js lo soporta (borderRadius: 6 en el dataset), sin borde grueso ni sombra genérica.
- Leyenda: solo si hay más de una serie/categoría — si es una sola serie, quita la leyenda (plugins.legend.display: false) en vez de mostrar una leyenda de un solo ítem, que se ve redundante.
- Tamaño: canvas dentro de un contenedor con width:100%, max-width:700px, margin:auto, y padding de al menos 16px alrededor para que no se pegue a los bordes del iframe.
- Contraste y pulido general: esto debe verse como una pieza de un dashboard de analytics real y cuidado (piensa Stripe, Linear), no como el ejemplo de la página de documentación de Chart.js.
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
    const revenueSummary = buildRevenueSummary(deals);

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nRESUMEN PRE-CALCULADO POR CLIENTE/AÑO/MONEDA:\n${revenueSummary}\n\nHISTORIAL COMPLETO DE DEALS (CSV de detalle, ${deals.length} filas):\n${csv}`,
        },
        ...input.messages,
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 16384,
    });

    let parsed: { text?: string; table?: { headers?: unknown[]; rows?: unknown[][] } | null; html?: string | null };
    try {
      parsed = JSON.parse(completion.choices[0].message.content ?? '{}');
    } catch {
      parsed = { text: 'No se pudo generar el análisis. Intenta reformular la pregunta.', table: null, html: null };
    }

    // El modelo a veces regresa números/booleanos/null crudos en una celda
    // (ej. una columna de conteo) en vez de string — el outputSchema exige
    // string estricto y STRICT_OUTPUT truena el endpoint completo en ese
    // caso (confirmado en vivo: "expected string, received number" en
    // table.rows[N][1]). Se normaliza aquí en vez de confiar en que el
    // prompt lo evite siempre.
    const toStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
    const table = parsed.table
      ? { headers: (parsed.table.headers ?? []).map(toStr), rows: (parsed.table.rows ?? []).map(row => row.map(toStr)) }
      : null;

    return {
      text: parsed.text ?? 'No se pudo generar el análisis. Intenta reformular la pregunta.',
      table,
      html: parsed.html ?? null,
    };
  },
});
