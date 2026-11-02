import { z } from 'zod';
import { createEndpoint, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';

const lleno = (col: string) => `nullif(trim(coalesce(${col}, '')), '') is not null`;

export default createEndpoint({
  authenticated: true,
  description: 'Catálogo de clientes con cuántas razones sociales activas tienen y qué tan completos están sus datos de cobro y de facturación — restringido a Owner o Finanzas',
  inputSchema: z.object({}),
  outputSchema: z.object({
    clients: z.array(z.object({
      id: z.string(),
      name: z.string(),
      sharpliLinked: z.boolean(),
      /** razones sociales activas */
      entities: z.number(),
      /** de esas, las que ya tienen días de crédito */
      cobroListo: z.number(),
      /** de esas, las que ya tienen los datos fiscales para facturar */
      facturaListo: z.number(),
      contacts: z.number(),
      deals: z.number(),
      projects: z.number(),
    })),
  }),
  execute: async ({ context }) => {
    exigirAccesoClientes(context);
    const { rows } = await pool.query(`
      select c.id, c.name, (c.sharpli_client_id is not null) as sharpli_linked,
             coalesce(e.activas, 0)::int as entities,
             coalesce(e.cobro, 0)::int as cobro_listo,
             coalesce(e.factura, 0)::int as factura_listo,
             coalesce(k.n, 0)::int as contacts,
             coalesce(d.n, 0)::int as deals,
             coalesce(p.n, 0)::int as projects
      from clients c
      left join (
        select client_id,
               count(*) as activas,
               count(*) filter (where credit_days is not null) as cobro,
               count(*) filter (where ${lleno('legal_name')} and ${lleno('rfc')} and ${lleno('tax_regime')} and ${lleno('postal_code')} and ${lleno('cfdi_use')}) as factura
        from client_entities where deactivated_at is null group by client_id
      ) e on e.client_id = c.id
      left join (select client_id, count(*) as n from client_contacts group by client_id) k on k.client_id = c.id
      left join (select client_id, count(*) as n from deals where client_id is not null group by client_id) d on d.client_id = c.id
      left join (select client_id, count(*) as n from projects where client_id is not null group by client_id) p on p.client_id = c.id
      order by lower(c.name)
    `);
    return {
      clients: rows.map(r => ({
        id: r.id as string,
        name: (r.name ?? '') as string,
        sharpliLinked: !!r.sharpli_linked,
        entities: r.entities as number,
        cobroListo: r.cobro_listo as number,
        facturaListo: r.factura_listo as number,
        contacts: r.contacts as number,
        deals: r.deals as number,
        projects: r.projects as number,
      })),
    };
  },
});
