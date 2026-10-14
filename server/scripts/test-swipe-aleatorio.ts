// Pruebas del orden aleatorio de Swipe: el barajado y los endpoints que lo usan, corridos de verdad contra una base en
// memoria (PGlite) con las tablas de Swipe. También prueba que, si la columna todavía no existe en la base real (el
// despliegue llegó antes que add-swipe-tables.ts), el participante sigue recibiendo sus ideas. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-swipe-aleatorio.ts
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import { barajar } from '../../src/lib/swipe/orden';
import getSwipeCapitulo from '../../src/api/getSwipeCapitulo';
import getSwipeIdeas from '../../src/api/getSwipeIdeas';
import setSwipeCapituloAleatorio from '../../src/api/setSwipeCapituloAleatorio';
import duplicateSwipeCapitulo from '../../src/api/duplicateSwipeCapitulo';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// Azar repetible: así una prueba de distribución no puede fallar «de vez en cuando».
function mulberry32(semilla: number) {
  return () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── barajar ──────────────────────────────────────────────────────────────────
await prueba('barajar: conserva los mismos elementos y no toca la lista original', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const copia = [...original];
  const r = barajar(original);
  assert.deepEqual(original, copia);
  assert.deepEqual([...r].sort((a, b) => a - b), copia);
  assert.notEqual(r, original);
});
await prueba('barajar: con el azar fijado el resultado es el esperado (Fisher-Yates)', () => {
  assert.deepEqual(barajar([1, 2, 3, 4], () => 0), [2, 3, 4, 1]);
  assert.deepEqual(barajar([1, 2, 3, 4], () => 0.999999), [1, 2, 3, 4]);
});
await prueba('barajar: lista vacía y de un solo elemento', () => {
  assert.deepEqual(barajar([]), []);
  assert.deepEqual(barajar(['a']), ['a']);
});
await prueba('barajar: los 6 órdenes de 3 elementos salen parecido de seguido (sin sesgo)', () => {
  const azar = mulberry32(20261014);
  const cuenta = new Map<string, number>();
  for (let i = 0; i < 6000; i++) {
    const clave = barajar(['a', 'b', 'c'], azar).join('');
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }
  assert.equal(cuenta.size, 6);
  for (const [clave, veces] of cuenta) assert.ok(veces > 850 && veces < 1150, `${clave}: ${veces}`);
});

// ── endpoints, contra PGlite ─────────────────────────────────────────────────
const pg = await PGlite.create();
// Los endpoints hablan con `pool.query`; aquí contestan desde la base en memoria (rowCount como lo da `pg`).
(pool as any).query = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};

await pg.exec(`
  create table swipe_sesiones (
    id uuid primary key default gen_random_uuid(), codigo text unique not null, nombre text not null,
    estado text not null default 'activa', max_super_likes int not null default 3
  );
  create table swipe_capitulos (
    id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id) on delete cascade,
    nombre text not null, descripcion text, orden int not null, estado text not null default 'bloqueado',
    aleatorio boolean not null default false
  );
  create table swipe_ideas (
    id uuid primary key default gen_random_uuid(), capitulo_id uuid not null references swipe_capitulos(id) on delete cascade,
    titulo text not null, descripcion text, imagen_url text, orden int not null
  );
  create table swipe_participantes (id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id));
  create table swipe_votos (
    id uuid primary key default gen_random_uuid(), idea_id uuid not null references swipe_ideas(id) on delete cascade,
    participante_id uuid not null references swipe_participantes(id), valor text not null
  );
`);

const sesion = (await pg.query<{ id: string }>(`insert into swipe_sesiones (codigo, nombre) values ('PRUEBA1', 'Sesión de prueba') returning id`)).rows[0].id;
async function nuevoCapitulo(nombre: string, aleatorio: boolean, ideas = 12) {
  const id = (await pg.query<{ id: string }>(
    `insert into swipe_capitulos (sesion_id, nombre, orden, estado, aleatorio) values ($1, $2, 0, 'abierto', $3) returning id`,
    [sesion, nombre, aleatorio],
  )).rows[0].id;
  for (let i = 1; i <= ideas; i++) await pg.query(`insert into swipe_ideas (capitulo_id, titulo, orden) values ($1, $2, $3)`, [id, `Idea ${i}`, i]);
  return id;
}
const participante = { user: null };
const editor = { user: { id: 'u1', email: 'prueba@ejemplo.test' } };
const titulosDe = (r: any) => (r.ideas as Array<{ titulo: string }>).map((i) => i.titulo);
const enOrden = Array.from({ length: 12 }, (_, i) => `Idea ${i + 1}`);

const fijo = await nuevoCapitulo('Capítulo fijo', false);
const barajado = await nuevoCapitulo('Capítulo aleatorio', true);

await prueba('participante, capítulo sin aleatorio: las ideas llegan siempre en su orden', async () => {
  for (let i = 0; i < 3; i++) assert.deepEqual(titulosDe(await getSwipeCapitulo.run({ capituloId: fijo }, participante)), enOrden);
});
await prueba('participante, capítulo aleatorio: llegan todas, una vez cada una, y el orden cambia de uno a otro', async () => {
  const ordenes = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const r = await getSwipeCapitulo.run({ capituloId: barajado }, participante);
    const titulos = titulosDe(r);
    assert.deepEqual([...titulos].sort(), [...enOrden].sort());
    ordenes.add(titulos.join('|'));
  }
  assert.ok(ordenes.size > 1, 'siempre el mismo orden');
  assert.ok(![...ordenes].every((o) => o === enOrden.join('|')), 'nunca se barajó');
});
await prueba('participante: el campo orden de cada idea sigue siendo el guardado, y los super likes no cambian', async () => {
  const r: any = await getSwipeCapitulo.run({ capituloId: barajado }, participante);
  for (const idea of r.ideas) assert.equal(`Idea ${idea.orden}`, idea.titulo);
  assert.equal(r.superLikesRestantes, 3);
});
await prueba('editor: ve siempre el orden guardado y la casilla como está', async () => {
  const a: any = await getSwipeIdeas.run({ capituloId: barajado }, editor);
  const b: any = await getSwipeIdeas.run({ capituloId: fijo }, editor);
  assert.deepEqual(titulosDe(a), enOrden);
  assert.deepEqual([a.aleatorio, b.aleatorio], [true, false]);
});
await prueba('prender y apagar el orden aleatorio', async () => {
  assert.deepEqual(await setSwipeCapituloAleatorio.run({ capituloId: fijo, aleatorio: true }, editor), { ok: true });
  assert.equal(((await getSwipeIdeas.run({ capituloId: fijo }, editor)) as any).aleatorio, true);
  await setSwipeCapituloAleatorio.run({ capituloId: fijo, aleatorio: false }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: fijo }, editor)) as any).aleatorio, false);
});
await prueba('un capítulo que no existe da «no encontrado», y sin sesión no se puede cambiar', async () => {
  await assert.rejects(
    () => setSwipeCapituloAleatorio.run({ capituloId: '00000000-0000-0000-0000-000000000000', aleatorio: true }, editor),
    (e: unknown) => e instanceof ZiteError && e.code === 'NOT_FOUND',
  );
  await assert.rejects(
    () => setSwipeCapituloAleatorio.run({ capituloId: fijo, aleatorio: true }, participante),
    (e: unknown) => e instanceof ZiteError && e.code === 'UNAUTHORIZED',
  );
});
await prueba('duplicar un capítulo conserva el orden aleatorio (y no lo inventa)', async () => {
  const copiaA: any = await duplicateSwipeCapitulo.run({ capituloId: barajado }, editor);
  const copiaB: any = await duplicateSwipeCapitulo.run({ capituloId: fijo }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaA.id }, editor)) as any).aleatorio, true);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaB.id }, editor)) as any).aleatorio, false);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaA.id }, editor)) as any).ideas.length, 12);
});

// ── la columna todavía no existe (despliegue antes que la migración) ──────────
await pg.exec(`alter table swipe_capitulos drop column aleatorio`);
await prueba('sin la columna: el participante recibe sus ideas en su orden, sin error', async () => {
  assert.deepEqual(titulosDe(await getSwipeCapitulo.run({ capituloId: barajado }, participante)), enOrden);
});
await prueba('sin la columna: el editor funciona y la casilla sale apagada', async () => {
  const r: any = await getSwipeIdeas.run({ capituloId: barajado }, editor);
  assert.equal(r.aleatorio, false);
  assert.equal(r.ideas.length, 12);
});
await prueba('sin la columna: duplicar un capítulo sigue funcionando', async () => {
  const copia: any = await duplicateSwipeCapitulo.run({ capituloId: fijo }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copia.id }, editor)) as any).ideas.length, 12);
});
await prueba('sin la columna: cambiar la casilla dice qué falta en vez de un error de base de datos', async () => {
  await assert.rejects(
    () => setSwipeCapituloAleatorio.run({ capituloId: fijo, aleatorio: true }, editor),
    (e: unknown) => e instanceof ZiteError && /add-swipe-tables/.test(e.message),
  );
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
