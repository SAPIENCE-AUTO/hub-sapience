import { z } from 'zod';
import { createEndpoint, Propuestas } from '../../server/compat';
import { exigirAccesoPropuestas } from '../serverUtils/propuestas/acceso';
import { cargarPropuesta } from '../serverUtils/propuestas/datos';
import { Contenido } from '../serverUtils/propuestas/esquemas';
import { revisarTodo } from '../serverUtils/propuestas/revision';

// Edición manual del contenido (pantalla 4, "editor JSON simple") — se vuelve a
// pasar por el revisor para que el estado y los problemas reflejen lo guardado.
export default createEndpoint({
  authenticated: true,
  description: 'Guarda el contenido editado a mano y lo vuelve a revisar (solo Sergio)',
  inputSchema: z.object({ id: z.string(), contenido: Contenido }),
  outputSchema: z.object({ estado: z.string(), problemas: z.array(z.object({ ruta: z.string(), problema: z.string() })) }),
  execute: async ({ input, context }) => {
    exigirAccesoPropuestas(context);
    await cargarPropuesta(input.id);
    const problemas = revisarTodo(input.contenido);
    const estado = problemas.length ? 'contenido' : 'revisado';
    await Propuestas.update({ id: input.id, record: { contenido: input.contenido, problemas, estado } as any });
    return { estado, problemas };
  },
});
