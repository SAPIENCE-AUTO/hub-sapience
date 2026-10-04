import fs from 'node:fs';
import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta, cargarArchivos } from '../serverUtils/propuestas/datos';
import { construirPropuesta } from '../serverUtils/propuestas/construir';
import { descargarATmp, subirArchivo } from '../serverUtils/propuestas/storage';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export default createEndpoint({
  authenticated: true,
  description: 'Construye el PowerPoint con el constructor de la skill y lo sube a Storage como una versión nueva (solo Sergio)',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ version: z.number(), ajustes: z.array(z.string()) }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    const p = await cargarPropuesta(input.id);
    if (!p.contenido) throw new Error('Primero escribe el contenido de la propuesta');
    const archivos = await cargarArchivos(input.id);
    const { archivos: mapa, dir } = await descargarATmp(input.id, archivos.map(a => a.path!).filter(Boolean));
    try {
      const { buffer, ajustes } = await construirPropuesta(p.contenido, mapa);
      // v1 la primera vez; cada reconstrucción sube la versión y conserva las anteriores.
      const version = p.pptxPath ? Number(p.version ?? 1) + 1 : Number(p.version ?? 1);
      const ruta = `${input.id}/pptx/v${version}.pptx`;
      await subirArchivo(ruta, buffer, PPTX);
      await Propuestas.update({ id: input.id, record: { pptxPath: ruta, ajustesPaleta: ajustes, version, estado: 'construida' } as any });
      return { version, ajustes };
    } catch (e) {
      await Propuestas.update({ id: input.id, record: { estado: 'error' } as any });
      throw e;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
});
