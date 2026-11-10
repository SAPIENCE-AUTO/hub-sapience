// Pruebas de «Pasar a prueba» y los otros cambios de estado de un filtro, sobre todo el caso de un filtro nuevo creado desde uno anterior TRAYENDO sus respuestas:
// llegan marcadas como reales y el servidor no lo dejaba pasar a prueba («Este filtro ya tiene respuestas reales…»), y como Reclutar solo se abre fuera de borrador
// y «Abrir en vivo» solo sale en prueba, no había salida. Contra una base en memoria (PGlite) con las tablas de filtros mínimas. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-filtro-estado.ts
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { PLANTILLAS } from '../../src/lib/formularios/plantillas';
import { traerRespuestas } from '../../src/serverUtils/formularios/traer';
import setFormularioEstado from '../../src/api/setFormularioEstado';

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
    definicion jsonb not null, cambios jsonb, estado text not null default 'borrador', updated_at timestamptz not null default now()
  );
  create table formulario_respuestas (
    id uuid primary key default gen_random_uuid(), formulario_id uuid not null references formularios(id) on delete cascade,
    created_at timestamptz not null default now(), es_prueba boolean not null, respuestas jsonb not null, resultado jsonb not null,
    califica boolean not null default false, nombre text, telefono text, duracion_seg int
  );
`);

const ctx = { user: { id: '00000000-0000-0000-0000-000000000001', email: 'analista@ejemplo.test' } } as any;
const DEF = PLANTILLAS.prueba_tipos.definicion;
let secuencia = 0;
const filtro = async (titulo: string, estado: string, extra: { cambios?: unknown; proyecto?: string } = {}): Promise<string> => {
  const { rows: [f] } = await pg.query<{ id: string }>(
    `insert into formularios (codigo, titulo, estado, definicion, cambios, proyecto_id) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) returning id`,
    [`c${++secuencia}`, titulo, estado, JSON.stringify(DEF), extra.cambios ? JSON.stringify(extra.cambios) : null, extra.proyecto ?? null],
  );
  return f.id;
};
type Resp = { esPrueba?: boolean; traida?: boolean; clave?: string; telefono?: string; nombre?: string };
const respuesta = async (formularioId: string, r: Resp = {}) => {
  const resultado: Record<string, unknown> = { califica: true };
  if (r.traida) resultado.traida = { formularioId: 'otro', titulo: 'Filtro anterior', fecha: '2026-10-01T00:00:00.000Z' };
  if (r.clave) resultado.terminado = { clave: r.clave, motivo: 'No aceptó' };
  await pg.query(
    `insert into formulario_respuestas (formulario_id, es_prueba, respuestas, resultado, califica, nombre, telefono) values ($1, $2, '{}'::jsonb, $3::jsonb, true, $4, $5)`,
    [formularioId, r.esPrueba ?? false, JSON.stringify(resultado), r.nombre ?? 'Persona de prueba', r.telefono ?? null],
  );
};
const estadoDe = async (id: string) => (await pg.query<{ estado: string }>(`select estado from formularios where id = $1`, [id])).rows[0].estado;
const cambiar = (formularioId: string, estado: 'borrador' | 'prueba' | 'en_vivo' | 'cerrado') => setFormularioEstado.run({ formularioId, estado }, ctx);
const rechaza = async (formularioId: string, estado: 'borrador' | 'prueba') => {
  await assert.rejects(() => cambiar(formularioId, estado), (e: Error) => /ya tiene respuestas reales/.test(e.message));
};

// El caso de la queja: «Nuevo filtro» desde uno anterior, con la casilla de traer a quienes lo contestaron.
const origen = await filtro('Filtro anterior', 'en_vivo');
await respuesta(origen, { telefono: '5500000001', nombre: 'Ana de prueba' });
await respuesta(origen, { telefono: '5500000002', nombre: 'Beto de prueba' });
await respuesta(origen, { telefono: '5500000003', nombre: 'Cata de prueba', clave: 'hub_aviso' });
const copia = await filtro('Filtro nuevo, copia del anterior', 'borrador');
const traidas = await traerRespuestas(origen, copia);

await prueba('la copia recibe a quienes contestaron antes (menos a quien no aceptó el aviso), marcados como reales y como traídos', async () => {
  assert.equal(traidas.length, 2);
  const { rows } = await pg.query<{ es_prueba: boolean; traida: boolean }>(`select es_prueba, (resultado ? 'traida') as traida from formulario_respuestas where formulario_id = $1`, [copia]);
  assert.deepEqual(rows.map((r) => [r.es_prueba, r.traida]), [[false, true], [false, true]]);
  assert.equal(await estadoDe(copia), 'borrador');
});

await prueba('la copia en borrador con traídas SÍ pasa a prueba (antes: «Este filtro ya tiene respuestas reales…»)', async () => {
  await cambiar(copia, 'prueba');
  assert.equal(await estadoDe(copia), 'prueba');
});

await prueba('y de ahí se abre en vivo', async () => {
  await cambiar(copia, 'en_vivo');
  assert.equal(await estadoDe(copia), 'en_vivo');
});

await prueba('una copia en prueba con traídas puede volver a borrador (nadie contestó por su enlace)', async () => {
  const otra = await filtro('Otra copia', 'borrador');
  await respuesta(otra, { traida: true });
  await cambiar(otra, 'prueba');
  await cambiar(otra, 'borrador');
  assert.equal(await estadoDe(otra), 'borrador');
});

await prueba('un filtro en vivo con una respuesta real de un participante sigue sin poder volver a prueba ni a borrador', async () => {
  await respuesta(copia, { telefono: '5500000009', nombre: 'Persona real' });
  await rechaza(copia, 'prueba');
  await rechaza(copia, 'borrador');
  assert.equal(await estadoDe(copia), 'en_vivo');
});

await prueba('lo mismo si, ya cerrado, tiene traídas y una real: no regresa a prueba, solo se reabre en vivo', async () => {
  await cambiar(copia, 'cerrado');
  await rechaza(copia, 'prueba');
  await cambiar(copia, 'en_vivo');
  assert.equal(await estadoDe(copia), 'en_vivo');
});

await prueba('el filtro de origen, en vivo con respuestas reales, tampoco regresa a prueba', async () => {
  await rechaza(origen, 'prueba');
  await rechaza(origen, 'borrador');
});

await prueba('un filtro con solo respuestas de prueba cambia de estado como siempre', async () => {
  const f = await filtro('Solo pruebas', 'prueba');
  await respuesta(f, { esPrueba: true });
  await cambiar(f, 'borrador');
  await cambiar(f, 'prueba');
  assert.equal(await estadoDe(f), 'prueba');
});

await prueba('al pasar a prueba, lo que estaba sin publicar pasa a ser el filtro (como siempre)', async () => {
  const nuevoTexto = { ...DEF, tituloPublico: 'Título corregido' };
  const f = await filtro('Con cambios', 'borrador', { cambios: nuevoTexto });
  await cambiar(f, 'prueba');
  const { rows: [r] } = await pg.query<{ titulo: string; cambios: unknown }>(`select definicion->>'tituloPublico' as titulo, cambios from formularios where id = $1`, [f]);
  assert.deepEqual([r.titulo, r.cambios], ['Título corregido', null]);
});

await prueba('cerrar y abrir en vivo no preguntan por las respuestas', async () => {
  const f = await filtro('Para cerrar', 'en_vivo');
  await respuesta(f, { telefono: '5500000010' });
  await cambiar(f, 'cerrado');
  await cambiar(f, 'en_vivo');
  assert.equal(await estadoDe(f), 'en_vivo');
});

await prueba('un filtro que no existe avisa que no se encontró', async () => {
  await assert.rejects(() => cambiar('00000000-0000-0000-0000-0000000000aa', 'prueba'), (e: Error) => /No se encontró el formulario/.test(e.message));
});

await prueba('sin sesión no deja cambiar nada', async () => {
  await assert.rejects(() => setFormularioEstado.run({ formularioId: copia, estado: 'cerrado' }, { user: null } as any), (e: Error) => /Sesión requerida/.test(e.message));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
