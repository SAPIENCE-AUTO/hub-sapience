import { z } from 'zod';
import { createEndpoint } from '../../server/compat';

export default createEndpoint({
  authenticated: true,
  description: 'Reverse image search via Cloud Vision Web Detection — flags whether a recruitment photo already exists elsewhere on the internet',
  inputSchema: z.object({ imageUrl: z.string() }),
  outputSchema: z.object({
    pages: z.array(z.object({ url: z.string(), title: z.string().optional() })),
    exactMatches: z.number(),
    bestGuess: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const apiKey = process.env.ZITE_GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return { pages: [], exactMatches: 0, error: 'ZITE_GOOGLE_VISION_API_KEY no está configurada' };
    }

    // Se manda el contenido (base64), no `source.imageUri` — Vision intenta bajar la
    // URL desde sus propios servidores con ese campo y falla seguido con URLs
    // externas ("We can not access the URL currently"), confirmado en vivo contra
    // una foto real de S3/Fillout que sí es pública (200 OK por curl). Bajarla acá
    // y mandar los bytes es el camino confiable.
    const imgRes = await fetch(input.imageUrl);
    if (!imgRes.ok) {
      return { pages: [], exactMatches: 0, error: `No se pudo descargar la imagen (${imgRes.status})` };
    }
    const base64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'WEB_DETECTION', maxResults: 10 }],
        }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { pages: [], exactMatches: 0, error: `Cloud Vision respondió ${res.status}: ${body.slice(0, 200)}` };
    }

    const data: any = await res.json();
    const detection = data?.responses?.[0]?.webDetection;
    if (data?.responses?.[0]?.error) {
      return { pages: [], exactMatches: 0, error: data.responses[0].error.message ?? 'Error desconocido de Cloud Vision' };
    }

    const pages = (detection?.pagesWithMatchingImages ?? []).map((p: any) => ({
      url: p.url as string,
      title: p.pageTitle as string | undefined,
    }));

    return {
      pages,
      exactMatches: (detection?.fullMatchingImages ?? []).length,
      bestGuess: detection?.bestGuessLabels?.[0]?.label,
    };
  },
});
