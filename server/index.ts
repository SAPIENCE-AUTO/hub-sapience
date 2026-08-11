import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { ZiteError } from './compat/errors';
import { GraphAuthError } from './microsoft/graph';
import { resolveAuth } from './auth';
import type { CompiledEndpoint } from './compat/endpoint';

/**
 * Descubrimiento automático: cada archivo de src/api/*.ts es un endpoint.
 * Portar uno es cambiar su import a '../../server/compat' (ver compat/README.md);
 * el servidor no se toca. Los que aún importan 'zite-integrations-backend-sdk'
 * fallan el import y se listan como pendientes, sin tumbar el arranque.
 */
// Relativo al archivo (import.meta.url), no al cwd del proceso — así resuelve
// igual sin importar desde dónde se invoque `tsx index.ts`.
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/api');

async function discoverEndpoints(): Promise<Record<string, CompiledEndpoint>> {
  // Si src/api/ no llegó al entorno donde corre esto (p.ej. un rootDir de
  // despliegue que aísla server/ del resto del repo), antes esto se colaba
  // silencioso como "0 endpoints, N pendientes" — indistinguible en el log de
  // que simplemente falta portar N endpoints. Ahora truena de inmediato y con
  // el path exacto que se intentó leer, en vez de arrancar en un estado roto.
  let files: string[];
  try {
    files = (await readdir(API_DIR)).filter((f) => f.endsWith('.ts'));
  } catch (err) {
    throw new Error(
      `No se pudo leer el directorio de endpoints en "${API_DIR}" (resuelto desde ${import.meta.url}). ` +
      `Si src/api/ no está presente ahí, es un problema del entorno de despliegue (p.ej. un rootDir ` +
      `que sube solo server/ y deja fuera el resto del repo), no del código. Causa original: ${(err as Error).message}`,
    );
  }
  if (files.length === 0) {
    throw new Error(`"${API_DIR}" existe pero no tiene ningún archivo .ts — nada que montar.`);
  }

  const endpoints: Record<string, CompiledEndpoint> = {};
  const pending: string[] = [];

  for (const file of files) {
    const name = file.replace(/\.ts$/, '');
    try {
      const mod = await import(pathToFileURL(path.join(API_DIR, file)).href);
      const endpoint = mod.default;
      if (endpoint && typeof endpoint.run === 'function') {
        endpoints[name] = endpoint;
      } else {
        pending.push(`${name} (sin export default de createEndpoint)`);
      }
    } catch (err) {
      pending.push(`${name} (${err instanceof Error ? err.message.split('\n')[0] : err})`);
    }
  }

  // Siempre hay al menos varias decenas de endpoints ya portados hoy — cero
  // montados con archivos de sobra es un entorno roto (dependencias faltantes,
  // módulos no resueltos), no "todavía no se ha portado nada". Fallar aquí en
  // vez de servir un backend que responde 404 a todo como si estuviera sano.
  if (Object.keys(endpoints).length === 0) {
    throw new Error(
      `Se encontraron ${files.length} archivos en "${API_DIR}" pero ninguno se pudo montar. ` +
      `Primer error: ${pending[0]}`,
    );
  }

  console.log(`[server] ${Object.keys(endpoints).length} endpoints montados, ${pending.length} pendientes de portar`);
  if (pending.length) console.log(`[server] pendientes: ${pending.join(', ')}`);

  return endpoints;
}

const ENDPOINTS = await discoverEndpoints();

const app = new Hono();

// En dev, Vite hace proxy de /api al backend (mismo origen desde el navegador,
// nunca dispara CORS). En prod, front (Static Site) y back (Web Service) viven
// en dominios distintos de Render — sin esto el navegador bloquea la respuesta.
// Reusa ZITE_APP_URL (ya es "la URL pública del front", ver preparePoEmail.ts
// y afines) en vez de inventar otra variable para lo mismo. Acepta lista
// separada por comas para cubrir un dominio propio + el subdominio de Render.
const allowedOrigins = (process.env.ZITE_APP_URL ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  '/api/*',
  cors({
    origin: allowedOrigins,
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

// Para el health check de Render: la única ruta que existe es POST /api/:name,
// así que un GET a cualquier /api/* de por sí ya daría 404 aunque el server
// esté sano — Render lo leería como caído.
app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/api/:name', async (c) => {
  const name = c.req.param('name');
  const endpoint = ENDPOINTS[name];
  if (!endpoint) return c.json({ message: `Endpoint no montado todavía: ${name}` }, 404);

  // Solo se resuelve auth para endpoints que la piden — un endpoint público
  // (authenticated: false) no debe bloquearse por una sesión de Supabase vieja
  // o no aprovisionada que el navegador mande de todos modos (getSharedViewData,
  // getSupplierPortalData, etc. tienen su propio auth por token).
  let user = null;
  if (endpoint.authenticated) {
    const resolved = await resolveAuth(c.req.header('Authorization'));
    if (resolved.notProvisioned) {
      return c.json({
        message: 'Tu correo no está registrado en Hub Sapience. Contacta a un administrador.',
        code: 'NOT_PROVISIONED',
      }, 403);
    }
    user = resolved.user;
  }

  let input: unknown = {};
  try {
    input = await c.req.json();
  } catch {
    // body vacío, los endpoints sin input lo aceptan
  }

  // Endpoints con `streaming: true` (ver compat/endpoint.ts) transmiten
  // progreso real por SSE en vez de que el cliente espere a ciegas la
  // respuesta completa — hoy solo checkNewSubmissions lo usa. El formato de
  // cada evento es JSON plano en `data:` — no hace falta `event:` porque el
  // shim del front distingue por el campo `type` dentro del payload.
  if (endpoint.streaming) {
    return streamSSE(c, async (stream) => {
      try {
        const result = await endpoint.run(input, { user }, (chunk) => {
          void stream.writeSSE({ data: JSON.stringify({ type: 'progress', ...(chunk as object) }) });
        });
        await stream.writeSSE({ data: JSON.stringify({ type: 'done', result }) });
      } catch (err) {
        if (err instanceof ZiteError) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err.message, code: err.code }) });
        } else if (err instanceof GraphAuthError) {
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: err.message, code: 'GRAPH_AUTH_ERROR' }) });
        } else {
          console.error(`[api/${name}]`, err);
          await stream.writeSSE({ data: JSON.stringify({ type: 'error', message: 'Error interno' }) });
        }
      }
    });
  }

  try {
    const result = await endpoint.run(input, { user });
    return c.json(result as object);
  } catch (err) {
    if (err instanceof ZiteError) {
      return c.json({ message: err.message, code: err.code }, err.status as 400 | 401 | 403 | 404 | 500);
    }
    // GraphAuthError (server/microsoft/graph.ts) sale legible en vez de "Error
    // interno" para los 7 endpoints que usan Microsoft Graph — un solo lugar
    // en vez de repetir el mismo try/catch en cada uno.
    if (err instanceof GraphAuthError) {
      return c.json({ message: err.message, code: 'GRAPH_AUTH_ERROR' }, 400);
    }
    console.error(`[api/${name}]`, err);
    return c.json({ message: 'Error interno' }, 500);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] escuchando en http://localhost:${info.port}`);
});
