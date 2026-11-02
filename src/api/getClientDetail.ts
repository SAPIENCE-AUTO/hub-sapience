import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';
import { COLUMNAS_CONTACTO, COLUMNAS_ENTIDAD, ContactoOut, EntidadOut, contactoDeFila, entidadDeFila } from '../serverUtils/clientes/esquemas';

export default createEndpoint({
  authenticated: true,
  description: 'Ficha de un cliente: sus razones sociales (también las desactivadas), sus contactos de cobranza y lo que tiene por cobrar — restringido a Owner o Finanzas',
  inputSchema: z.object({ clientId: z.string() }),
  outputSchema: z.object({
    found: z.boolean(),
    client: z.object({ id: z.string(), name: z.string(), sharpliLinked: z.boolean() }).optional(),
    entities: z.array(EntidadOut),
    contacts: z.array(ContactoOut),
    stats: z.object({
      deals: z.number(),
      projects: z.number(),
      /** procesos de cobranza sin pagar, por moneda */
      pending: z.array(z.object({ currency: z.string(), processes: z.number(), amount: z.number() })),
    }).optional(),
  }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);
    const { rows: clientRows } = await pool.query(`select id, name, (sharpli_client_id is not null) as sharpli_linked from clients where id = $1`, [input.clientId]);
    const c = clientRows[0];
    if (!c) return { found: false, entities: [], contacts: [] };

    const [entidades, contactos, deals, projects, pendientes] = await Promise.all([
      pool.query(`select ${COLUMNAS_ENTIDAD} from client_entities e where e.client_id = $1 order by (e.deactivated_at is not null), lower(coalesce(e.legal_name, '')), e.created_at`, [c.id]),
      pool.query(`select ${COLUMNAS_CONTACTO} from client_contacts k where k.client_id = $1 order by k.created_at`, [c.id]),
      pool.query(`select count(*)::int as n from deals where client_id = $1`, [c.id]),
      pool.query(`select count(*)::int as n from projects where client_id = $1`, [c.id]),
      pool.query(
        `select coalesce(currency, 'MXN') as currency, count(*)::int as processes, coalesce(sum(collection_amount), 0)::float8 as amount
         from collection_processes where client_id = $1 and coalesce(status, 'Al día') <> 'Pagado' group by 1 order by 1`,
        [c.id],
      ),
    ]);

    return {
      found: true,
      client: { id: c.id as string, name: (c.name ?? '') as string, sharpliLinked: !!c.sharpli_linked },
      entities: entidades.rows.map(entidadDeFila),
      contacts: contactos.rows.map(contactoDeFila),
      stats: {
        deals: deals.rows[0].n as number,
        projects: projects.rows[0].n as number,
        pending: pendientes.rows.map(r => ({ currency: r.currency as string, processes: r.processes as number, amount: r.amount as number })),
      },
    };
  },
});
