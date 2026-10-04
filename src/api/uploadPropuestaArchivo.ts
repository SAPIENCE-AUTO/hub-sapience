import { z } from 'zod';
import { createEndpoint, PropuestaArchivos } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta, cargarArchivos } from '../serverUtils/propuestas/datos';
import { nombreSeguro, subirArchivo } from '../serverUtils/propuestas/storage';
import { getSupabaseAdmin } from '../../server/supabaseAdmin';
import { BUCKET } from '../serverUtils/propuestas/storage';

const MAX_BYTES = 15 * 1024 * 1024;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default createEndpoint({
  authenticated: true,
  description: 'Sube una foto de portada, ilustración, entregable o foto de fase a su slot (reemplaza la anterior del mismo slot) — solo Sergio',
  inputSchema: z.object({
    id: z.string(),
    tipo: z.enum(['foto_portada', 'ilustracion', 'entregable', 'foto_fase']),
    slot: z.string().min(1).max(60),
    nombre: z.string(), mime: z.string(), base64: z.string(),
  }),
  outputSchema: z.object({ archivoId: z.string(), path: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    await cargarPropuesta(input.id);
    if (!MIMES.has(input.mime)) throw new Error('Solo se aceptan imágenes PNG, JPG o WebP');
    const buf = Buffer.from(input.base64, 'base64');
    if (buf.length > MAX_BYTES) throw new Error('La imagen pesa más de 15 MB');
    const ruta = `${input.id}/fotos/${input.tipo}_${nombreSeguro(input.slot)}_${Date.now()}_${nombreSeguro(input.nombre)}`;
    await subirArchivo(ruta, buf, input.mime);
    // Un slot, un archivo: se quita el anterior (fila y objeto en Storage).
    const previos = (await cargarArchivos(input.id)).filter(a => a.tipo === input.tipo && a.slot === input.slot);
    for (const a of previos) await PropuestaArchivos.delete({ id: a.id });
    if (previos.length) await getSupabaseAdmin().storage.from(BUCKET).remove(previos.map(a => a.path!).filter(Boolean));
    const fila = await PropuestaArchivos.create({ record: { propuesta: [input.id], tipo: input.tipo, slot: input.slot, path: ruta } as any });
    return { archivoId: fila.id, path: ruta };
  },
});
