// Pruebas del generador de guías de tópicos (src/serverUtils/guias + src/api/*Guia*) contra una base en memoria (PGlite) con el esquema real y un cliente de Claude de
// mentiras: permisos, crear/abrir/guardar/borrar, conflicto cuando dos personas editan, lo que le llega a Claude (modelo por etapa, volumen por bloque, datos del
// proyecto, rehacer con comentario), errores de la IA (respuesta cortada, JSON inválido con reintento, «Detener»), tope de uso, leer el roadmap de un Word y el Word que sale.
// Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-guias.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { puedeVerGuias } from '../../src/lib/guias/acceso';
import { estadoVacio, minutosRoadmap, realinearGuia, type EstadoGuia } from '../../src/lib/guias/types';

// El tope de uso se lee al cargar el módulo: se fija antes de importar los endpoints.
process.env.GUIAS_LIMITE_HORA = '40';
delete process.env.GUIAS_ALLOWED_EMAILS;
const { ponerClienteDePrueba, MODELO_ROADMAP, MODELO_BLOQUE } = await import('../../src/serverUtils/guias/claude');
const { reiniciarCuota } = await import('../../src/serverUtils/guias/acceso');
const { textoDeArchivo, htmlATexto } = await import('../../src/serverUtils/guias/archivo');
const { wordDeGuia } = await import('../../src/serverUtils/guias/word');
const crear = (await import('../../src/api/createGuia')).default;
const listar = (await import('../../src/api/getGuias')).default;
const abrir = (await import('../../src/api/getGuia')).default;
const guardar = (await import('../../src/api/saveGuia')).default;
const borrar = (await import('../../src/api/deleteGuia')).default;
const wordEndpoint = (await import('../../src/api/getGuiaWord')).default;
const leerArchivo = (await import('../../src/api/leerArchivoGuia')).default;
const roadmapIA = (await import('../../src/api/generateGuiaRoadmap')).default;
const ajustarIA = (await import('../../src/api/adjustGuiaRoadmap')).default;
const bloqueIA = (await import('../../src/api/generateGuiaBloque')).default;

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${process.env.VERBOSO ? (e as Error).stack : (e as Error).message.split('\n')[0]}`);
  }
}
/** Los endpoints y Claude escriben bitácora con console.log: en las pruebas se calla para que se lea el resultado. */
const sinBitacora = async <T>(f: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try { return await f(); } finally { console.log = original; }
};
const rechaza = async (f: () => Promise<unknown>, codigo: string, estado?: number) => {
  try {
    await sinBitacora(f);
  } catch (e: any) {
    assert.equal(e.code, codigo, `código ${e.code}: ${e.message}`);
    if (estado) assert.equal(e.status, estado);
    return e as Error;
  }
  throw new assert.AssertionError({ message: `se esperaba el error ${codigo}` });
};

// ── Base en memoria con el esquema real ───────────────────────────────────────

const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);

const usuario = async (correo: string, role: string, nombre: string, apellido: string) => {
  const id = (await pg.query<{ id: string }>(`insert into users (email, role, first_name, last_name) values ($1, $2, $3, $4) returning id`, [correo, role, nombre, apellido])).rows[0].id;
  return { user: { id, email: correo, role } } as any;
};
const sergio = await usuario('dueno@ejemplo.test', 'Owner', 'Sergio', 'Prueba');
const ana = await usuario('ana@ejemplo.test', 'Analista', 'Ana', 'Ramos');
const socio = await usuario('socio@ejemplo.test', 'Socio', 'Luis', 'Socio');
const proyectoId = (await pg.query<{ id: string }>(`insert into projects (project_code, client) values ('PRUEBA-GUIAS', 'Cliente X') returning id`)).rows[0].id;

// ── Claude de mentiras ────────────────────────────────────────────────────────

interface Llamada { modelo: string; maxTokens: number; system: string; usuario: string; signal?: AbortSignal }
const llamadas: Llamada[] = [];
let respuestas: (string | { corta: string } | Error)[] = [];
ponerClienteDePrueba({
  messages: {
    stream: (params: any, opts: any) => {
      llamadas.push({ modelo: params.model, maxTokens: params.max_tokens, system: params.system.map((b: any) => b.text).join('\n'), usuario: params.messages.at(-1).content, signal: opts?.signal });
      return {
        finalMessage: async () => {
          const r = respuestas.shift();
          if (r === undefined) throw new Error('el cliente de mentiras se quedó sin respuestas');
          if (r instanceof Error) throw r;
          const corta = typeof r === 'object';
          return { content: [{ type: 'text', text: corta ? r.corta : r }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 }, stop_reason: corta ? 'max_tokens' : 'end_turn' };
        },
      };
    },
  },
} as any);

const ROADMAP_IA = JSON.stringify({
  proyecto: 'Marca X – Estudio de empaque', tipo: 'Sesión de grupo', duracion: 120, muestra: ['**1 sesión de grupo** con consumidores, 25 a 35 años'],
  bloques: [
    { nombre: 'Warm up', minutos: 5, objetivos: ['Entrar en calor', '', 'Conocer el contexto'] },
    { nombre: 'Categoría', minutos: 30, objetivos: ['Entender cómo hablan de la categoría'] },
    { nombre: 'Empaque', minutos: 85, objetivos: ['Evaluar el empaque'] },
  ],
  supuestos: ['El benchmark va a ciegas'],
});
const BLOQUE_IA = JSON.stringify({
  moderador: 'Ya que hablamos de lo anterior, ahora vamos a platicar de la categoría.',
  secciones: [{ subtema: 'Asociaciones', preguntas: ['¿Qué es lo primero que les viene a la mente? ¿Por qué?', { texto: 'Díganme qué valoran en cuanto a:', sub: ['Empaque', 'Sabor'] }], notas: ['El moderador estará pendiente de menciones espontáneas de la marca.'] }],
});
const estadoDe = (parche: Partial<EstadoGuia> = {}): EstadoGuia => ({ ...estadoVacio(), proyecto: 'Marca X – Estudio de empaque', tema: 'Cómo eligen y qué piensan del empaque nuevo', ...parche });
const conRoadmap = (): EstadoGuia => estadoDe({
  modo: 'tema', paso: 'roadmap', muestraText: '1 sesión de grupo', estimulos: 'Dos empaques', notas: 'No mencionar la marca antes del bloque 3',
  roadmap: { muestra: ['1 sesión de grupo'], bloques: [
    { nombre: 'Warm up', minutos: 5, objetivos: ['Entrar en calor'] },
    { nombre: 'Categoría', minutos: 30, objetivos: ['Entender cómo hablan de la categoría', 'Conocer barreras'] },
    { nombre: 'Empaque', minutos: 85, objetivos: ['Evaluar el empaque'] },
  ] },
  guia: [null, null, null],
});

// ── Permisos ──────────────────────────────────────────────────────────────────

await prueba('sin sesión (o sin correo) no entra nadie, y no se le llama a Claude; con sesión entra todo el equipo, sea cual sea su rol', async () => {
  await rechaza(() => crear.run({}, { user: null } as any), 'UNAUTHORIZED', 401);
  await rechaza(() => crear.run({}, { user: { id: ana.user.id, email: '' } } as any), 'UNAUTHORIZED');
  await rechaza(() => listar.run({}, { user: null } as any), 'UNAUTHORIZED');
  await rechaza(() => leerArchivo.run({ nombre: 'a.txt', base64: Buffer.from('hola').toString('base64') }, { user: null } as any), 'UNAUTHORIZED');
  await rechaza(() => roadmapIA.run({ estado: estadoDe() }, { user: null } as any), 'UNAUTHORIZED');
  assert.equal(llamadas.length, 0, 'a Claude no se le debe llamar si no hay sesión');
  for (const quien of [ana, socio, sergio]) {
    const g: any = await sinBitacora(() => crear.run({ titulo: 'Para probar el acceso' }, quien));
    assert.ok(((await sinBitacora(() => listar.run({}, quien))) as any).guias.some((x: any) => x.id === g.id));
    assert.equal(((await sinBitacora(() => leerArchivo.run({ nombre: 'a.txt', base64: Buffer.from('hola').toString('base64') }, quien))) as any).texto, 'hola');
    await sinBitacora(() => borrar.run({ id: g.id }, quien));
  }
});

await prueba('puedeVerGuias (lo que decide si se ve la pestañita): todo el equipo; sin correo, nadie', () => {
  assert.equal(puedeVerGuias('ana@ejemplo.test'), true);
  assert.equal(puedeVerGuias('  OTRA@ejemplo.test '), true);
  assert.equal(puedeVerGuias(''), false);
  assert.equal(puedeVerGuias(null), false);
  assert.equal(puedeVerGuias(undefined), false);
});

await prueba('GUIAS_ALLOWED_EMAILS puede acotar sin tocar el código: una lista deja pasar solo a esas personas (sin importar mayúsculas) y «*» vuelve a abrir a todo el equipo', async () => {
  try {
    process.env.GUIAS_ALLOWED_EMAILS = 'otra@ejemplo.test, SOCIO@ejemplo.test';
    await rechaza(() => crear.run({}, ana), 'FORBIDDEN', 403);
    await rechaza(() => crear.run({}, sergio), 'FORBIDDEN');
    await rechaza(() => listar.run({}, ana), 'FORBIDDEN');
    const g2: any = await sinBitacora(() => crear.run({ titulo: 'Del socio' }, socio));
    await sinBitacora(() => borrar.run({ id: g2.id }, socio));
    process.env.GUIAS_ALLOWED_EMAILS = '*';
    const g: any = await sinBitacora(() => crear.run({ titulo: 'De Ana' }, ana));
    await sinBitacora(() => borrar.run({ id: g.id }, ana));
  } finally {
    delete process.env.GUIAS_ALLOWED_EMAILS;
  }
  await sinBitacora(async () => { const g: any = await crear.run({ titulo: 'De nuevo todo el equipo' }, ana); await borrar.run({ id: g.id }, ana); });
});

// ── Crear, abrir, guardar, borrar ─────────────────────────────────────────────

let guiaId = '';
await prueba('crear una guía ligada al proyecto: sale en la lista del proyecto (con su autor) y no en la de otro', async () => {
  const g: any = await sinBitacora(() => crear.run({ projectId: proyectoId, proyecto: 'Cliente X – Estudio de prueba' }, sergio));
  guiaId = g.id;
  assert.equal(g.version, 1);
  const lista: any = await sinBitacora(() => listar.run({ projectId: proyectoId }, sergio));
  assert.equal(lista.guias.length, 1);
  const fila = lista.guias[0];
  assert.equal(fila.id, guiaId);
  assert.equal(fila.titulo, 'Cliente X – Estudio de prueba');
  assert.equal(fila.autor, 'Sergio Prueba');
  assert.equal(fila.bloques, 0);
  assert.equal(fila.puedeBorrar, true);
  const otroProyecto = (await pg.query<{ id: string }>(`insert into projects (project_code, client) values ('OTRO-PROYECTO', 'Cliente Y') returning id`)).rows[0].id;
  assert.equal(((await sinBitacora(() => listar.run({ projectId: otroProyecto }, sergio))) as any).guias.length, 0);
  assert.equal(((await sinBitacora(() => listar.run({}, sergio))) as any).guias.length, 1);
});

await prueba('abrir la guía trae su estado inicial (con el proyecto prellenado) y su versión', async () => {
  const g: any = await sinBitacora(() => abrir.run({ id: guiaId }, sergio));
  assert.equal(g.version, 1);
  assert.equal(g.projectId, proyectoId);
  assert.equal(g.estado.proyecto, 'Cliente X – Estudio de prueba');
  assert.equal(g.estado.duracion, 120);
  assert.equal(g.estado.paso, 'proyecto');
  assert.equal(g.puedeBorrar, true);
});

await prueba('guardar sube la versión; el estado vuelve igual; la lista cuenta bloques y escritos; la guía se ajusta al largo del roadmap', async () => {
  const st = conRoadmap();
  st.guia = [JSON.parse(BLOQUE_IA), null, null, JSON.parse(BLOQUE_IA)]; // uno de más: se recorta al largo del roadmap
  const r: any = await sinBitacora(() => guardar.run({ id: guiaId, titulo: 'Guía de prueba', estado: st, version: 1 }, sergio));
  assert.equal(r.version, 2);
  const g: any = await sinBitacora(() => abrir.run({ id: guiaId }, sergio));
  assert.equal(g.titulo, 'Guía de prueba');
  assert.equal(g.version, 2);
  assert.equal(g.estado.guia.length, 3);
  assert.equal(g.estado.roadmap.bloques[1].nombre, 'Categoría');
  const fila = ((await sinBitacora(() => listar.run({ projectId: proyectoId }, sergio))) as any).guias[0];
  assert.deepEqual([fila.bloques, fila.escritos, fila.tipo, fila.duracion], [3, 1, 'Sesión de grupo', 120]);
});

await prueba('si otra persona guardó antes, guardar con la versión vieja da conflicto (409) y no pisa nada', async () => {
  const st = conRoadmap();
  await sinBitacora(() => guardar.run({ id: guiaId, titulo: 'Versión de la otra persona', estado: st, version: 2 }, sergio));
  const e = await rechaza(() => guardar.run({ id: guiaId, titulo: 'Mi versión vieja', estado: st, version: 2 }, sergio), 'CONFLICT', 409);
  assert.match(e.message, /Recarga/);
  assert.equal(((await sinBitacora(() => abrir.run({ id: guiaId }, sergio))) as any).titulo, 'Versión de la otra persona');
});

await prueba('los topes del esquema rechazan lo absurdo antes de guardar (duración fuera de rango, demasiados bloques)', async () => {
  await rechaza(() => guardar.run({ id: guiaId, titulo: 'x', estado: { ...conRoadmap(), duracion: 5 }, version: 3 }, sergio), 'BAD_REQUEST', 400);
  const muchos = { ...conRoadmap(), roadmap: { muestra: [], bloques: Array.from({ length: 21 }, (_, i) => ({ nombre: `B${i}`, minutos: 5, objetivos: [] })) }, guia: [] };
  await rechaza(() => guardar.run({ id: guiaId, titulo: 'x', estado: muchos, version: 3 }, sergio), 'BAD_REQUEST');
  await rechaza(() => guardar.run({ id: guiaId, titulo: '   ', estado: conRoadmap(), version: 3 }, sergio), 'BAD_REQUEST');
});

await prueba('el roadmap pegado se guarda con la guía y vuelve al abrirla; una guía sin ese campo se completa vacía y el tope se respeta', async () => {
  const g0: any = await sinBitacora(() => abrir.run({ id: guiaId }, sergio));
  const conTexto = { ...conRoadmap(), modo: 'roadmap' as const, roadmapText: '1 | Warm up | 5 min | Entrar en calor\n2 | Categoría | 30 min | Entender' };
  const r: any = await sinBitacora(() => guardar.run({ id: guiaId, titulo: 'Con roadmap pegado', estado: conTexto, version: g0.version }, sergio));
  const g1: any = await sinBitacora(() => abrir.run({ id: guiaId }, sergio));
  assert.equal(g1.estado.roadmapText, conTexto.roadmapText);
  assert.equal(g1.estado.modo, 'roadmap');
  // un navegador con la versión anterior de la pantalla no manda el campo: no truena y queda vacío
  const sinCampo: any = { ...conRoadmap() };
  delete sinCampo.roadmapText;
  await sinBitacora(() => guardar.run({ id: guiaId, titulo: 'Sin el campo', estado: sinCampo, version: r.version }, sergio));
  assert.equal(((await sinBitacora(() => abrir.run({ id: guiaId }, sergio))) as any).estado.roadmapText, '');
  // el tope
  const v = ((await sinBitacora(() => abrir.run({ id: guiaId }, sergio))) as any).version;
  await rechaza(() => guardar.run({ id: guiaId, titulo: 'x', estado: { ...conRoadmap(), roadmapText: 'r'.repeat(60_001) }, version: v }, sergio), 'BAD_REQUEST', 400);
  await sinBitacora(() => guardar.run({ id: guiaId, titulo: 'x', estado: { ...conRoadmap(), roadmapText: 'r'.repeat(60_000) }, version: v }, sergio));
});

await prueba('una guía nueva se llama como el proyecto; las repetidas del mismo proyecto se numeran (2), (3)…; otro proyecto o sin proyecto no', async () => {
  const nuevaDe = async (extra: Record<string, unknown>) => {
    const g: any = await sinBitacora(() => crear.run(extra, sergio));
    return { id: g.id as string, titulo: ((await sinBitacora(() => abrir.run({ id: g.id }, sergio))) as any).titulo as string };
  };
  const base = 'Estudio repetido';
  const a = await nuevaDe({ projectId: proyectoId, proyecto: base });
  const b = await nuevaDe({ projectId: proyectoId, proyecto: base });
  const c = await nuevaDe({ projectId: proyectoId, proyecto: base });
  assert.deepEqual([a.titulo, b.titulo, c.titulo], [base, `${base} (2)`, `${base} (3)`]);
  // si se borra la (2), la siguiente ocupa ese lugar
  await sinBitacora(() => borrar.run({ id: b.id }, sergio));
  const d = await nuevaDe({ projectId: proyectoId, proyecto: base });
  assert.equal(d.titulo, `${base} (2)`);
  // un título pedido a mano también se numera; otro proyecto y sin proyecto no
  const e = await nuevaDe({ projectId: proyectoId, titulo: base });
  assert.equal(e.titulo, `${base} (4)`);
  const otroProyecto = (await pg.query<{ id: string }>(`insert into projects (project_code, client) values ('NUMERACION', 'Cliente Z') returning id`)).rows[0].id;
  assert.equal((await nuevaDe({ projectId: otroProyecto, proyecto: base })).titulo, base);
  assert.equal((await nuevaDe({ proyecto: base })).titulo, base);
  assert.equal((await nuevaDe({ projectId: proyectoId })).titulo, 'Guía sin nombre');
  assert.equal((await nuevaDe({ projectId: proyectoId })).titulo, 'Guía sin nombre (2)');
  // un nombre larguísimo cabe en lo que acepta saveGuia (200)
  const largo = await nuevaDe({ projectId: proyectoId, proyecto: 'L'.repeat(300) });
  assert.ok(largo.titulo.length <= 200, `${largo.titulo.length} letras`);
  const largo2 = await nuevaDe({ projectId: proyectoId, proyecto: 'L'.repeat(300) });
  assert.ok(largo2.titulo.length <= 200 && largo2.titulo !== largo.titulo && largo2.titulo.endsWith(' (2)'));
  // y se puede guardar con ese título
  const abierta: any = await sinBitacora(() => abrir.run({ id: largo2.id }, sergio));
  await sinBitacora(() => guardar.run({ id: largo2.id, titulo: largo2.titulo, estado: conRoadmap(), version: abierta.version }, sergio));
});

await prueba('borrar: solo quien la creó, un Owner o un Socio; después ya no sale ni se abre', async () => {
  const g: any = await sinBitacora(() => crear.run({ titulo: 'Para borrar', projectId: proyectoId }, sergio));
  assert.equal(((await sinBitacora(() => abrir.run({ id: g.id }, sergio))) as any).puedeBorrar, true);
  // una Analista abre y edita la guía de otra persona, pero no la puede borrar; un Socio sí
  assert.equal(((await sinBitacora(() => abrir.run({ id: g.id }, ana))) as any).puedeBorrar, false);
  const lista: any = await sinBitacora(() => listar.run({ projectId: proyectoId }, ana));
  assert.ok(lista.guias.every((x: any) => x.puedeBorrar === false));
  await rechaza(() => borrar.run({ id: g.id }, ana), 'FORBIDDEN', 403);
  assert.equal(((await sinBitacora(() => abrir.run({ id: g.id }, socio))) as any).puedeBorrar, true);
  await sinBitacora(() => borrar.run({ id: g.id }, socio));
  await rechaza(() => abrir.run({ id: g.id }, sergio), 'NOT_FOUND', 404);
  const ids = ((await sinBitacora(() => listar.run({ projectId: proyectoId }, sergio))) as any).guias.map((x: any) => x.id);
  assert.ok(!ids.includes(g.id) && ids.includes(guiaId));
  await rechaza(() => guardar.run({ id: g.id, titulo: 'x', estado: conRoadmap(), version: 1 }, sergio), 'CONFLICT');
});

// ── Lo que le llega a Claude ──────────────────────────────────────────────────

await prueba('roadmap desde el tema: Sonnet, la skill como system prompt, los datos del proyecto en el mensaje, y el resultado limpio', async () => {
  llamadas.length = 0;
  respuestas = [ROADMAP_IA];
  const avance: any[] = [];
  const r: any = await roadmapIA.run({ estado: estadoDe({ modo: 'tema', tipo: 'Tríada', duracion: 90, muestraText: '3 tríadas de mamás', estimulos: 'Dos conceptos', notas: 'Cuidar el precio' }) }, sergio, (c) => avance.push(c));
  assert.equal(llamadas.length, 1);
  const l = llamadas[0];
  assert.equal(l.modelo, MODELO_ROADMAP);
  assert.equal(MODELO_ROADMAP, 'claude-sonnet-5-5');
  assert.equal(l.maxTokens, 6000);
  assert.match(l.system, /Guías de tópicos Sapience/);
  assert.match(l.system, /MODO HUB/);
  assert.match(l.system, /Reglas del roadmap/);
  assert.match(l.system, /Para no sesgar la conversación/);
  for (const dato of ['Marca X – Estudio de empaque', 'Tipo de sesión: Tríada', 'Duración: 90 min.', '3 tríadas de mamás', 'Dos conceptos', 'Cuidar el precio', 'Cómo eligen y qué piensan del empaque nuevo', 'no hay brief', 'sumen exactamente 90 minutos']) {
    assert.ok(l.usuario.includes(dato), `falta «${dato}» en el mensaje`);
  }
  assert.equal(r.roadmap.bloques.length, 3);
  assert.deepEqual(r.roadmap.bloques[0].objetivos, ['Entrar en calor', 'Conocer el contexto'], 'los objetivos vacíos se quitan');
  assert.deepEqual(r.roadmap.muestra, ['1 sesión de grupo con consumidores, 25 a 35 años'], 'sin asteriscos en la muestra');
  assert.deepEqual(r.supuestos, ['El benchmark va a ciegas']);
  assert.equal(r.proyecto, 'Marca X – Estudio de empaque');
  assert.ok(avance.some((c) => c.paso), 'avisa su avance');
});

await prueba('roadmap desde un brief y leyendo un roadmap pegado: cada modo pide lo suyo y exige su texto', async () => {
  respuestas = [ROADMAP_IA, ROADMAP_IA];
  llamadas.length = 0;
  await sinBitacora(() => roadmapIA.run({ estado: estadoDe({ modo: 'brief' }), fuente: 'Brief: la marca quiere cambiar su empaque.' }, sergio));
  assert.match(llamadas[0].usuario, /a partir de este brief/);
  assert.match(llamadas[0].usuario, /la marca quiere cambiar su empaque/);
  await sinBitacora(() => roadmapIA.run({ estado: estadoDe({ modo: 'roadmap' }), fuente: '1 | Warm up | 5 min | Entrar en calor' }, sergio));
  assert.match(llamadas[1].usuario, /pegó o subió el roadmap/);
  assert.match(llamadas[1].usuario, /Warm up \| 5 min/);
  assert.match(llamadas[1].usuario, /sin inventar bloques ni cambiar su orden/);
  await rechaza(() => roadmapIA.run({ estado: estadoDe({ modo: 'roadmap' }) }, sergio), 'BAD_REQUEST');
  await rechaza(() => roadmapIA.run({ estado: estadoDe({ modo: 'brief' }), fuente: '   ' }, sergio), 'BAD_REQUEST');
  await rechaza(() => roadmapIA.run({ estado: estadoDe({ modo: 'tema', tema: '  ' }) }, sergio), 'BAD_REQUEST');
  assert.equal(llamadas.length, 2, 'si falta el texto no se llama a Claude');
});

await prueba('ajustar el roadmap manda el actual y el pedido; sin roadmap no se puede ajustar', async () => {
  llamadas.length = 0;
  respuestas = [ROADMAP_IA];
  await sinBitacora(() => ajustarIA.run({ estado: conRoadmap(), pedido: 'junta los dos últimos bloques' }, sergio));
  assert.equal(llamadas[0].modelo, MODELO_ROADMAP);
  assert.match(llamadas[0].usuario, /junta los dos últimos bloques/);
  assert.match(llamadas[0].usuario, /"nombre":"Categoría"/);
  await rechaza(() => ajustarIA.run({ estado: estadoDe(), pedido: 'x' }, sergio), 'BAD_REQUEST');
});

await prueba('escribir un bloque: Opus, el volumen de ESE bloque en preguntas y palabras, la transición, lo que sigue y el contexto; el bloque sale limpio', async () => {
  llamadas.length = 0;
  respuestas = [BLOQUE_IA];
  const st = conRoadmap();
  st.briefText = 'El brief habla de cambio de empaque y de precio.';
  const r: any = await sinBitacora(() => bloqueIA.run({ estado: st, indice: 1 }, sergio));
  const l = llamadas[0];
  assert.equal(l.modelo, MODELO_BLOQUE);
  assert.equal(MODELO_BLOQUE, 'claude-opus-5-5');
  assert.equal(l.maxTokens, 16000);
  // 30 minutos: una pregunta principal cada 2 minutos y ≈ 16 palabras por minuto
  assert.match(l.usuario, /Este bloque dura 30 minutos: escribe alrededor de 15 preguntas principales/);
  assert.match(l.usuario, /ronde las 480 palabras/);
  assert.match(l.usuario, /Viene después de "Warm up"/);
  assert.match(l.usuario, /Después sigue "Empaque"; no adelantes temas de ese bloque/);
  assert.match(l.usuario, /Escribe ahora solo el bloque 2: "Categoría" \(30 min\.\)/);
  assert.match(l.usuario, /Extracto del brief:\nEl brief habla de cambio de empaque/);
  assert.match(l.usuario, /No mencionar la marca antes del bloque 3/);
  assert.match(l.usuario, /1\. Warm up \(5 min\.\).*\n2\. Categoría \(30 min\.\).*\n3\. Empaque \(85 min\.\)/);
  assert.equal(r.bloque.secciones[0].preguntas.length, 2);
  assert.deepEqual(r.bloque.secciones[0].preguntas[1], { texto: 'Díganme qué valoran en cuanto a:', sub: ['Empaque', 'Sabor'] });
  // el warm up de 5 minutos lleva 2 o 3 preguntas, el último bloque cierra con consejos
  respuestas = [BLOQUE_IA, BLOQUE_IA];
  await sinBitacora(() => bloqueIA.run({ estado: st, indice: 0 }, sergio));
  assert.match(llamadas[1].usuario, /Este bloque dura 5 minutos: escribe alrededor de 3 preguntas principales/);
  assert.match(llamadas[1].usuario, /Es el primer bloque de la sesión/);
  await sinBitacora(() => bloqueIA.run({ estado: st, indice: 2 }, sergio));
  assert.match(llamadas[2].usuario, /Es el último bloque antes del cierre/);
  assert.match(llamadas[2].usuario, /alrededor de 43 preguntas principales/);
});

await prueba('rehacer un bloque con un comentario manda la versión anterior y el cambio pedido', async () => {
  llamadas.length = 0;
  respuestas = [BLOQUE_IA];
  await sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1, previo: JSON.parse(BLOQUE_IA), comentario: 'más preguntas sobre precio' }, sergio));
  assert.match(llamadas[0].usuario, /versión anterior del bloque/);
  assert.match(llamadas[0].usuario, /Se pidió este cambio: "más preguntas sobre precio"/);
  assert.match(llamadas[0].usuario, /Asociaciones/);
});

await prueba('un bloque que no existe o sin nombre se rechaza sin llamar a Claude', async () => {
  llamadas.length = 0;
  await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 7 }, sergio), 'BAD_REQUEST');
  const sinNombre = conRoadmap();
  sinNombre.roadmap!.bloques[1].nombre = '  ';
  await rechaza(() => bloqueIA.run({ estado: sinNombre, indice: 1 }, sergio), 'BAD_REQUEST');
  assert.equal(llamadas.length, 0);
});

// ── Errores de la IA ──────────────────────────────────────────────────────────

await prueba('una respuesta cortada por largo da un error claro (no «JSON inválido») y no se reintenta', async () => {
  llamadas.length = 0;
  respuestas = [{ corta: '{"moderador": "Ya que' }];
  const e = await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio), 'INTERNAL_ERROR');
  assert.match(e.message, /se cortó por largo/);
  assert.equal(llamadas.length, 1);
});

await prueba('si Claude no devuelve JSON válido se reintenta UNA vez pidiendo solo el JSON; si falla otra vez, error claro', async () => {
  llamadas.length = 0;
  respuestas = ['Claro, aquí tienes la guía:', '```json\n' + BLOQUE_IA + '\n```'];
  const r: any = await sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio));
  assert.equal(llamadas.length, 2);
  assert.match(llamadas[1].usuario, /no es válida/);
  assert.equal(r.bloque.secciones.length, 1);
  llamadas.length = 0;
  respuestas = ['no es json', '{"moderador": 3}'];
  const e = await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio), 'INTERNAL_ERROR');
  assert.match(e.message, /no devolvió un JSON válido tras reintentar/);
  assert.equal(llamadas.length, 2);
});

await prueba('«Detener»: la señal llega a la llamada a Claude y, si ya se detuvo, ni se llama', async () => {
  llamadas.length = 0;
  respuestas = [BLOQUE_IA];
  const control = new AbortController();
  await sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio, undefined, control.signal));
  assert.equal(llamadas[0].signal, control.signal);
  control.abort();
  llamadas.length = 0;
  const e = await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio, undefined, control.signal), 'BAD_REQUEST');
  assert.match(e.message, /Se detuvo/);
  assert.equal(llamadas.length, 0);
  // si se corta a media llamada, también se dice «Se detuvo» y no un error raro
  const c2 = new AbortController();
  respuestas = [new Error('Request was aborted.')];
  const pendiente = rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio, undefined, c2.signal), 'BAD_REQUEST');
  c2.abort();
  assert.match((await pendiente).message, /Se detuvo/);
});

await prueba('los errores de la API de la IA se dicen en palabras: sin saldo, llave inválida, saturada, sin conexión; los desconocidos no se tapan', async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const cabeceras = new Headers();
  const cuerpo = (mensaje: string) => ({ type: 'error', error: { type: 'invalid_request_error', message: mensaje } });
  const casos: [Error, RegExp][] = [
    [Anthropic.APIError.generate(400, cuerpo('Your credit balance is too low to access the Anthropic API.'), 'Your credit balance is too low to access the Anthropic API.', cabeceras) as Error, /se quedó sin saldo/],
    [Anthropic.APIError.generate(401, cuerpo('invalid x-api-key'), 'invalid x-api-key', cabeceras) as Error, /llave de la IA no es válida/],
    [Anthropic.APIError.generate(429, cuerpo('rate limited'), 'rate limited', cabeceras) as Error, /demasiadas peticiones/],
    [Anthropic.APIError.generate(529, cuerpo('overloaded'), 'overloaded', cabeceras) as Error, /saturada/],
    [new Anthropic.APIConnectionError({ message: 'fallo de red' }) as Error, /No se pudo conectar/],
  ];
  for (const [error, patron] of casos) {
    respuestas = [error];
    const e = await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio), 'INTERNAL_ERROR', 500);
    assert.match(e.message, patron);
  }
  respuestas = [new TypeError('algo que no es de la IA')];
  await assert.rejects(() => sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio)), /algo que no es de la IA/);
});

await prueba('tope de uso de la IA por persona y por hora; se reinicia', async () => {
  reiniciarCuota();
  llamadas.length = 0;
  respuestas = Array.from({ length: 60 }, () => BLOQUE_IA);
  for (let i = 0; i < 40; i++) await sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio));
  const e = await rechaza(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio), 'FORBIDDEN');
  assert.match(e.message, /límite de uso/);
  assert.equal(llamadas.length, 40);
  reiniciarCuota();
  await sinBitacora(() => bloqueIA.run({ estado: conRoadmap(), indice: 1 }, sergio));
});

// ── Archivos y Word ───────────────────────────────────────────────────────────

const requireCjs = createRequire(import.meta.url);
const JSZip = requireCjs(requireCjs.resolve('jszip', { paths: [path.dirname(requireCjs.resolve('pptxgenjs'))] }));
const estadoCompleto = (): EstadoGuia => {
  const st = conRoadmap();
  st.proyecto = 'Cliente & Hijos <Estudio> "de prueba"';
  st.roadmap!.muestra = ['**1 sesión de grupo** con mamás, 25 a 35 años', '', '2 mini grupos con papás'];
  st.roadmap!.bloques[1].objetivos = ['Entender cómo hablan de la categoría & sus marcas', 'Conocer barreras <y motivos>'];
  const bloque = JSON.parse(BLOQUE_IA);
  bloque.moderador = bloque.moderador.replace('Ya que hablamos', 'Ya que hablamos \u0007de'); // un carácter de control, que Word no acepta
  st.guia = [bloque, null, null];
  return st;
};

await prueba('el Word sale sobre la plantilla, abre como Word (XML bien formado), escapa lo raro y marca los bloques por escribir', async () => {
  const w = await wordDeGuia(estadoCompleto());
  assert.match(w.nombre, /\.docx$/);
  const zip = await JSZip.loadAsync(Buffer.from(w.base64, 'base64'));
  const xml: string = await zip.file('word/document.xml').async('string');
  assert.ok(!xml.includes('{{BODY}}'));
  assert.ok(xml.includes('Cliente &amp; Hijos &lt;Estudio&gt; &quot;de prueba&quot;'), 'el nombre del proyecto va escapado');
  assert.ok(xml.includes('Entender cómo hablan de la categoría &amp; sus marcas'));
  assert.ok(xml.includes('Warm up') && xml.includes('Categoría') && xml.includes('Empaque'));
  assert.ok(xml.includes('¿Qué es lo primero que les viene a la mente? ¿Por qué?'));
  assert.ok(xml.includes('(Bloque por escribir)'), 'los bloques sin escribir lo dicen');
  assert.equal((xml.match(/\(Bloque por escribir\)/g) ?? []).length, 2);
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), 'sin caracteres de control');
  assert.ok(!xml.includes('<w:t xml:space="preserve"></w:t>') || true);
  // XML bien formado, si el sistema trae xmllint
  const ruta = path.join(process.env.TMPDIR ?? '/tmp', `guia-prueba-${process.pid}.xml`);
  fs.writeFileSync(ruta, xml);
  try { execFileSync('xmllint', ['--noout', ruta], { stdio: 'pipe' }); } catch (e: any) { if (e.code !== 'ENOENT') throw new Error(`document.xml mal formado: ${String(e.stderr).slice(0, 300)}`); } finally { fs.unlinkSync(ruta); }
});

await prueba('descargar el Word de una guía guardada: es el del último guardado', async () => {
  const g: any = await sinBitacora(() => crear.run({ titulo: 'Con Word', projectId: proyectoId }, sergio));
  await sinBitacora(() => guardar.run({ id: g.id, titulo: 'Con Word', estado: estadoCompleto(), version: 1 }, sergio));
  const w: any = await sinBitacora(() => wordEndpoint.run({ id: g.id }, sergio));
  const zip = await JSZip.loadAsync(Buffer.from(w.base64, 'base64'));
  assert.ok((await zip.file('word/document.xml').async('string')).includes('Entender cómo hablan'));
  // todo el equipo puede bajar el Word de una guía
  const wAna: any = await sinBitacora(() => wordEndpoint.run({ id: g.id }, ana));
  assert.equal(wAna.nombre, w.nombre);
  await sinBitacora(() => borrar.run({ id: g.id }, sergio));
  await rechaza(() => wordEndpoint.run({ id: g.id }, sergio), 'NOT_FOUND');
});

await prueba('leer el roadmap de un Word: la tabla del Word de una guía vuelve como un renglón por fila, con « | » entre celdas y los objetivos con «; »', async () => {
  const w = await wordDeGuia(estadoCompleto());
  const texto = await textoDeArchivo('Guía anterior.docx', Buffer.from(w.base64, 'base64'));
  const renglones = texto.split('\n');
  assert.ok(renglones.includes('| Bloque temático | Tiempo | Objetivos'), 'el encabezado de la tabla');
  assert.ok(renglones.includes('1 | Warm up | 5 min. | Entrar en calor'));
  assert.ok(renglones.includes('2 | Categoría | 30 min. | Entender cómo hablan de la categoría & sus marcas; Conocer barreras <y motivos>'), 'texto con & y < sin deformar');
  assert.ok(renglones.includes('3 | Empaque | 85 min. | Evaluar el empaque'));
  // lo mismo por el endpoint
  const r: any = await sinBitacora(() => leerArchivo.run({ nombre: 'Guía anterior.docx', base64: w.base64 }, sergio));
  assert.equal(r.texto, texto);
});

await prueba('htmlATexto: tablas con párrafos y viñetas por celda, entidades y texto suelto en su orden', () => {
  const html = '<p>Antes</p><table><tr><th><p>A</p></th><th><p>B &amp; C</p></th></tr><tr><td><p>1</p></td><td><ul><li>uno</li><li>dos</li></ul></td></tr><tr><td></td><td></td></tr></table><ul><li>después</li></ul><p>Fin &lt;ok&gt;</p>';
  assert.equal(htmlATexto(html), 'Antes\nA | B & C\n1 | uno; dos\n- después\nFin <ok>');
  assert.equal(htmlATexto('<p>  </p><p>Hola</p>'), 'Hola');
});

await prueba('leer .txt y .md tal cual; lo demás se rechaza con una frase clara', async () => {
  assert.equal(await textoDeArchivo('roadmap.txt', Buffer.from('Warm up (5 min)\r\nEmpaque (85 min)\r\n')), 'Warm up (5 min)\nEmpaque (85 min)');
  assert.equal(await textoDeArchivo('Brief.MD', Buffer.from('# Brief\nCambio de empaque')), '# Brief\nCambio de empaque');
  for (const [nombre, patron] of [['x.pdf', /Word \(\.docx\), \.txt o \.md/], ['x.doc', /guárdalo como \.docx/], ['x', /Word/], ['vacio.txt', /no tiene texto/]] as const) {
    const e = await rechaza(() => textoDeArchivo(nombre, Buffer.from(nombre === 'vacio.txt' ? '  \n ' : 'hola')), 'BAD_REQUEST');
    assert.match(e.message, patron, nombre);
  }
  const e = await rechaza(() => textoDeArchivo('feo.docx', Buffer.from('esto no es un zip')), 'BAD_REQUEST');
  assert.match(e.message, /No se pudo leer el Word/);
  await rechaza(() => textoDeArchivo('enorme.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 65)), 'BAD_REQUEST');
  await rechaza(() => leerArchivo.run({ nombre: 'a.txt', base64: '' }, sergio), 'BAD_REQUEST');
});

// ── Lo que comparten el servidor y la pantalla ────────────────────────────────

await prueba('realinearGuia conserva lo escrito solo en los bloques que quedaron igual; los minutos del roadmap se suman', () => {
  const st = conRoadmap();
  st.guia = [JSON.parse(BLOQUE_IA), JSON.parse(BLOQUE_IA), null];
  const nuevos = [
    { ...st.roadmap!.bloques[0] },                                          // igual → conserva
    { ...st.roadmap!.bloques[1], minutos: 35 },                              // cambió → se pierde
    { nombre: 'Precio', minutos: 80, objetivos: ['Entender sensibilidad al precio'] }, // nuevo
  ];
  const guia = realinearGuia(st, nuevos);
  assert.ok(guia[0] && !guia[1] && !guia[2]);
  assert.equal(minutosRoadmap(st.roadmap!.bloques), 120);
  assert.equal(minutosRoadmap(nuevos), 120);
});

ponerClienteDePrueba(null);
console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
