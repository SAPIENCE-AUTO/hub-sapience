// Pruebas de «elegir entre las imágenes» (rondas de Swipe): alta en un clic, lo que ve el celular, la elección única por
// persona que se puede cambiar, la ronda cerrada, los conteos en vivo y que, si la columna aún no existe en la base real
// (el despliegue llegó antes que add-swipe-tables.ts), Swipe sigue funcionando como siempre. Corridas de verdad contra una
// base en memoria (PGlite). Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-swipe-duelo.ts
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { ZiteError } from '../compat/errors';
import createSwipeCapitulo from '../../src/api/createSwipeCapitulo';
import duplicateSwipeCapitulo from '../../src/api/duplicateSwipeCapitulo';
import getSwipeCapitulo from '../../src/api/getSwipeCapitulo';
import getSwipeEstado from '../../src/api/getSwipeEstado';
import getSwipeIdeas from '../../src/api/getSwipeIdeas';
import getSwipeResultados from '../../src/api/getSwipeResultados';
import getSwipeSesionDetail from '../../src/api/getSwipeSesionDetail';
import setSwipeCapituloEstado from '../../src/api/setSwipeCapituloEstado';
import setSwipeCapituloModo from '../../src/api/setSwipeCapituloModo';
import submitSwipeEleccion from '../../src/api/submitSwipeEleccion';
import submitSwipeVotos from '../../src/api/submitSwipeVotos';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n').slice(0, 14).join('\n')}`);
  }
}

const pg = await PGlite.create();
// Los endpoints hablan con `pool.query`; aquí contestan desde la base en memoria (rowCount como lo da `pg`).
(pool as any).query = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};

// Mismas tablas y restricciones que add-swipe-tables.ts (lo que importa aquí: la llave única de los votos y `modo`).
await pg.exec(`
  create table swipe_sesiones (
    id uuid primary key default gen_random_uuid(), codigo text unique not null, nombre text not null, cliente text,
    estado text not null default 'borrador', capitulo_activo_id uuid, max_super_likes int not null default 3
  );
  create table swipe_capitulos (
    id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id) on delete cascade,
    nombre text not null, descripcion text, orden int not null, estado text not null default 'bloqueado',
    aleatorio boolean not null default false,
    modo text not null default 'swipe' constraint swipe_capitulos_modo_chk check (modo in ('swipe', 'duelo'))
  );
  create table swipe_ideas (
    id uuid primary key default gen_random_uuid(), capitulo_id uuid not null references swipe_capitulos(id) on delete cascade,
    titulo text not null, descripcion text, imagen_url text, orden int not null
  );
  create table swipe_participantes (
    id uuid primary key default gen_random_uuid(), sesion_id uuid not null references swipe_sesiones(id) on delete cascade,
    alias text not null, device_token text not null, unique (sesion_id, device_token)
  );
  create table swipe_votos (
    id uuid primary key default gen_random_uuid(), idea_id uuid not null references swipe_ideas(id) on delete cascade,
    participante_id uuid not null references swipe_participantes(id) on delete cascade,
    valor text not null check (valor in ('potencial', 'descarte', 'super')), ms_decision int,
    created_at timestamptz not null default now(), unique (idea_id, participante_id)
  );
`);

const editor = { user: { id: 'u1', email: 'prueba@ejemplo.test' } };
const publico = { user: null };
const SIN_ID = '00000000-0000-0000-0000-000000000000';

const sesion = (await pg.query<{ id: string }>(`insert into swipe_sesiones (codigo, nombre, cliente) values ('RONDA1', 'Sesión de prueba', 'Cliente de prueba') returning id`)).rows[0].id;
const otraSesion = (await pg.query<{ id: string }>(`insert into swipe_sesiones (codigo, nombre) values ('OTRA01', 'Otra sesión') returning id`)).rows[0].id;
async function persona(sesionId: string, alias: string) {
  return (await pg.query<{ id: string }>(`insert into swipe_participantes (sesion_id, alias, device_token) values ($1, $2, $3) returning id`, [sesionId, alias, `tok-${alias}`])).rows[0].id;
}
async function ideasDe(capituloId: string, cuantas: number) {
  const ids: string[] = [];
  for (let i = 1; i <= cuantas; i++) {
    ids.push((await pg.query<{ id: string }>(`insert into swipe_ideas (capitulo_id, titulo, imagen_url, orden) values ($1, $2, $3, $4) returning id`, [capituloId, `Imagen ${i}`, `https://ejemplo.test/${i}.png`, i])).rows[0].id);
  }
  return ids;
}
const votosDe = async (personaId: string, capituloId: string) =>
  (await pg.query<{ idea_id: string; valor: string }>(
    `select v.idea_id, v.valor from swipe_votos v join swipe_ideas i on i.id = v.idea_id where i.capitulo_id = $1 and v.participante_id = $2`,
    [capituloId, personaId])).rows;
const totalVotos = async (capituloId: string) =>
  Number((await pg.query<{ n: number }>(`select count(*)::int as n from swipe_votos v join swipe_ideas i on i.id = v.idea_id where i.capitulo_id = $1`, [capituloId])).rows[0].n);

// ── alta y modo ───────────────────────────────────────────────────────────────
let ronda1 = '';
let cartas = '';
await prueba('crear una ronda: queda en modo duelo; un capítulo normal sigue siendo de cartas', async () => {
  ronda1 = ((await createSwipeCapitulo.run({ sesionId: sesion, nombre: 'Ronda 1', descripcion: '¿Cuál responde más a Mental Clarity?', modo: 'duelo' }, editor)) as any).id;
  cartas = ((await createSwipeCapitulo.run({ sesionId: sesion, nombre: 'Cartas' }, editor)) as any).id;
  const modos = (await pg.query<{ nombre: string; modo: string }>(`select nombre, modo from swipe_capitulos order by orden`)).rows;
  assert.deepEqual(modos.map((m) => [m.nombre, m.modo]), [['Ronda 1', 'duelo'], ['Cartas', 'swipe']]);
});

const [a, b] = await ideasDe(ronda1, 2);

await prueba('el detalle de la sesión dice cuáles capítulos son rondas', async () => {
  const d: any = await getSwipeSesionDetail.run({ sesionId: sesion }, editor);
  assert.deepEqual(d.capitulos.map((c: any) => [c.nombre, c.modo]), [['Ronda 1', 'duelo'], ['Cartas', 'swipe']]);
});
await prueba('el editor ve el modo del capítulo', async () => {
  assert.equal(((await getSwipeIdeas.run({ capituloId: ronda1 }, editor)) as any).modo, 'duelo');
  assert.equal(((await getSwipeIdeas.run({ capituloId: cartas }, editor)) as any).modo, 'swipe');
});
await prueba('cambiar el modo y volver; capítulo inexistente = no encontrado; sin sesión no se puede', async () => {
  assert.deepEqual(await setSwipeCapituloModo.run({ capituloId: cartas, modo: 'duelo' }, editor), { ok: true });
  assert.equal(((await getSwipeIdeas.run({ capituloId: cartas }, editor)) as any).modo, 'duelo');
  await setSwipeCapituloModo.run({ capituloId: cartas, modo: 'swipe' }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: cartas }, editor)) as any).modo, 'swipe');
  await assert.rejects(() => setSwipeCapituloModo.run({ capituloId: SIN_ID, modo: 'duelo' }, editor), (e: unknown) => e instanceof ZiteError && e.code === 'NOT_FOUND');
  await assert.rejects(() => setSwipeCapituloModo.run({ capituloId: cartas, modo: 'duelo' }, publico), (e: unknown) => e instanceof ZiteError && e.code === 'UNAUTHORIZED');
});
await prueba('duplicar una ronda la deja como ronda (y un capítulo de cartas como cartas)', async () => {
  const copiaRonda: any = await duplicateSwipeCapitulo.run({ capituloId: ronda1 }, editor);
  const copiaCartas: any = await duplicateSwipeCapitulo.run({ capituloId: cartas }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaRonda.id }, editor)) as any).modo, 'duelo');
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaCartas.id }, editor)) as any).modo, 'swipe');
  assert.equal(((await getSwipeIdeas.run({ capituloId: copiaRonda.id }, editor)) as any).ideas.length, 2);
});

// ── lo que ve el celular ──────────────────────────────────────────────────────
const ana = await persona(sesion, 'ana');
const beto = await persona(sesion, 'beto');
const cris = await persona(sesion, 'cris');
const deOtraSesion = await persona(otraSesion, 'intrusa');

await prueba('ronda cerrada: el celular no ve nada; al abrirla, estado trae el modo y la ronda activa', async () => {
  assert.equal(((await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico)) as any).found, false);
  assert.equal(((await getSwipeEstado.run({ codigo: 'RONDA1' }, publico)) as any).capituloActivo, null);
  await setSwipeCapituloEstado.run({ capituloId: ronda1, estado: 'abierto' }, editor);
  const e: any = await getSwipeEstado.run({ codigo: 'RONDA1' }, publico);
  assert.equal(e.capituloActivo.id, ronda1);
  assert.equal(e.capituloActivo.modo, 'duelo');
  assert.equal(e.capituloActivo.totalIdeas, 2);
});
await prueba('una ronda de cartas abierta se anuncia como cartas', async () => {
  await setSwipeCapituloEstado.run({ capituloId: cartas, estado: 'abierto' }, editor);
  assert.equal(((await getSwipeEstado.run({ codigo: 'RONDA1' }, publico)) as any).capituloActivo.modo, 'swipe');
  await setSwipeCapituloEstado.run({ capituloId: ronda1, estado: 'abierto' }, editor);
});
await prueba('el celular recibe las imágenes en su orden aunque el capítulo tenga orden aleatorio', async () => {
  await pg.query(`update swipe_capitulos set aleatorio = true where id = $1`, [ronda1]);
  for (let i = 0; i < 12; i++) {
    const r: any = await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico);
    assert.equal(r.modo, 'duelo');
    assert.deepEqual(r.ideas.map((x: any) => x.id), [a, b]);
    assert.equal(r.eleccionIdeaId, undefined);
  }
  await pg.query(`update swipe_capitulos set aleatorio = false where id = $1`, [ronda1]);
});

// ── elegir, cambiar, y los conteos ────────────────────────────────────────────
await prueba('elegir una imagen deja UN voto de valor potencial en esa imagen', async () => {
  assert.deepEqual(await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a, msDecision: 1200 }, publico), { ok: true });
  assert.deepEqual(await votosDe(ana, ronda1), [{ idea_id: a, valor: 'potencial' }]);
});
await prueba('el celular, al volver a cargar la ronda, recibe su elección marcada', async () => {
  assert.equal(((await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico)) as any).eleccionIdeaId, a);
  assert.equal(((await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: beto }, publico)) as any).eleccionIdeaId, undefined);
});
await prueba('elegir la misma otra vez no duplica nada', async () => {
  await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico);
  await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico);
  assert.equal((await votosDe(ana, ronda1)).length, 1);
});
await prueba('cambiar de elección: el voto se MUEVE, no se suma', async () => {
  await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: b }, publico);
  assert.deepEqual(await votosDe(ana, ronda1), [{ idea_id: b, valor: 'potencial' }]);
  assert.equal(((await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico)) as any).eleccionIdeaId, b);
  await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico);
  assert.deepEqual(await votosDe(ana, ronda1), [{ idea_id: a, valor: 'potencial' }]);
});
await prueba('lo que una persona cambia no toca el voto de las demás', async () => {
  await submitSwipeEleccion.run({ participanteId: beto, capituloId: ronda1, ideaId: b }, publico);
  await submitSwipeEleccion.run({ participanteId: cris, capituloId: ronda1, ideaId: b }, publico);
  await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: b }, publico);
  assert.deepEqual(await votosDe(beto, ronda1), [{ idea_id: b, valor: 'potencial' }]);
  assert.deepEqual(await votosDe(cris, ronda1), [{ idea_id: b, valor: 'potencial' }]);
  assert.equal(await totalVotos(ronda1), 3);
});
// Los resultados salen ordenados por puntaje (el de arriba es el que va ganando), no por el orden de las imágenes: por eso
// la pantalla proyectada toma el orden de getSwipeIdeas y de los resultados solo toma los votos, buscándolos por id.
const votosPorImagen = (r: any) => Object.fromEntries(r.ideas.map((x: any) => [x.id, x.potencial]));
await prueba('los resultados en vivo: cada imagen con su número de votos', async () => {
  const r: any = await getSwipeResultados.run({ capituloId: ronda1 }, editor);
  assert.deepEqual(votosPorImagen(r), { [a]: 0, [b]: 3 });
  assert.equal(r.totalParticipantesVotaron, 3);
  await submitSwipeEleccion.run({ participanteId: cris, capituloId: ronda1, ideaId: a }, publico);
  const r2: any = await getSwipeResultados.run({ capituloId: ronda1 }, editor);
  assert.deepEqual(votosPorImagen(r2), { [a]: 1, [b]: 2 });
  assert.equal(r2.totalParticipantesVotaron, 3);
});
await prueba('el orden de las imágenes para proyectar (A, B) lo da getSwipeIdeas, es el del celular y no cambia con los votos', async () => {
  const orden = async () => ((await getSwipeIdeas.run({ capituloId: ronda1 }, editor)) as any).ideas.map((x: any) => x.id);
  assert.deepEqual(await orden(), [a, b]);
  const celular: any = await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico);
  assert.deepEqual(celular.ideas.map((x: any) => x.id), [a, b], 'el celular y la pantalla usan el mismo orden');
  // Los resultados solo sirven para CONTAR: en una ronda todos los votos son «potencial», así que su puntaje no distingue
  // quién va ganando y su orden no significa nada. Cambia quién va ganando y las imágenes siguen en su lugar.
  // Hasta aquí: cris en «a»; ana y beto en «b». Beto pasa a «a» y las dos quedan 2 a 1.
  await submitSwipeEleccion.run({ participanteId: beto, capituloId: ronda1, ideaId: a }, publico);
  assert.deepEqual(votosPorImagen((await getSwipeResultados.run({ capituloId: ronda1 }, editor)) as any), { [a]: 2, [b]: 1 });
  assert.deepEqual(await orden(), [a, b]);
  await submitSwipeEleccion.run({ participanteId: beto, capituloId: ronda1, ideaId: b }, publico); // como estaba
});
await prueba('la hora del voto cambia cuando la persona cambia de elección', async () => {
  const antes = (await pg.query<{ t: string }>(`select created_at::text as t from swipe_votos where participante_id = $1`, [cris])).rows[0].t;
  await pg.query(`select pg_sleep(0.05)`);
  await submitSwipeEleccion.run({ participanteId: cris, capituloId: ronda1, ideaId: b }, publico);
  const despues = (await pg.query<{ t: string }>(`select created_at::text as t from swipe_votos where participante_id = $1`, [cris])).rows[0].t;
  assert.notEqual(antes, despues);
});

// ── lo que NO se acepta ───────────────────────────────────────────────────────
await prueba('una imagen de otro capítulo, una persona de otra sesión o ids que no existen: no válida y no se guarda nada', async () => {
  const [ajena] = await ideasDe(cartas, 1);
  const antes = await totalVotos(ronda1);
  for (const datos of [
    { participanteId: ana, capituloId: ronda1, ideaId: ajena },
    { participanteId: deOtraSesion, capituloId: ronda1, ideaId: a },
    { participanteId: SIN_ID, capituloId: ronda1, ideaId: a },
    { participanteId: ana, capituloId: ronda1, ideaId: SIN_ID },
    { participanteId: ana, capituloId: SIN_ID, ideaId: a },
  ]) {
    assert.deepEqual(await submitSwipeEleccion.run(datos, publico), { ok: false, motivo: 'no_valida' });
  }
  assert.equal(await totalVotos(ronda1), antes);
  assert.equal(await totalVotos(cartas), 0);
});
await prueba('en un capítulo de cartas no se puede elegir (no borra los votos de las cartas)', async () => {
  const [carta1, carta2] = (await pg.query<{ id: string }>(`select id from swipe_ideas where capitulo_id = $1 order by orden`, [cartas])).rows.map((r) => r.id);
  const carta2b = carta2 ?? (await ideasDe(cartas, 1))[0];
  await submitSwipeVotos.run({ participanteId: ana, votos: [{ ideaId: carta1, valor: 'potencial' }, { ideaId: carta2b, valor: 'descarte' }] }, publico);
  await setSwipeCapituloEstado.run({ capituloId: cartas, estado: 'abierto' }, editor);
  assert.deepEqual(await submitSwipeEleccion.run({ participanteId: ana, capituloId: cartas, ideaId: carta1 }, publico), { ok: false, motivo: 'no_valida' });
  assert.equal((await votosDe(ana, cartas)).length, 2);
  await setSwipeCapituloEstado.run({ capituloId: ronda1, estado: 'abierto' }, editor);
});
await prueba('ronda cerrada: se avisa y el voto que ya estaba queda como estaba', async () => {
  const antes = await votosDe(ana, ronda1);
  await setSwipeCapituloEstado.run({ capituloId: ronda1, estado: 'cerrado' }, editor);
  assert.deepEqual(await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico), { ok: false, motivo: 'ronda_cerrada' });
  assert.deepEqual(await votosDe(ana, ronda1), antes);
  // Una ronda que el facilitador aún no abre (bloqueada) tampoco recibe votos.
  await pg.query(`update swipe_capitulos set estado = 'bloqueado' where id = $1`, [ronda1]);
  assert.deepEqual(await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico), { ok: false, motivo: 'ronda_cerrada' });
  assert.deepEqual(await votosDe(ana, ronda1), antes);
  // Y al reabrirla, quien ya había votado recibe su elección marcada y puede cambiarla.
  await setSwipeCapituloEstado.run({ capituloId: ronda1, estado: 'abierto' }, editor);
  assert.equal(((await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico)) as any).eleccionIdeaId, antes[0].idea_id);
  assert.deepEqual(await submitSwipeEleccion.run({ participanteId: ana, capituloId: ronda1, ideaId: a }, publico), { ok: true });
});
// ── mucha gente a la vez ──────────────────────────────────────────────────────
await prueba('60 personas votando a la vez, y 15 de ellas cambiando varias veces: un solo voto por persona y el conteo cuadra', async () => {
  const gente: string[] = [];
  for (let i = 0; i < 60; i++) gente.push(await persona(sesion, `gente${i}`));
  const finalDe = (i: number) => (i % 3 === 0 ? a : b);
  const tareas: Array<Promise<unknown>> = [];
  gente.forEach((p, i) => {
    tareas.push(submitSwipeEleccion.run({ participanteId: p, capituloId: ronda1, ideaId: i % 2 ? a : b }, publico));
    if (i < 15) {
      tareas.push(submitSwipeEleccion.run({ participanteId: p, capituloId: ronda1, ideaId: a }, publico));
      tareas.push(submitSwipeEleccion.run({ participanteId: p, capituloId: ronda1, ideaId: b }, publico));
    }
  });
  await Promise.all(tareas);
  // Ahora el voto final de cada una, en orden, y se comprueba que manda el último.
  for (let i = 0; i < gente.length; i++) await submitSwipeEleccion.run({ participanteId: gente[i], capituloId: ronda1, ideaId: finalDe(i) }, publico);
  for (const p of gente) assert.equal((await votosDe(p, ronda1)).length, 1);
  // De las 60: i % 3 === 0 queda en «a» (20) y el resto en «b» (40). De las tres de antes: ana quedó en «a»; beto y cris, en «b».
  const r: any = await getSwipeResultados.run({ capituloId: ronda1 }, editor);
  assert.deepEqual(votosPorImagen(r), { [a]: 21, [b]: 42 });
  assert.equal(r.totalParticipantesVotaron, 63, 'cada persona cuenta una sola vez');
});

// ── la columna todavía no existe (despliegue antes que la migración) ──────────
await pg.exec(`alter table swipe_capitulos drop column modo`);
await prueba('sin la columna: el celular recibe sus ideas y el estado, sin error (todo como cartas)', async () => {
  const r: any = await getSwipeCapitulo.run({ capituloId: ronda1, participanteId: ana }, publico);
  assert.equal(r.found, true);
  assert.equal(r.modo, 'swipe');
  assert.equal(r.ideas.length, 2);
  const e: any = await getSwipeEstado.run({ codigo: 'RONDA1' }, publico);
  assert.equal(e.capituloActivo.modo, 'swipe');
});
await prueba('sin la columna: el tablero y el editor funcionan', async () => {
  const d: any = await getSwipeSesionDetail.run({ sesionId: sesion }, editor);
  assert.ok(d.capitulos.length >= 2);
  assert.ok(d.capitulos.every((c: any) => c.modo === 'swipe'));
  assert.equal(((await getSwipeIdeas.run({ capituloId: ronda1 }, editor)) as any).modo, 'swipe');
});
await prueba('sin la columna: crear y duplicar un capítulo de cartas sigue funcionando', async () => {
  const nuevo: any = await createSwipeCapitulo.run({ sesionId: sesion, nombre: 'Sin columna' }, editor);
  assert.ok(nuevo.id);
  const copia: any = await duplicateSwipeCapitulo.run({ capituloId: ronda1 }, editor);
  assert.equal(((await getSwipeIdeas.run({ capituloId: copia.id }, editor)) as any).ideas.length, 2);
});
await prueba('sin la columna: cambiar el modo dice qué falta en vez de un error de base de datos', async () => {
  await assert.rejects(
    () => setSwipeCapituloModo.run({ capituloId: ronda1, modo: 'duelo' }, editor),
    (e: unknown) => e instanceof ZiteError && /add-swipe-tables/.test(e.message),
  );
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
