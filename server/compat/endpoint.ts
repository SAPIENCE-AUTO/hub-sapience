import type { z } from 'zod';
import { ZiteError } from './errors';

/**
 * Réplica de createEndpoint. Opciones usadas en los 207 archivos:
 * description (216), inputSchema (207), outputSchema (207), execute (207), authenticated (198).
 *
 * `streaming: true` habilita progreso real: `run()` recibe un `onChunk` y lo
 * expone a `execute` como `stream.write(...)`; server/index.ts lo transmite
 * por SSE en vez de esperar la respuesta completa. Sin `streaming`, `stream`
 * es undefined y el endpoint se comporta exactamente igual que antes.
 */
export interface AuthUser { id: string; email: string; [k: string]: unknown }
export interface EndpointContext { user: AuthUser | null }
export interface StreamWriter { write: (chunk: unknown) => void }

export interface EndpointDef<I extends z.ZodTypeAny, O extends z.ZodTypeAny> {
  authenticated?: boolean;
  streaming?: boolean;
  description?: string;
  inputSchema: I;
  outputSchema: O;
  execute: (args: { input: z.infer<I>; context: EndpointContext; stream?: StreamWriter }) => Promise<z.infer<O>>;
}

export interface CompiledEndpoint {
  authenticated: boolean;
  streaming: boolean;
  description?: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  run: (rawInput: unknown, context: EndpointContext, onChunk?: (chunk: unknown) => void) => Promise<unknown>;
}

export function createEndpoint<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  def: EndpointDef<I, O>,
): CompiledEndpoint {
  return {
    authenticated: def.authenticated ?? true,
    streaming: def.streaming ?? false,
    description: def.description,
    inputSchema: def.inputSchema,
    outputSchema: def.outputSchema,
    async run(rawInput, context, onChunk) {
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
      const stream: StreamWriter | undefined = def.streaming
        ? { write: (chunk) => onChunk?.(chunk) }
        : undefined;
      const result = await def.execute({ input: parsedIn.data, context, stream });
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
