// Cliente mínimo de AssemblyAI para transcribir minutas (sep 2026) — misma
// cuenta que ya usa Sharpli. Formato copiado tal cual de su
// startTranscription.ts/assemblyWebhook.ts (streamvault), no adivinado:
// header `authorization: <key>` en minúsculas (no "Bearer").
const ASSEMBLYAI_API = 'https://api.assemblyai.com/v2';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/**
 * A dónde avisa AssemblyAI cuando termina de transcribir: la variable ZITE_ASSEMBLYAI_WEBHOOK_URL si está puesta; si no,
 * la dirección pública de este mismo servicio en Render (RENDER_EXTERNAL_URL, que Render pone sola) más
 * /api/assemblyaiWebhook. Sin ninguna de las dos (en local) no se manda aviso: AssemblyAI no alcanza a localhost.
 *
 * Antes solo existía la variable, que en Render se pone a mano. No se puso, y del 24 de septiembre al 12 de octubre
 * todas las reuniones se transcribieron en AssemblyAI pero el Hub nunca guardó el texto: sin dirección de aviso,
 * AssemblyAI transcribe igual y no le dice nada a nadie.
 */
export function urlDeAvisoDeAssembly(env: Record<string, string | undefined> = process.env): string | undefined {
  const explicita = env.ZITE_ASSEMBLYAI_WEBHOOK_URL?.trim();
  if (explicita) return explicita;
  const host = env.RENDER_EXTERNAL_HOSTNAME?.trim();
  const base = (env.RENDER_EXTERNAL_URL?.trim() || (host ? `https://${host}` : '')).replace(/\/+$/, '');
  return base ? `${base}/api/assemblyaiWebhook` : undefined;
}

export async function startAssemblyTranscription(audioUrl: string): Promise<string> {
  const apiKey = requireEnv('ZITE_ASSEMBLYAI_KEY');
  // Sin dirección de aviso, AssemblyAI transcribe igual pero nunca avisa que terminó (ver urlDeAvisoDeAssembly).
  const webhookUrl = urlDeAvisoDeAssembly();
  const res = await fetch(`${ASSEMBLYAI_API}/transcript`, {
    method: 'POST',
    headers: { authorization: apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      language_code: 'es',
      speech_models: ['universal-2'],
      ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`AssemblyAI rechazó la transcripción (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export interface AssemblyTranscript {
  status: string;
  text?: string;
  utterances?: { speaker: string; text: string; start: number; end: number }[];
  // Timestamps por palabra (ms) — AssemblyAI los regresa por default junto
  // con el resultado, sin pedirlos con un parámetro aparte. Mismo campo que
  // ya usa Sharpli (wordsData en Streamings) para el resaltado de palabra
  // activa durante el playback.
  words?: { text: string; start: number; end: number }[];
}

export async function getAssemblyTranscript(transcriptId: string): Promise<AssemblyTranscript> {
  const apiKey = requireEnv('ZITE_ASSEMBLYAI_KEY');
  const res = await fetch(`${ASSEMBLYAI_API}/transcript/${encodeURIComponent(transcriptId)}`, {
    headers: { authorization: apiKey },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`No se pudo consultar la transcripción (${res.status}): ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Mismo formato que ya usa Sharpli — "[Speaker A] texto" por turno. Cuando
 * mergeSpeakerNames.ts ya reemplazó la etiqueta genérica de AssemblyAI
 * ("A", "B") por el nombre real de Recall, `u.speaker` deja de calzar con
 * ese patrón de una sola letra — en ese caso se usa el nombre tal cual, sin
 * el prefijo "Speaker " (que sonaría a "[Speaker Sergio Velasco]").
 */
export function formatTranscript(t: AssemblyTranscript): string {
  if (t.utterances?.length) {
    return t.utterances
      .map(u => (/^[A-Z]$/.test(u.speaker) ? `[Speaker ${u.speaker}] ${u.text}` : `[${u.speaker}] ${u.text}`))
      .join('\n\n');
  }
  return t.text ?? '';
}
