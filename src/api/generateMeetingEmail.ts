import { z } from 'zod';
import OpenAI from 'openai';
import { createEndpoint, MeetingRecordings, ZiteError } from '../../server/compat';

const EmailSchema = z.object({ subject: z.string(), body: z.string() });

// Minutas / notetaker (sep 2026): "quisiera poder usar este resumen/minuta
// como base para trabajar... redactar un mail interno o para mail a
// cliente" (Sergio) — parte del resumen YA generado (no del transcript
// completo, que ya se gastó su propia llamada), así que reusa el trabajo de
// síntesis en vez de repetirlo. Nunca se envía nada — regresa un borrador
// que la UI muestra para copiar/editar, el envío real lo hace el usuario
// desde su propio cliente de correo.
const EMAIL_PROMPTS: Record<'interno' | 'cliente', string> = {
  interno: `Eres un analista de Sapience redactando un correo interno de seguimiento después de una junta, dirigido al equipo.

Con base ÚNICAMENTE en el resumen y los acuerdos de la junta que se te dan (ya validados por el equipo, no inventes nada nuevo ni agregues información que no esté ahí), redacta un correo que:
1. Recuerde en una o dos líneas el objetivo o tema de la junta.
2. Liste los acuerdos/pendientes como una lista clara, con el responsable si se conoce.
3. Cierre con los próximos pasos, si el resumen los menciona.

Tono directo y profesional, como lo escribiría un compañero de equipo — no un reporte formal ni un correo genérico de "buenos días equipo". No repitas el resumen completo, solo lo esencial para que alguien que no fue a la junta sepa qué se decidió y qué le toca hacer.

Responde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin \`\`\`):
{ "subject": "asunto breve y descriptivo", "body": "cuerpo del correo en texto plano, con saltos de línea (\\n) donde corresponda, sin HTML ni Markdown" }`,

  cliente: `Eres un analista de Sapience (agencia de investigación de mercados) redactando un correo de seguimiento para el CLIENTE después de una junta con él.

Con base ÚNICAMENTE en el resumen y los acuerdos de la junta que se te dan (ya validados, no inventes nada), redacta un correo que:
1. Agradezca su tiempo en la junta.
2. Resuma en un párrafo breve lo discutido o acordado — en un tono cercano al cliente, no en jerga interna de Sapience.
3. Liste con claridad los próximos pasos y quién es responsable de cada uno (Sapience o el cliente), solo si el resumen lo indica.

NO incluyas información interna de Sapience que no le corresponda ver al cliente (por ejemplo, roles internos del equipo, riesgos operativos internos o desacuerdos entre el equipo de Sapience). Tono profesional y cordial.

Responde ÚNICAMENTE con un objeto JSON (sin texto antes ni después, sin \`\`\`):
{ "subject": "asunto breve y descriptivo", "body": "cuerpo del correo en texto plano, con saltos de línea (\\n) donde corresponda, sin HTML ni Markdown" }`,
};

export default createEndpoint({
  authenticated: true,
  description: 'Redacta un borrador de correo (interno o a cliente) a partir del resumen ya generado de una minuta',
  inputSchema: z.object({
    meetingRecordingId: z.string(),
    emailType: z.enum(['interno', 'cliente']),
  }),
  outputSchema: EmailSchema,
  execute: async ({ input }) => {
    const recording = await MeetingRecordings.findOne({ id: input.meetingRecordingId });
    if (!recording) throw new ZiteError({ code: 'NOT_FOUND', message: 'Minuta no encontrada' });
    if (!recording.summaryJson?.resumen) {
      throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esta minuta todavía no tiene un resumen generado' });
    }

    const acuerdosText = (recording.summaryJson.acuerdos ?? [])
      .map((a: { texto: string; responsable?: string | null }) => `- ${a.texto}${a.responsable ? ` (${a.responsable})` : ''}`)
      .join('\n');

    const client = new OpenAI({ apiKey: process.env.ZITE_OPENAI_ACCESS_TOKEN });
    const completion = await client.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: EMAIL_PROMPTS[input.emailType] },
        {
          role: 'user',
          content: `Resumen de la junta:\n\n${recording.summaryJson.resumen}\n\nAcuerdos:\n${acuerdosText || '(ninguno)'}`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    });

    return EmailSchema.parse(JSON.parse(completion.choices[0].message.content ?? '{}'));
  },
});
