import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Users } from './compat';
import { ZiteError } from './compat/errors';
import { GraphAuthError } from './microsoft/graph';
import type { AuthUser, CompiledEndpoint } from './compat/endpoint';

/**
 * Descubrimiento automático: cada archivo de src/api/*.ts es un endpoint.
 * Portar uno es cambiar su import a '../../server/compat' (ver compat/README.md);
 * el servidor no se toca. Los que aún importan 'zite-integrations-backend-sdk'
 * fallan el import y se listan como pendientes, sin tumbar el arranque.
 */
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/api');

async function discoverEndpoints(): Promise<Record<string, CompiledEndpoint>> {
  const files = (await readdir(API_DIR)).filter((f) => f.endsWith('.ts'));
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

  console.log(`[server] ${Object.keys(endpoints).length} endpoints montados, ${pending.length} pendientes de portar`);
  if (pending.length) console.log(`[server] pendientes: ${pending.join(', ')}`);

  return endpoints;
}

// TODO: reemplazar por el usuario real de Supabase Auth (ver server/compat/README.md).
// Se carga completo desde `users` (no un objeto con campos fijos) para que role,
// purchaseLevel, maxApprovalAmount y los access_* vengan reales — los endpoints con
// gate de rol/permiso se pueden probar de verdad contra este mock. El email debe
// coincidir con VITE_MOCK_EMAIL del frontend para que las FK a users(id) resuelvan.
const MOCK_USER_EMAIL = process.env.VITE_MOCK_EMAIL ?? 'sergio@sapience.com.mx';

async function loadMockUser(): Promise<AuthUser> {
  const { records } = await Users.findAll({ filters: { email: MOCK_USER_EMAIL }, limit: 1 });
  const user = records[0];
  if (!user) throw new Error(`MOCK_USER_EMAIL '${MOCK_USER_EMAIL}' no existe en la tabla users`);
  return user as unknown as AuthUser;
}

const MOCK_USER = await loadMockUser();

const ENDPOINTS = await discoverEndpoints();

const app = new Hono();

app.post('/api/:name', async (c) => {
  const name = c.req.param('name');
  const endpoint = ENDPOINTS[name];
  if (!endpoint) return c.json({ message: `Endpoint no montado todavía: ${name}` }, 404);

  let input: unknown = {};
  try {
    input = await c.req.json();
  } catch {
    // body vacío, los endpoints sin input lo aceptan
  }

  try {
    const result = await endpoint.run(input, { user: MOCK_USER });
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
