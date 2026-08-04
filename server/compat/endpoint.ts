import type { z } from 'zod';
import { ZiteError } from './errors';

/**
 * Réplica de createEndpoint. Opciones usadas en los 207 archivos:
 * description (216), inputSchema (207), outputSchema (207), execute (207), authenticated (198).
 * Un endpoint usa `stream` (analyzeRecruitmentStatus, el de OpenAI).
 */
export interface AuthUser { id: string; email: string; [k: string]: unknown }
export interface EndpointContext { user: AuthUser | null }

export interface EndpointDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  authenticated?: boolean;
  description?: string;
  inputSchema: I;
  outputSchema: O;
  execute: (args: { input: z.infer<I>; context: EndpointContext; stream?: unknown }) => Promise<z.infer<O>>;
}

export interface CompiledEndpoint {
  authenticated: boolean;
  description?: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  run: (rawInput: unknown, context: EndpointContext) => Promise<unknown>;
}

export function createEndpoint<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: EndpointDef<I, O>,
): CompiledEndpoint {
  return {
    authenticated: def.authenticated ?? true,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async run(rawInput, context) {
      if ((def.authenticated ?? true) && !context.user) {
        throw new ZiteError({ code: 'UNAUTHORIZED', message: 'Sesión requerida' });
      }
      const parsedIn = def.inputSchema.safeParse(rawInput ?? {});
      if (!parsedIn.success) {
        throw new ZiteError({
          code: 'BAD_REQUEST',
          message: parsedIn.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        });
      }
      const result = await def.execute({ input: parsedIn.data, context });
      // Validar la salida atrapa desalineaciones entre el esquema y la capa de datos
      // durante el port. En producción se puede degradar a warning.
      const parsedOut = def.outputSchema.safeParse(result);
      if (!parsedOut.success) {
        if (process.env.STRICT_OUTPUT === 'true') {
          throw new ZiteError({ code: 'INTERNAL_ERROR', message: `Salida inválida: ${parsedOut.error.message}` });
        }
        console.warn('[endpoint] salida no valida el esquema:', parsedOut.error.issues.slice(0, 3));
        return result;
      }
      return parsedOut.data;
    },
  };
}
