import { Hono } from 'hono';
import { resolveAuth } from './auth';

/**
 * POST /api/uploadToAssemblyAI — retransmite el archivo tal cual a
 * AssemblyAI (POST /v2/upload) sin guardarlo en ningún lado y sin el límite
 * de 50MB de server/upload.ts (ese límite es de ese endpoint, no un tope
 * global — aquí el body nunca se buffer-ea completo en memoria, se hace
 * streaming directo request→request).
 *
 * Por qué existe: Sharpli sube el archivo DIRECTO del navegador a
 * AssemblyAI para poder mandarlo en paralelo con la subida a Mux (la
 * verdadera razón de que su transcripción aparezca mucho más rápido que la
 * nuestra, que hoy espera a que Mux termine de generar un rendition de audio
 * antes de siquiera empezar) — pero para eso Sharpli le entrega su API key
 * de AssemblyAI al navegador (su propio código lo marca "SECURITY TODO").
 * Como Hub Sapience usa la MISMA cuenta/key que Sharpli, ese approach
 * expondría una key compartida a cualquiera con sesión en el Hub. Esta ruta
 * logra el mismo paralelismo (el navegador dispara esta subida Y la subida
 * a Mux al mismo tiempo, ver UploadMeetingRecordingDialog.tsx) sin que la
 * key salga nunca del servidor.
 *
 * Ruta dedicada (no el dispatcher genérico de server/index.ts) por la misma
 * razón que uploadApp/los webhooks: necesita el body crudo, sin que nada lo
 * consuma antes con c.req.json().
 */
export const assemblyRelayApp = new Hono();

assemblyRelayApp.post('/uploadToAssemblyAI', async (c) => {
  const resolved = await resolveAuth(c.req.header('Authorization'));
  if (!resolved.user) {
    return c.json({ message: 'Sesión requerida' }, 401);
  }

  const apiKey = process.env.ZITE_ASSEMBLYAI_KEY;
  if (!apiKey) {
    return c.json({ message: 'ZITE_ASSEMBLYAI_KEY no configurada' }, 500);
  }

  if (!c.req.raw.body) {
    return c.json({ message: 'Falta el archivo' }, 400);
  }

  try {
    const res = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { authorization: apiKey },
      body: c.req.raw.body,
      // @ts-expect-error -- 'duplex' no está en el tipo RequestInit de TS todavía, pero Node/undici lo requiere para streamear un body tipo ReadableStream.
      duplex: 'half',
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return c.json({ message: `AssemblyAI rechazó la subida (${res.status}): ${detail.slice(0, 300)}` }, 502);
    }
    const data = (await res.json()) as { upload_url: string };
    return c.json({ uploadUrl: data.upload_url });
  } catch (err) {
    console.error('[assemblyRelay] error retransmitiendo a AssemblyAI', (err as Error).message);
    return c.json({ message: 'No se pudo retransmitir el archivo a AssemblyAI' }, 500);
  }
});
