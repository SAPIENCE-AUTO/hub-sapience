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

export async function startAssemblyTranscription(audioUrl: string): Promise<string> {
  const apiKey = requireEnv('ZITE_ASSEMBLYAI_KEY');
  // Sin esta URL, AssemblyAI transcribe igual pero nunca avisa que terminó —
  // src/api/assemblyaiWebhook.ts se queda esperando para siempre. Solo se
  // puede configurar una vez que exista una URL pública real (no localhost).
  const webhookUrl = process.env.ZITE_ASSEMBLYAI_WEBHOOK_URL;
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
