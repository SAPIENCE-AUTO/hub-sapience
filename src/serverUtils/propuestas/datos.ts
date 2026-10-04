import { ZiteError, Propuestas, PropuestaArchivos } from '../../../server/compat';
import { descargarArchivo } from './storage';
import type { BriefInput } from './flujo';

export async function cargarPropuesta(id: string) {
  const p = await Propuestas.findOne({ id });
  if (!p) throw new ZiteError({ code: 'NOT_FOUND', message: 'Propuesta no encontrada' });
  return p;
}

// Texto del brief (docx/pegado) y/o el PDF original como base64 para mandarlo
// a Claude como documento nativo (spec §2).
export async function cargarBrief(p: { briefTexto?: string | null; briefPath?: string | null }): Promise<BriefInput> {
  let pdfBase64: string | null = null;
  if (p.briefPath && /\.pdf$/i.test(p.briefPath)) pdfBase64 = (await descargarArchivo(p.briefPath)).toString('base64');
  return { texto: p.briefTexto ?? null, pdfBase64 };
}

export async function cargarArchivos(propuestaId: string) {
  const { records } = await PropuestaArchivos.findAll({ filters: { propuesta: propuestaId } as never, limit: 500 });
  return records;
}

// Heartbeat para endpoints streaming: Claude tarda minutos en una sola llamada y
// una conexión sin tráfico puede cortarse en el camino — se avisa que sigue vivo.
export function conLatido<T>(stream: { write: (c: any) => void } | undefined, mensaje: string, trabajo: () => Promise<T>): Promise<T> {
  const t = setInterval(() => stream?.write({ paso: mensaje, latido: true }), 15_000);
  return trabajo().finally(() => clearInterval(t));
}
