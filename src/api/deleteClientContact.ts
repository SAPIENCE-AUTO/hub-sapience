import { z } from 'zod';
import { createEndpoint, ClientContacts } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';

export default createEndpoint({
  authenticated: true,
  description: 'Borra un contacto de cobranza de un cliente — restringido a Owner o Finanzas',
  inputSchema: z.object({ id: z.string() }),
  outputSchema: z.object({ success: z.boolean() }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);
    await ClientContacts.delete({ id: input.id });
    return { success: true };
  },
});
