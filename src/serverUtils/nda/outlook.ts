// El envío de correo del NDA por Microsoft Graph (Outlook) y lo que se le dice a quien apretó el botón cuando falla.
import { GraphAuthError, graphFetch, graphMailboxBase } from '../../../server/microsoft/graph';

/** Buzón del que sale. Es el mismo que ya usa Prework para escribirle a participantes; NDA_SEND_AS_EMAIL lo cambia sin tocar el código. */
export const NDA_REMITENTE_POR_DEFECTO = 'sesiones@sapience.com.mx';

export function remitenteNda(): string {
  return process.env.NDA_SEND_AS_EMAIL?.trim() || NDA_REMITENTE_POR_DEFECTO;
}

export class ErrorDeEnvio extends Error {
  constructor(public status: number, public detalle: string) {
    super(`Outlook respondió ${status}: ${detalle}`);
  }
}

export interface Adjunto { nombre: string; tipo: string; base64: string }
export type EnvioCorreo = (m: { desde: string; para: string; asunto: string; html: string; adjuntos?: Adjunto[] }) => Promise<void>;

/** El envío real. Lanza si Outlook no lo acepta. Deja copia en «Enviados» del buzón: ahí queda lo que recibió cada persona. */
export const enviarPorOutlook: EnvioCorreo = async ({ desde, para, asunto, html, adjuntos }) => {
  const resp = await graphFetch(`${graphMailboxBase(desde)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: para } }],
        ...(adjuntos?.length
          ? { attachments: adjuntos.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.nombre, contentType: a.tipo, contentBytes: a.base64 })) }
          : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (!resp.ok) {
    const detalle = (await resp.text().catch(() => '')).slice(0, 300);
    throw new ErrorDeEnvio(resp.status, detalle);
  }
};

/** Lo que se le dice a quien apretó el botón; el detalle técnico va al registro del servidor, no a la pantalla. */
export function mensajeDeFalla(e: unknown): string {
  if (e instanceof ErrorDeEnvio) {
    return e.status === 400 || e.status === 404
      ? `Outlook no aceptó el envío (${e.status}). Revisa que el correo esté bien escrito.`
      : `Outlook no aceptó el envío (${e.status}). Inténtalo de nuevo en unos minutos.`;
  }
  if (e instanceof GraphAuthError) return 'No se pudo mandar el NDA: falta configurar Outlook en el servidor.';
  return 'No se pudo conectar con Outlook. Inténtalo de nuevo.';
}
