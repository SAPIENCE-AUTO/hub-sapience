import { z } from 'zod';
import mammoth from 'mammoth';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { nombreSeguro, subirArchivo } from '../serverUtils/propuestas/storage';

const MAX_BYTES = 20 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export default createEndpoint({
  authenticated: true,
  description: 'Guarda el brief de una propuesta: texto pegado o archivo .pdf/.docx (base64) — solo Sergio',
  inputSchema: z.object({
    id: z.string(),
    texto: z.string().optional(),
    notas: z.string().optional(),
    metodo: z.enum(['cualitativo', 'cuantitativo', 'mixto']).nullable().optional(),
    archivo: z.object({ nombre: z.string(), mime: z.string(), base64: z.string() }).optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), caracteres: z.number() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    const record: Record<string, unknown> = {};
    if (input.notas !== undefined) record.notas = input.notas;
    if (input.metodo !== undefined) record.metodo = input.metodo;
    if (input.texto !== undefined) record.briefTexto = input.texto;

    if (input.archivo) {
      const buf = Buffer.from(input.archivo.base64, 'base64');
      if (buf.length > MAX_BYTES) throw new Error('El brief pesa más de 20 MB');
      const nombre = nombreSeguro(input.archivo.nombre);
      const esPdf = input.archivo.mime === 'application/pdf' || /\.pdf$/i.test(nombre);
      const esDocx = input.archivo.mime === DOCX || /\.docx$/i.test(nombre);
      if (!esPdf && !esDocx) throw new Error('El brief debe ser .pdf o .docx (o pega el texto)');
      const ruta = `${input.id}/brief/${nombre}`;
      await subirArchivo(ruta, buf, esPdf ? 'application/pdf' : DOCX);
      record.briefPath = ruta;
      // .docx → texto con mammoth; el PDF se guarda y se manda a Claude como documento nativo.
      record.briefTexto = esDocx ? (await mammoth.extractRawText({ buffer: buf })).value.trim() : null;
    }

    if (Object.keys(record).length) await Propuestas.update({ id: input.id, record: record as any });
    const texto = (record.briefTexto as string | null | undefined) ?? p.briefTexto ?? '';
    return { success: true, caracteres: texto.length };
  },
});
