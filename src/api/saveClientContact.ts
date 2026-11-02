import { z } from 'zod';
import { createEndpoint, ZiteError, ClientContacts, pool } from '../../server/compat';
import { ROLES_CONTACTO } from '../lib/clientes/catalogos';
import { correoValido, textoOUndefined } from '../lib/clientes/validacion';
import { exigirAccesoClientes } from '../serverUtils/clientes/acceso';
import { resolverCliente } from '../serverUtils/clientes/resolver';

export default createEndpoint({
  authenticated: true,
  description: 'Crea o actualiza un contacto de cobranza de un cliente (a quién se le manda la factura o se le da seguimiento); `entityId` lo liga a una razón social — restringido a Owner o Finanzas',
  inputSchema: z.object({
    id: z.string().optional(),
    clientId: z.string(),
    entityId: z.string().nullable().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    role: z.string().optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({ success: z.boolean(), id: z.string() }),
  execute: async ({ input, context }) => {
    exigirAccesoClientes(context);

    const name = textoOUndefined(input.name);
    if (!name) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Escribe el nombre del contacto.' });
    const email = textoOUndefined(input.email);
    if (email && !correoValido(email)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El correo no parece válido.' });
    const role = textoOUndefined(input.role);
    if (role && !(ROLES_CONTACTO as readonly string[]).includes(role)) throw new ZiteError({ code: 'BAD_REQUEST', message: 'El rol del contacto no está en la lista.' });

    const cliente = await resolverCliente({ clientId: input.clientId });
    if (!cliente) throw new ZiteError({ code: 'NOT_FOUND', message: 'Cliente no encontrado' });

    if (input.entityId) {
      const { rows } = await pool.query(`select client_id from client_entities where id = $1`, [input.entityId]);
      if (!rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Razón social no encontrada' });
      if (rows[0].client_id !== cliente.id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Esa razón social es de otro cliente.' });
    }

    const record = {
      name,
      email: email ?? null,
      phone: textoOUndefined(input.phone) ?? null,
      role: role ?? null,
      notes: textoOUndefined(input.notes) ?? null,
      entity: input.entityId ? [input.entityId] : [],
    };

    if (input.id) {
      const { rows } = await pool.query(`select client_id from client_contacts where id = $1`, [input.id]);
      if (!rows[0]) throw new ZiteError({ code: 'NOT_FOUND', message: 'Contacto no encontrado' });
      if (rows[0].client_id !== cliente.id) throw new ZiteError({ code: 'BAD_REQUEST', message: 'Ese contacto es de otro cliente.' });
      await ClientContacts.update({ id: input.id, record });
      return { success: true, id: input.id };
    }

    const creado = await ClientContacts.create({ record: { ...record, client: [cliente.id] } });
    return { success: true, id: creado.id };
  },
});
