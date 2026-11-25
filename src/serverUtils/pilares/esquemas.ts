import { z } from 'zod';

// Formas de entrada y salida de los endpoints de Pilares. Los nulls salen declarados como `nullable` (Postgres los manda; aquí no se esconden: «sin monto» y «sin costo» son datos).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const Uuid = z.string().regex(UUID_RE, 'Identificador no válido');

export const PilarOut = z.object({ id: z.string(), nombre: z.string(), color: z.string(), orden: z.number(), activo: z.boolean() });

export const ItemEntrada = z.object({ pilarId: Uuid, precio: z.number().nullable().optional(), costo: z.number().nullable().optional() });
export const ItemOut = z.object({ pilarId: z.string(), precio: z.number().nullable(), costo: z.number().nullable() });

export const ResumenOut = z.object({
  estado: z.enum(['sin-clasificar', 'listo', 'sin-precio', 'incompleto', 'excedido']),
  asignado: z.number(),
  falta: z.number(),
  sobra: z.number(),
});

export const SugerenciaOut = z.object({ pilarIds: z.array(z.string()), nombres: z.array(z.string()), mixta: z.boolean() }).nullable();

export const DealBasicoOut = z.object({
  id: z.string(),
  nombre: z.string(),
  cliente: z.string().nullable(),
  fase: z.string().nullable(),
  precio: z.number().nullable(),
  moneda: z.string(),
  tipoCambio: z.number().nullable(),
  tipoProyecto: z.string().nullable(),
  fecha: z.string().nullable(),
});

export const RepartoOut = z.object({
  deal: DealBasicoOut,
  pilares: z.array(PilarOut),
  items: z.array(ItemOut),
  resumen: ResumenOut,
  sugerencia: SugerenciaOut,
  veCostos: z.boolean(),
  referencias: z.object({ real: z.number().nullable(), cotizado: z.number().nullable(), otraMoneda: z.boolean() }).nullable(),
});
