import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { exigirAccesoGuias } from '../serverUtils/guias/acceso';
import { textoDeArchivo } from '../serverUtils/guias/archivo';

// Lee el roadmap o el brief que se sube (Word, .txt o .md) y devuelve el texto, para revisarlo en pantalla antes de pedirle nada a la IA.
export default createEndpoint({
  authenticated: true,
  description: 'Lee un archivo (Word, .txt o .md) para una guía de tópicos y devuelve su texto',
  inputSchema: z.object({ nombre: z.string().trim().min(1).max(300), base64: z.string().min(1).max(14_500_000) }),
  outputSchema: z.object({ texto: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoGuias(context);
    return { texto: await textoDeArchivo(input.nombre, Buffer.from(input.base64, 'base64')) };
  },
});
