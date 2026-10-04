import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta, cargarBrief, cargarArchivos, conLatido } from '../serverUtils/propuestas/datos';
import { escribirYRevisar } from '../serverUtils/propuestas/flujo';
import { Esqueleto } from '../serverUtils/propuestas/esquemas';

// Llamada 2 + revisor + hasta 2 llamadas 3 de corrección (spec §5/§7).
export default createEndpoint({
  authenticated: true,
  streaming: true,
  description: 'Escribe el contenido de la propuesta, lo pasa por el revisor y corrige hasta 2 vueltas (solo Sergio)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    estado: z.string(), vueltas: z.number(), avisos: z.array(z.string()),
    problemas: z.array(z.object({ ruta: z.string(), problema: z.string() })),
  }),
  execute: async ({ input, context, stream }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    const parsed = Esqueleto.safeParse(p.esqueleto);
    if (!parsed.success) throw new Error('Primero propón y aprueba el esqueleto');
    if (p.estado === 'esqueleto') throw new Error('Aprueba el esqueleto (guárdalo) antes de escribir la propuesta');
    const brief = await cargarBrief(p);
    const archivos = await cargarArchivos(input.id);
    const archivosPorSlot = Object.fromEntries(archivos.map(a => [`${a.tipo}:${a.slot}`, a.path!]));
    // fotos de portada en el orden de los huecos: slots FOTO_1, FOTO_2, …
    const fotos = archivos.filter(a => a.tipo === 'foto_portada')
      .sort((a, b) => Number(a.slot?.match(/\d+/)?.[0] ?? 0) - Number(b.slot?.match(/\d+/)?.[0] ?? 0))
      .map(a => a.path!);
    const r = await conLatido(stream, 'Claude sigue escribiendo…', () =>
      escribirYRevisar({ brief, notas: p.notas, esqueleto: parsed.data, archivosPorSlot, rutasFotosPortada: fotos, progreso: paso => stream?.write({ paso }) }));
    const estado = r.problemas.length ? 'contenido' : 'revisado';
    await Propuestas.update({ id: input.id, record: { contenido: r.contenido, problemas: r.problemas, estado } as any });
    return { estado, vueltas: r.vueltas, avisos: r.avisos, problemas: r.problemas };
  },
});
