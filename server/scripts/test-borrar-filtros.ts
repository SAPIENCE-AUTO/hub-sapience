// Pruebas de borrar un filtro que es una copia con personas traídas de otro filtro (mientras no tenga tablero vinculado), y de «Borrar pruebas» en una copia así: antes la copia no se podía borrar nunca (las traídas
// contaban como respuestas reales) y, si hubiera podido, se habrían borrado también las fotos del filtro de origen, porque las respuestas traídas guardan las mismas rutas.
// Contra una base en memoria (PGlite) con las tablas de filtros mínimas y un Storage de mentira (se atrapan las llamadas de borrado). Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-borrar-filtros.ts
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import deleteFormulario from '../../src/api/deleteFormulario';
import deleteFormularioRespuestas from '../../src/api/deleteFormularioRespuestas';
import getFormularios from '../../src/api/getFormularios';

// Un Storage de mentira: el cliente de Supabase usa el `fetch` global, que aquí solo anota qué rutas se piden borrar.
process.env.SUPABASE_URL = 'http://supabase.ejemplo.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-prueba';
const borradas: string[] = [];
globalThis.fetch = (async (entrada: unknown, init?: { method?: string; body?: unknown }) => {
  const url = String(typeof entrada === 'string' ? entrada : (entrada as { url?: string })?.url ?? entrada);
  if (init?.method === 'DELETE' && /\/object\//.test(url)) borradas.push(...((JSON.parse(String(init.body)) as { prefixes?: string[] }).prefixes ?? []));
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).message : (e as Error).message.split('\n')[0]}`);
  }
}

const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(`
  create table projects (id uuid primary key default gen_random_uuid(), project_code text);
  create table formularios (
    id uuid primary key default gen_random_uuid(), proyecto_id uuid, codigo text unique not null, titulo text not null, plantilla text,
    definicion jsonb not null, cambios jsonb, vinculo jsonb, generador jsonb, estado text not null default 'borrador',
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table formulario_respuestas (
    id uuid primary key default gen_random_uuid(), formulario_id uuid not null references formularios(id) on delete cascade,
    created_at timestamptz not null default now(), es_prueba boolean not null, respuestas jsonb not null, resultado jsonb not null,
    califica boolean not null default false, nombre text, telefono text, device_token text, duracion_seg int
  );
`);

const ctx = { user: { id: '00000000-0000-0000-0000-000000000001', email: 'analista@ejemplo.test' } } as any;
const DEF = PLANTILLAS.prueba_tipos.definicion;
const { rows: [{ id: proyectoId }] } = await pg.query<{ id: string }>(`insert into projects (project_code) values ('PRY-PRUEBA') returning id`);
let secuencia = 0;
const filtro = async (titulo: string, estado = 'borrador'): Promise<string> => (await pg.query<{ id: string }>(
  `insert into formularios (codigo, titulo, estado, definicion, proyecto_id) values ($1, $2, $3, $4::jsonb, $5) returning id`,
  [`c${++secuencia}`, titulo, estado, JSON.stringify(DEF), proyectoId])).rows[0].id;
type Resp = { esPrueba?: boolean; traida?: boolean; foto?: string };
const respuesta = async (formularioId: string, r: Resp = {}) => {
  const resultado: Record<string, unknown> = { califica: true };
  if (r.traida) resultado.traida = { formularioId: 'otro', titulo: 'Filtro anterior', fecha: '2026-10-01T00:00:00.000Z' };
  await pg.query(
    `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica) values ($1, $2, $3::jsonb, $4::jsonb, true)`,
    [formularioId, r.esPrueba ?? false, JSON.stringify(r.foto ? { foto_casa: [{ ruta: r.foto, nombre: 'foto.jpg' }] } : {}), JSON.stringify(resultado)],
  );
};
const existe = async (id: string) => (await pg.query(`select 1 from formularios where id = $1`, [id])).rows.length === 1;
const respuestasDe = async (id: string) => Number((await pg.query<{ n: number }>(`select count(*)::int as n from formulario_respuestas where formulario_id = $1`, [id])).rows[0].n);
const borrar = (formularioId: string) => deleteFormulario.run({ formularioId }, ctx);
const lista = async () => (await getFormularios.run({ proyectoId }, ctx) as { formularios: { id: string; respuestasReales: number; respuestasQueImpidenBorrar: number; respuestasPrueba: number }[] }).formularios;

// El filtro de origen: en vivo, con una respuesta real con foto. Y la copia: borrador con personas traídas de él (con las mismas rutas de fotos).
const origen = await filtro('Filtro de origen', 'en_vivo');
await respuesta(origen, { foto: 'origen/foto-real.jpg' });
await respuesta(origen, { esPrueba: true, foto: 'origen/foto-prueba.jpg' });

await prueba('una copia en borrador con personas traídas SÍ se puede borrar (antes: «ciérralo en lugar de borrarlo»)', async () => {
  const copia = await filtro('Copia con traídas');
  await respuesta(copia, { traida: true, foto: 'origen/foto-real.jpg' });
  await respuesta(copia, { traida: true });
  await borrar(copia);
  assert.equal(await existe(copia), false);
  assert.equal(await respuestasDe(copia), 0);
});

await prueba('al borrar la copia NO se borran las fotos del filtro de origen que guardan sus traídas', () => {
  assert.equal(borradas.includes('origen/foto-real.jpg'), false);
});

await prueba('el filtro de origen sigue completo: sus respuestas y su filtro', async () => {
  assert.equal(await existe(origen), true);
  assert.equal(await respuestasDe(origen), 2);
});

await prueba('de la copia sí se borran sus fotos propias (las de sus respuestas de prueba)', async () => {
  const copia = await filtro('Copia con foto propia');
  await respuesta(copia, { traida: true, foto: 'origen/foto-real.jpg' });
  await respuesta(copia, { esPrueba: true, foto: 'copia/foto-propia.jpg' });
  await borrar(copia);
  assert.equal(await existe(copia), false);
  assert.ok(borradas.includes('copia/foto-propia.jpg'));
  assert.equal(borradas.includes('origen/foto-real.jpg'), false);
});

await prueba('una copia con personas traídas que ya tiene tablero vinculado NO se puede borrar: esas personas ya son del proyecto, el filtro se cierra', async () => {
  const f = await filtro('Copia con tablero', 'en_vivo');
  await respuesta(f, { traida: true });
  await respuesta(f, { traida: true });
  await pg.query(`update formularios set vinculo = $2::jsonb where id = $1`, [f, JSON.stringify({ boardId: 'tablero-de-prueba', boardName: 'Tablero', projectCode: 'PRY-PRUEBA', columnas: {} })]);
  await assert.rejects(() => borrar(f), (e: Error) => /tiene respuestas reales/.test(e.message));
  assert.equal(await existe(f), true);
  assert.equal(await respuestasDe(f), 2);
});

await prueba('un filtro con una respuesta real de un participante, aunque también tenga traídas, sigue sin poder borrarse', async () => {
  const f = await filtro('Con una real', 'en_vivo');
  await respuesta(f, { traida: true });
  await respuesta(f, {});
  await assert.rejects(() => borrar(f), (e: Error) => /tiene respuestas reales/.test(e.message));
  assert.equal(await existe(f), true);
  assert.equal(await respuestasDe(f), 2);
});

await prueba('el origen, con su respuesta real, tampoco se puede borrar', async () => {
  await assert.rejects(() => borrar(origen), (e: Error) => /tiene respuestas reales/.test(e.message));
  assert.equal(await existe(origen), true);
});

await prueba('un filtro con solo respuestas de prueba se borra como siempre, con sus fotos', async () => {
  const f = await filtro('Solo pruebas', 'prueba');
  await respuesta(f, { esPrueba: true, foto: 'solo/foto-prueba.jpg' });
  await borrar(f);
  assert.equal(await existe(f), false);
  assert.ok(borradas.includes('solo/foto-prueba.jpg'));
});

await prueba('«Borrar pruebas» en una copia borra sus respuestas de prueba y sus fotos propias, pero no las del filtro de origen que trae una traída de prueba', async () => {
  const copia = await filtro('Copia con pruebas', 'prueba');
  await respuesta(copia, { esPrueba: true, traida: true, foto: 'origen/foto-prueba.jpg' });
  await respuesta(copia, { esPrueba: true, foto: 'copia/foto-de-prueba.jpg' });
  const r = await deleteFormularioRespuestas.run({ formularioId: copia }, ctx) as { borradas: number };
  assert.equal(r.borradas, 2);
  assert.equal(await respuestasDe(copia), 0);
  assert.ok(borradas.includes('copia/foto-de-prueba.jpg'));
  assert.equal(borradas.includes('origen/foto-prueba.jpg'), false);
});

await prueba('«Borrar pruebas» no toca las traídas reales de la copia', async () => {
  const copia = await filtro('Copia con reales y pruebas', 'prueba');
  await respuesta(copia, { traida: true });
  await respuesta(copia, { esPrueba: true });
  await deleteFormularioRespuestas.run({ formularioId: copia }, ctx);
  assert.equal(await respuestasDe(copia), 1);
});

await prueba('la lista dice qué respuestas impiden borrar: las que llegaron por el enlace y, con tablero vinculado, también las traídas; el total sigue contando todas', async () => {
  const soloTraidas = await filtro('Lista: solo traídas');
  for (let i = 0; i < 3; i++) await respuesta(soloTraidas, { traida: true });
  const mixto = await filtro('Lista: traídas y una real', 'en_vivo');
  for (let i = 0; i < 3; i++) await respuesta(mixto, { traida: true });
  await respuesta(mixto, {});
  const conTablero = await filtro('Lista: traídas con tablero', 'en_vivo');
  for (let i = 0; i < 3; i++) await respuesta(conTablero, { traida: true });
  await pg.query(`update formularios set vinculo = $2::jsonb where id = $1`, [conTablero, JSON.stringify({ boardId: 'otro-tablero', boardName: 'Tablero', projectCode: 'PRY-PRUEBA', columnas: {} })]);
  const filas = await lista();
  const de = (id: string) => filas.find((f) => f.id === id)!;
  assert.deepEqual([de(soloTraidas).respuestasReales, de(soloTraidas).respuestasQueImpidenBorrar], [3, 0]);
  assert.deepEqual([de(mixto).respuestasReales, de(mixto).respuestasQueImpidenBorrar], [4, 1]);
  assert.deepEqual([de(conTablero).respuestasReales, de(conTablero).respuestasQueImpidenBorrar], [3, 3]);
  assert.deepEqual([de(origen).respuestasReales, de(origen).respuestasQueImpidenBorrar], [1, 1]);
});

await prueba('sin sesión no deja borrar nada', async () => {
  const f = await filtro('Sin sesión');
  await assert.rejects(() => deleteFormulario.run({ formularioId: f }, { user: null } as any), (e: Error) => /Sesión requerida/.test(e.message));
  assert.equal(await existe(f), true);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
