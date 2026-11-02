import { z } from 'zod';
import { createEndpoint, ZiteError, ClientEntities, pool } from '../../server/compat';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';
import { validarEntidad } from '../serverUtils/clientes/entidad';
import { resolverCliente } from '../serverUtils/clientes/resolver';

export default createEndpoint({
  authenticated: true,
  description: 'Crea o actualiza una razón social de un cliente (datos fiscales, condiciones y proceso de cobranza); es un reemplazo completo de los campos editables y no cambia si está activa o desactivada — restringido a Owner o Finanzas',
  inputSchema: z.object({
    id: z.string().optional(),
    clientId: z.string(),
    legalName: z.string().optional(),
    rfc: z.string().optional(),
    taxRegime: z.string().optional(),
    postalCode: z.string().optional(),
    cfdiUse: z.string().optional(),
    paymentMethod: z.string().optional(),
    paymentForm: z.string().optional(),
    billingEmails: z.string().optional(),
    creditDays: z.number().nullable().optional(),
    requiresPo: z.boolean().optional(),
    requiresPortal: z.boolean().optional(),
    portalUrl: z.string().optional(),
    requiresGr: z.boolean().optional(),
    requiresProforma: z.boolean().optional(),
    processNotes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);

    const { errores, record } = validarEntidad(input);
    if (errores.length) throw new ZiteError({ code: 'BAD_REQUEST', message: errores.join(' ') });

    const cliente = await resolverCliente({ clientId: input.clientId });
    if (!cliente) throw new ZiteError({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });

    if (record.rfc) {
      const { rows } = await pool.query(
        `select 1 from client_entities where client_id = $1 and upper(rfc) = $2 and ($3::uuid is null or id <> $3::uuid) limit 1`,
        [cliente.id, record.rfc, input.id ?? null],
      );
      if (rows[0]) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese RFC ya está registrado en este cliente.' });
    }

    if (input.id) {
      const { rows } = await pool.query(`select client_id from client_entities where id = $1`, [input.id]);
      if (!rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Razón social no encontrada' });
      if (rows[0].client_id !== cliente.id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa razón social es de otro cliente.' });
      await ClientEntities.update({ id: input.id, record });
      return { success: true, id: input.id };
    }

    const creada = await ClientEntities.create({ record: { ...record, client: [cliente.id] } });
    return { success: true, id: creada.id };
  },
});
