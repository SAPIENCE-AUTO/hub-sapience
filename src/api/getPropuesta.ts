import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta, cargarArchivos } from '../serverUtils/propuestas/datos';
import { getSupabaseAdmin } from '../../server/supabaseAdmin';
import { BUCKET } from '../serverUtils/propuestas/storage';

export default createEndpoint({
  authenticated: true,
  description: 'Propuesta completa con sus archivos y versiones del PowerPoint (solo Sergio)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({
    id: z.string(), titulo: z.string().optional(), estado: z.string(), metodo: z.string().optional(),
    notas: z.string().optional(), tieneBrief: z.boolean(), briefNombre: z.string().optional(),
    esqueleto: z.any().optional(), contenido: z.any().optional(),
    problemas: z.array(z.object({ ruta: z.string(), problema: z.string() })),
    ajustesPaleta: z.array(z.string()), version: z.number(), tienePptx: z.boolean(),
    versiones: z.array(z.number()),
    archivos: z.array(z.object({ id: z.string(), tipo: z.string(), slot: z.string().optional(), path: z.string() })),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    const archivos = await cargarArchivos(input.id);
    const { data: lista } = await getSupabaseAdmin().storage.from(BUCKET).list(`${input.id}/pptx`);
    const versiones = (lista ?? []).map(f => Number(f.name.match(/^v(\d+)\.pptx$/)?.[1])).filter(n => n > 0).sort((a, b) => b - a);
    return {
      id: p.id, titulo: p.titulo ?? undefined, estado: p.estado ?? 'borrador', metodo: p.metodo ?? undefined,
      notas: p.notas ?? undefined, tieneBrief: !!(p.briefTexto || p.briefPath),
      briefNombre: p.briefPath ? p.briefPath.split('/').pop() : undefined,
      esqueleto: p.esqueleto ?? undefined, contenido: p.contenido ?? undefined,
      problemas: (p.problemas as any) ?? [], ajustesPaleta: (p.ajustesPaleta as any) ?? [],
      version: Number(p.version ?? 1), tienePptx: !!p.pptxPath, versiones,
      archivos: archivos.map(a => ({ id: a.id, tipo: a.tipo!, slot: a.slot ?? undefined, path: a.path! })),
    };
  },
});
