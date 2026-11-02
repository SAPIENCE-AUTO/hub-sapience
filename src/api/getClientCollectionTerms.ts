import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';
import { COLUMNAS_CONTACTO, COLUMNAS_ENTIDAD, ContactoOut, EntidadOut, contactoDeFila, entidadDeFila } from '../serverUtils/clientes/esquemas';
import { resolverCliente } from '../serverUtils/clientes/resolver';

export default createEndpoint({
  authenticated: true,
  description: 'Razones sociales activas y contactos de un cliente, para precargar días de crédito, pasos e instrucciones al arrancar un proceso de cobranza; el cliente se busca por id, por proyecto o por nombre — restringido a Owner o Finanzas',
  inputSchema: z.object({
    clientId: z.string().optional(),
    projectCode: z.string().optional(),
    client: z.string().optional(),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    clientId: z.string().optional(),
    clientName: z.string().optional(),
    entities: z.array(EntidadOut),
    contacts: z.array(ContactoOut),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);
    const c = await resolverCliente(input);
    if (!c) return { found: false, entities: [], contacts: [] };
    const [entidades, contactos] = await Promise.all([
      pool.query(`select ${COLUMNAS_ENTIDAD} from client_entities e where e.client_id = $1 and e.deactivated_at is null order by lower(coalesce(e.legal_name, '')), e.created_at`, [c.id]),
      pool.query(`select ${COLUMNAS_CONTACTO} from client_contacts k where k.client_id = $1 order by k.created_at`, [c.id]),
    ]);
    return {
      found: true,
      clientId: c.id,
      clientName: c.name,
      entities: entidades.rows.map(entidadDeFila),
      contacts: contactos.rows.map(contactoDeFila),
    };
  },
});
