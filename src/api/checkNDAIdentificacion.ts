import { z } from 'zod';
import { createEndpoint } from '../../server/compat';
import { comprobarIdentificacion } from '../serverUtils/nda/identificacion';

// Apoyo para el equipo (detalle del NDA firmado): compara el nombre con que firmó contra el de su identificación y, si se pide, la firma del NDA contra la de la identificación con la IA.
// Solo orientativo y de solo lectura: no guarda nada ni cambia el estado de nadie. Guía: docs/nda.md.
export default createEndpoint({
  authenticated: true,
  description: 'Compare who signed an NDA with the identification they uploaded in a Hub screener: signed name vs ID name and, with conFirma, the NDA signature vs the ID signature (AI, orientative only)',
  inputSchema: z.object({
    envioId: z.string().uuid(),
    // Compara también las firmas con la IA (cuesta menos de un centavo de dólar); sin esto solo se compara el nombre.
    conFirma: z.boolean().optional(),
  }),
  outputSchema: z.object({
    disponible: z.boolean(),
    motivo: z.string().optional(),
    nombreFirmado: z.string().optional(),
    nombreIdentificacion: z.string().optional(),
    nombre: z.enum(['coincide', 'distinto', 'sin-dato']).optional(),
    firma: z.object({
      veredicto: z.enum(['parecidas', 'distintas', 'no_concluyente']),
      comentario: z.string(),
      firmaNda: z.string(),
      firmaIdentificacion: z.string().optional(),
    }).optional(),
  }),
  execute: async ({ input }) => comprobarIdentificacion(input.envioId, { conFirma: input.conFirma }),
});
