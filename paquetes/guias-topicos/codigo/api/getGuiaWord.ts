import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { cargarGuia } from '../serverUtils/guias/datos';
import { wordDeGuia } from '../serverUtils/guias/word';

// El Word del último guardado, en base64 (unos 60 KB): el front lo convierte en Blob y lo descarga.
// (Si se prefiere el patrón de Propuestas — guardarlo en Storage y devolver una URL firmada — ver README.)
export default createEndpoint({
  authenticated: true,
  description: 'Descarga el Word de una guía de tópicos',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ nombre: z.string(), base64: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    const g: any = await cargarGuia(input.id);
    return wordDeGuia(g.estado);
  },
});
