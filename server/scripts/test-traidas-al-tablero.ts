// Pruebas de la carga automática de las personas traídas de un filtro anterior: al vincular un tablero (o crear uno nuevo para el filtro) llegan solas al tablero, por tandas y en
// segundo plano, sin repetirse, sin volver a pasar a quien el equipo quitó y retomando lo que falte al volver a vincular. Contra una base en memoria (PGlite) con el esquema completo
// del Hub y las tablas de filtros mínimas. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-traidas-al-tablero.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import { traerRespuestas } from '../../src/serverUtils/formularios/traer';
import { cargarTraidasAlTablero, traidasPorCargar } from '../../src/serverUtils/formularios/traidasAlTablero';
import vincularFormularioTablero from '../../src/api/vincularFormularioTablero';
import crearTableroParaFormulario from '../../src/api/crearTableroParaFormulario';

// Sin Ably: las cargas avisan a quien tiene el tablero abierto, y aquí no hay a quién.
delete process.env.ZITE_ABLY_API_KEY;
const avisar = console.warn.bind(console);
console.warn = (...a: unknown[]) => { if (!String(a[0]).startsWith('[ably]')) avisar(...a); };

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
// El esquema completo del Hub (como server/test.ts) y las tablas de filtros mínimas que usa la carga.
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
await pg.exec(`
  create table formularios (
    id uuid primary key default gen_random_uuid(), proyecto_id uuid, codigo text unique not null, titulo text not null, plantilla text,
    definicion jsonb not null, cambios jsonb, vinculo jsonb, generador jsonb, estado text not null default 'borrador', created_by text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table formulario_respuestas (
    id uuid primary key default gen_random_uuid(), formulario_id uuid not null references formularios(id) on delete cascade,
    created_at timestamptz not null default now(), es_prueba boolean not null, respuestas jsonb not null, resultado jsonb not null,
    califica boolean not null default false, nombre text, telefono text, device_token text, duracion_seg int
  );
  create table muestras (
    id uuid primary key default gen_random_uuid(), proyecto_id uuid not null unique, definicion jsonb not null default '{"actividades": []}'::jsonb,
    version int not null default 1, tablero_id text, calendario_id text, created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
`);

const ctx = { user: { id: '00000000-0000-0000-0000-000000000001', email: 'analista@ejemplo.test' } } as any;
const DEF = PLANTILLAS.prueba_tipos.definicion;
const CODIGO = 'PRY-PRUEBA';
const { rows: [{ id: proyectoId }] } = await pg.query<{ id: string }>(`insert into projects (project_code, full_name) values ($1, 'Proyecto de prueba') returning id`, [CODIGO]);
let secuencia = 0;
const tablero = async (nombre: string): Promise<string> => (await pg.query<{ id: string }>(
  `insert into boards (board_name, project_code, board_type) values ($1, $2, 'recruitment') returning id`, [nombre, CODIGO])).rows[0].id;
const filtro = async (titulo: string, estado = 'en_vivo'): Promise<string> => (await pg.query<{ id: string }>(
  `insert into formularios (codigo, titulo, estado, definicion, proyecto_id) values ($1, $2, $3, $4::jsonb, $5) returning id`,
  [`c${++secuencia}`, titulo, estado, JSON.stringify(DEF), proyectoId])).rows[0].id;
/** Un filtro con `cuantas` personas que lo contestaron (y una más que no aceptó el aviso), y otro copiado de él trayéndolas. */
async function filtroConTraidas(titulo: string, cuantas: number): Promise<{ origen: string; copia: string; traidas: number }> {
  const origen = await filtro(`${titulo} (origen)`);
  for (let i = 1; i <= cuantas; i++) {
    await pg.query(
      `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono) values ($1, false, $2::jsonb, '{"califica": true}'::jsonb, true, $3, $4)`,
      [origen, JSON.stringify({ nombre: `Persona ${i}`, celular: `55${String(secuencia).padStart(2, '0')}${String(i).padStart(6, '0')}` }), `Persona ${i}`, `55${String(secuencia).padStart(2, '0')}${String(i).padStart(6, '0')}`],
    );
  }
  await pg.query(
    `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono) values ($1, false, '{}'::jsonb, '{"califica": false, "terminado": {"clave": "hub_aviso", "motivo": "No aceptó"}}'::jsonb, false, 'Sin aviso', '5599999999')`,
    [origen],
  );
  const copia = await filtro(titulo, 'prueba');
  const traidas = (await traerRespuestas(origen, copia)).length;
  return { origen, copia, traidas };
}
const filasVivas = async (boardId: string) => Number((await pg.query<{ n: number }>(
  `select count(*)::int as n from recruitment_rows where board_id = $1 and (deleted_at is null or deleted_at = '')`, [boardId])).rows[0].n);
const conMarcaDeTablero = async (formularioId: string) => Number((await pg.query<{ n: number }>(
  `select count(*)::int as n from formulario_respuestas where formulario_id = $1 and (resultado->'tablero'->>'fila') is not null`, [formularioId])).rows[0].n);
const vincular = (formularioId: string, boardId: string) => vincularFormularioTablero.run({ formularioId, boardId }, ctx) as Promise<{ ok: boolean; columnasCreadas: number; traidasPorCargar?: number }>;

/** Espera a que la carga que arrancó al vincular (sin que la pida la prueba) llegue a `cuantas` filas; falla si no llega. */
const esperarFilas = async (boardId: string, cuantas: number) => {
  const limite = Date.now() + Number(process.env.ESPERA_MAX_SEG ?? 120) * 1000;
  while (Date.now() < limite) {
    if ((await filasVivas(boardId)) >= cuantas) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`el tablero no llegó a ${cuantas} filas (tiene ${await filasVivas(boardId)})`);
};
/** Ya con las filas, espera lo que le queda a la carga (poner al día las columnas del Hub): se cuelga de ella si sigue corriendo; si ya terminó, no encuentra pendientes. */
const terminarCarga = (formularioId: string) => cargarTraidasAlTablero(formularioId);

const A = await tablero('Tablero A');
const B = await tablero('Tablero B');
const MUCHAS = 95; // tres tandas de 40

const { copia, traidas } = await filtroConTraidas('Filtro nuevo con traídas', MUCHAS);

await prueba('el filtro copiado trae a todas las personas menos a quien no aceptó el aviso', () => {
  assert.equal(traidas, MUCHAS);
});

await prueba('antes de vincular un tablero, ninguna está en él y todas están por cargar', async () => {
  assert.equal((await traidasPorCargar(copia, A)).length, MUCHAS);
  assert.equal(await filasVivas(A), 0);
});

await prueba('al vincular el tablero avisa cuántas va a cargar y responde sin esperar a que terminen', async () => {
  const r = await vincular(copia, A);
  assert.equal(r.ok, true);
  assert.equal(r.traidasPorCargar, MUCHAS);
  assert.ok(r.columnasCreadas > 0);
});

await prueba('llegan todas al tablero, una fila por persona y como «Pendiente», sin repetirse', async () => {
  await esperarFilas(A, MUCHAS); // la carga la arrancó el vínculo: la prueba no la pide
  await terminarCarga(copia);
  assert.equal(await filasVivas(A), MUCHAS);
  const { rows } = await pg.query<{ status: string; hub: boolean; distintas: number }>(
    `select min(status) as status, bool_and(source_form like 'Formulario Hub · %') as hub, count(distinct split_part(source_form, '|', 2))::int as distintas
     from recruitment_rows where board_id = $1`, [A]);
  assert.deepEqual([rows[0].status, rows[0].hub, rows[0].distintas], ['Pendiente', true, MUCHAS]);
});

await prueba('al final se pusieron al día las columnas del Hub de todas (cada respuesta quedó ligada a su fila)', async () => {
  assert.equal(await conMarcaDeTablero(copia), MUCHAS);
});

await prueba('quien no aceptó el aviso no llega al tablero', async () => {
  const { rows } = await pg.query(`select 1 from recruitment_rows where board_id = $1 and participant_name = 'Sin aviso'`, [A]);
  assert.equal(rows.length, 0);
});

await prueba('volver a vincular el mismo tablero no repite a nadie', async () => {
  const r = await vincular(copia, A);
  assert.equal(r.traidasPorCargar, 0);
  await terminarCarga(copia);
  assert.equal(await filasVivas(A), MUCHAS);
});

await prueba('a quien el equipo quitó del tablero no se le vuelve a pasar solo al volver a vincular', async () => {
  await pg.query(`update recruitment_rows set deleted_at = now()::text where id = (select id from recruitment_rows where board_id = $1 limit 1)`, [A]);
  assert.equal(await filasVivas(A), MUCHAS - 1);
  const r = await vincular(copia, A);
  assert.equal(r.traidasPorCargar, 0);
  await terminarCarga(copia);
  assert.equal(await filasVivas(A), MUCHAS - 1);
});

await prueba('si la carga se cortó a medias, volver a vincular retoma solo lo que falta', async () => {
  const { copia: otra } = await filtroConTraidas('Filtro cortado a medias', 30);
  const tableroC = await tablero('Tablero C');
  await vincular(otra, tableroC);
  await esperarFilas(tableroC, 30);
  await terminarCarga(otra);
  assert.equal(await filasVivas(tableroC), 30);
  // Se simula el corte: desaparecen las últimas 10 filas del tablero (nadie las quitó, solo no llegaron).
  await pg.query(`delete from cell_values where row_id in (select id::text from recruitment_rows where board_id = $1 order by created_at desc limit 10)`, [tableroC]);
  await pg.query(`delete from recruitment_rows where id in (select id from recruitment_rows where board_id = $1 order by created_at desc limit 10)`, [tableroC]);
  assert.equal(await filasVivas(tableroC), 20);
  const r = await vincular(otra, tableroC);
  assert.equal(r.traidasPorCargar, 10);
  await esperarFilas(tableroC, 30);
  await terminarCarga(otra);
  assert.equal(await filasVivas(tableroC), 30);
});

await prueba('al cambiar a otro tablero, ese también recibe a todas; el anterior se queda como estaba', async () => {
  const r = await vincular(copia, B);
  assert.equal(r.traidasPorCargar, MUCHAS);
  await esperarFilas(B, MUCHAS);
  await terminarCarga(copia);
  assert.equal(await filasVivas(B), MUCHAS);
  assert.equal(await filasVivas(A), MUCHAS - 1);
});

await prueba('crear un tablero nuevo para el filtro también las carga', async () => {
  const { copia: nuevo } = await filtroConTraidas('Filtro con tablero nuevo', 3);
  const r = await crearTableroParaFormulario.run({ formularioId: nuevo, nombre: 'Tablero creado' }, ctx) as { id: string; traidasPorCargar?: number };
  assert.equal(r.traidasPorCargar, 3);
  await esperarFilas(r.id, 3);
  await terminarCarga(nuevo);
  assert.equal(await filasVivas(r.id), 3);
});

await prueba('dos cargas al mismo tiempo no repiten filas: la segunda se cuelga de la primera', async () => {
  const { copia: doble } = await filtroConTraidas('Filtro con dos cargas', 45);
  const tableroD = await tablero('Tablero D');
  await vincular(doble, tableroD);
  const [x, y] = await Promise.all([cargarTraidasAlTablero(doble), cargarTraidasAlTablero(doble)]);
  assert.equal(x, y);
  assert.equal(await filasVivas(tableroD), 45);
});

await prueba('un filtro sin personas traídas no carga nada al vincular', async () => {
  const solo = await filtro('Filtro sin traídas', 'prueba');
  await pg.query(
    `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica) values ($1, true, '{}'::jsonb, '{"califica": true}'::jsonb, true)`, [solo]);
  const tableroE = await tablero('Tablero E');
  const r = await vincular(solo, tableroE);
  assert.equal(r.traidasPorCargar, 0);
  assert.equal(await cargarTraidasAlTablero(solo), 0);
  assert.equal(await filasVivas(tableroE), 0);
});

await prueba('sin tablero vinculado no hace nada', async () => {
  const sinTablero = await filtro('Sin tablero', 'prueba');
  assert.equal(await cargarTraidasAlTablero(sinTablero), 0);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
