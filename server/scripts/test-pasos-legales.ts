// Pruebas de los dos pasos de ley que el Hub pone en todo filtro (src/lib/formularios/pasos.ts): el aviso de privacidad, siempre primero, y el acuerdo de confidencialidad, siempre al final con
// «Leí y acepto» (sin firma dibujada). Que se agreguen también a los filtros que ya existían, que quien no acepta termine ahí, que el servidor no reciba una respuesta sin ellos y que guarde
// la constancia del acuerdo; y que el texto del acuerdo no se separe sin querer del NDA que se firma. Contra una base en memoria (PGlite) con las tablas de Filtros mínimas. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-pasos-legales.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { ACUERDO_SECCIONES, ACUERDO_TITULO, ACUERDO_VERSION, acuerdoEnTexto } from '../../src/lib/formularios/acuerdo';
import { ID_AVISO, ID_NOMBRE, SECCION_INICIO, seccionInicio } from '../../src/lib/formularios/inicio';
import { bandejaDe, evaluar, pantallas, terminacion } from '../../src/lib/formularios/motor';
import { ID_ACUERDO, SECCION_ACUERDO, SECCION_AVISO, TEXTO_REPASO_AVISO, conPasosDelHub, pasoLegalDe } from '../../src/lib/formularios/pasos';
import type { Definicion, Respuestas, Resultado } from '../../src/lib/formularios/tipos';
import { NDA_SECCIONES, NDA_TITULO } from '../../src/serverUtils/nda/correo';
import getFormularioPublico from '../../src/api/getFormularioPublico';
import submitFormularioRespuesta from '../../src/api/submitFormularioRespuesta';

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

// ── Filtros inventados ───────────────────────────────────────────────────────────────────────────
const normal = (): Definicion => ({
  version: 2, pais: 'MX', tituloPublico: 'Prueba', bienvenida: 'Hola', despedida: 'Gracias', noCalifica: 'Gracias por tu tiempo',
  secciones: [{
    id: 's1', titulo: 'Tu casa',
    preguntas: [{ id: 'p1', tipo: 'unica', texto: '¿Vives en casa propia?', opciones: [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No', termina: 'Casa rentada', cortar: true }] }],
  }],
});
/** Como se guardan los filtros que ya traen «Antes de empezar» (con el aviso dentro). */
const conInicioGuardado = (): Definicion => { const d = normal(); return { ...d, secciones: [seccionInicio(), ...d.secciones] }; };
const idsDe = (d: Definicion) => d.secciones.map((s) => s.id);
const preguntasDe = (d: Definicion, seccion: string) => d.secciones.find((s) => s.id === seccion)?.preguntas.map((p) => p.id);

await prueba('un filtro que ya trae «Antes de empezar» queda con el aviso solo y primero, lo demás igual, y el acuerdo al final', () => {
  const original = conInicioGuardado();
  const d = conPasosDelHub(original);
  assert.deepEqual(idsDe(d), [SECCION_AVISO, SECCION_INICIO, 's1', SECCION_ACUERDO]);
  assert.deepEqual(preguntasDe(d, SECCION_AVISO), [ID_AVISO]);
  assert.ok(!preguntasDe(d, SECCION_INICIO)!.includes(ID_AVISO), 'el aviso ya no va dentro de «Antes de empezar»');
  assert.ok(preguntasDe(d, SECCION_INICIO)!.includes(ID_NOMBRE), 'el nombre y lo demás de «Antes de empezar» siguen ahí');
  assert.deepEqual(preguntasDe(d, SECCION_ACUERDO), [ID_ACUERDO]);
  // la pregunta del aviso es la misma que traía (con su texto y sus opciones), no una copia nueva
  assert.equal(d.secciones[0].preguntas[0], original.secciones[0].preguntas.find((p) => p.id === ID_AVISO));
});

await prueba('un filtro que no trae el aviso (de los primeros) lo recibe, con las mismas opciones de siempre, y también el acuerdo', () => {
  const d = conPasosDelHub(normal());
  assert.deepEqual(idsDe(d), [SECCION_AVISO, 's1', SECCION_ACUERDO]);
  const aviso = d.secciones[0].preguntas[0];
  assert.equal(aviso.id, ID_AVISO);
  assert.deepEqual(aviso.opciones?.map((o) => [o.id, !!o.termina]), [['acepto', false], ['no_acepto', true]]);
  const acuerdo = d.secciones[2].preguntas[0];
  assert.deepEqual(acuerdo.opciones?.map((o) => [o.id, o.label, !!o.termina]), [['acepto', 'Leí y acepto el acuerdo de confidencialidad', false], ['no_acepto', 'No acepto', true]]);
});

await prueba('aplicarlo dos veces no agrega nada otra vez, y no cambia la definición que recibe', () => {
  const original = conInicioGuardado();
  const copia = JSON.stringify(original);
  const una = conPasosDelHub(original);
  assert.equal(JSON.stringify(original), copia);
  assert.equal(conPasosDelHub(una), una);
});

await prueba('las pantallas: primero el aviso solo; ya aceptado, «Antes de empezar» sin el aviso; al final el acuerdo', () => {
  const d = conPasosDelHub(conInicioGuardado());
  const sin = pantallas(d, {});
  assert.deepEqual(sin.map((p) => p.seccion.id), [SECCION_AVISO, 's1', SECCION_ACUERDO]);
  assert.deepEqual(sin[0].preguntas.map((p) => p.clave), [ID_AVISO]);
  const aceptado = pantallas(d, { [ID_AVISO]: 'acepto' });
  assert.deepEqual(aceptado.map((p) => p.seccion.id), [SECCION_AVISO, SECCION_INICIO, 's1', SECCION_ACUERDO]);
  assert.ok(!aceptado[1].preguntas.some((p) => p.clave === ID_AVISO));
  assert.ok(aceptado[1].preguntas.some((p) => p.clave === ID_NOMBRE));
  assert.equal(pasoLegalDe(aceptado[0].seccion.id), 'aviso');
  assert.equal(pasoLegalDe(aceptado[3].seccion.id), 'acuerdo');
  assert.equal(pasoLegalDe(aceptado[2].seccion.id), undefined);
});

await prueba('quien no acepta el aviso termina ahí, con el mismo motivo de siempre, y queda como «No entra»', () => {
  const d = conPasosDelHub(normal());
  const r: Respuestas = { [ID_AVISO]: 'no_acepto' };
  assert.deepEqual(terminacion(d, r), { motivo: 'No aceptó el aviso de privacidad', clave: ID_AVISO });
  assert.equal(bandejaDe(evaluar(d, r)), 'No entra');
});

await prueba('quien no acepta el acuerdo al final termina ahí, con su motivo, y queda como «No entra» (no pasa al tablero)', () => {
  const d = conPasosDelHub(normal());
  const r: Respuestas = { [ID_AVISO]: 'acepto', p1: 'si', [ID_ACUERDO]: 'no_acepto' };
  assert.deepEqual(terminacion(d, r), { motivo: 'No aceptó el acuerdo de confidencialidad', clave: ID_ACUERDO });
  const res = evaluar(d, r);
  assert.equal(bandejaDe(res), 'No entra');
  assert.ok(res.terminado?.clave.startsWith('hub_'), 'los «hub_» no pasan al tablero (alRecibir.ts)');
});

await prueba('una respuesta completa sin el acuerdo aceptado queda incompleta; con los dos aceptados, no', () => {
  const d = conPasosDelHub(normal());
  assert.equal(evaluar(d, { [ID_AVISO]: 'acepto', p1: 'si' }).incompleto, true);
  assert.equal(evaluar(d, { [ID_AVISO]: 'acepto', p1: 'si', [ID_ACUERDO]: 'acepto' }).incompleto, false);
});

await prueba('el texto del recordatorio de «Antes de empezar» es el que pidió Sergio', () => {
  assert.equal(TEXTO_REPASO_AVISO, 'Volver a leer aviso de privacidad, donde encontrarás cómo cuidamos tus datos personales y las condiciones de participación.');
});

await prueba('el acuerdo del final es el mismo texto del NDA que se firma, salvo lo de la firma (así no se separan sin querer)', () => {
  assert.equal(ACUERDO_TITULO, NDA_TITULO);
  const comoAceptacion = (t: string) => t
    .replace('Al firmar,', 'Al marcar «Leí y acepto»,')
    .replace(', y que la firma que aparece aquí es mía.', '.')
    .replace('mi nombre, mi firma, la fecha y hora', 'mi nombre, la fecha y hora')
    .replace('constancia de esta firma', 'constancia de esta aceptación');
  assert.deepEqual(ACUERDO_SECCIONES, NDA_SECCIONES.map((s) => ({ titulo: s.titulo, parrafos: s.parrafos.map(comoAceptacion) })));
  const texto = ACUERDO_SECCIONES.flatMap((s) => s.parrafos).join(' ');
  assert.ok(!/firma/i.test(texto.replace(/Al marcar/g, '')), 'no habla de una firma que no hay');
});

await prueba('la huella del texto del acuerdo es estable y cambia si el texto cambia', () => {
  const h = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
  assert.equal(h(acuerdoEnTexto()), h(acuerdoEnTexto()));
  assert.notEqual(h(acuerdoEnTexto()), h(`${acuerdoEnTexto()} `));
  assert.match(ACUERDO_VERSION, /^\d{4}-\d{2}-\d{2}/);
});

// ── Servidor: la página pública y el envío de respuestas ─────────────────────────────────────────
const pg = await PGlite.create({ parsers: { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric } });
const q = async (sql: string, params?: unknown[]) => {
  const r = await pg.query(sql, params as any);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
(pool as any).query = q;
(pool as any).connect = async () => ({ query: q, release: () => {} });
await pg.exec(`
  create table formularios (id uuid primary key default gen_random_uuid(), codigo text, titulo text, estado text, definicion jsonb, vinculo jsonb, proyecto_id uuid);
  create table formulario_respuestas (
    id uuid primary key default gen_random_uuid(), formulario_id uuid, es_prueba boolean, respuestas jsonb not null, resultado jsonb not null, califica boolean,
    nombre text, telefono text, device_token text, duracion_seg int, created_at timestamptz not null default now(),
    n bigint generated by default as identity
  );
`);
const filtro = async (codigo: string, estado: string, def: Definicion) =>
  (await pg.query<{ id: string }>(`insert into formularios (codigo, titulo, estado, definicion) values ($1, 'Filtro de prueba', $2, $3::jsonb) returning id`, [codigo, estado, JSON.stringify(def)])).rows[0].id;
await filtro('conaviso', 'en_vivo', conInicioGuardado());
await filtro('sinaviso', 'prueba', normal());
await filtro('borr', 'borrador', normal());

const ctx = { user: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone; Prueba)' } as any;
const enviar = (codigo: string, respuestas: Respuestas) => submitFormularioRespuesta.run({ codigo, respuestas }, ctx) as Promise<{ ok: boolean }>;
const ultima = async () => (await pg.query<{ respuestas: Respuestas; resultado: Resultado }>(`select respuestas, resultado from formulario_respuestas order by n desc limit 1`)).rows[0];
const cuantas = async () => Number((await pg.query<{ n: string }>(`select count(*) as n from formulario_respuestas`)).rows[0].n);
const COMPLETA: Respuestas = { [ID_AVISO]: 'acepto', [ID_NOMBRE]: 'Ana Prueba', hub_id_acepta: 'si', p1: 'si' };

await prueba('la página pública entrega el aviso primero y el acuerdo al final, también de un filtro que no los traía guardados', async () => {
  for (const codigo of ['sinaviso', 'conaviso']) {
    const r: any = await getFormularioPublico.run({ codigo }, { user: null } as any);
    const ids = (r.definicion as Definicion).secciones.map((s) => s.id);
    assert.equal(ids[0], SECCION_AVISO, codigo);
    assert.equal(ids[ids.length - 1], SECCION_ACUERDO, codigo);
  }
  assert.equal(((await getFormularioPublico.run({ codigo: 'borr' }, { user: null } as any)) as any).found, false);
});

await prueba('no se recibe una respuesta que no pasó por el aviso (ni siquiera para decir que no)', async () => {
  const antes = await cuantas();
  for (const codigo of ['conaviso', 'sinaviso']) {
    await assert.rejects(() => enviar(codigo, { p1: 'si', [ID_ACUERDO]: 'acepto' }), (e: any) => /Falta aceptar el aviso de privacidad/.test(e.message));
  }
  assert.equal(await cuantas(), antes);
});

await prueba('quien dice «No acepto» al aviso sí queda registrado, terminado ahí y sin constancia del acuerdo', async () => {
  await enviar('sinaviso', { [ID_AVISO]: 'no_acepto' });
  const r = await ultima();
  assert.deepEqual(r.resultado.terminado, { motivo: 'No aceptó el aviso de privacidad', clave: ID_AVISO });
  assert.equal(r.resultado.acuerdo, undefined);
});

await prueba('una respuesta completa sin el acuerdo aceptado no se recibe', async () => {
  const antes = await cuantas();
  for (const codigo of ['conaviso', 'sinaviso']) {
    await assert.rejects(() => enviar(codigo, { ...COMPLETA }), (e: any) => /Falta aceptar el acuerdo de confidencialidad/.test(e.message));
  }
  assert.equal(await cuantas(), antes);
});

await prueba('con el aviso y el acuerdo aceptados se recibe y queda la constancia: versión, huella del texto, cuándo y desde qué dispositivo', async () => {
  for (const codigo of ['conaviso', 'sinaviso']) {
    const desde = Date.now();
    await enviar(codigo, { ...COMPLETA, [ID_ACUERDO]: 'acepto' });
    const { resultado, respuestas } = await ultima();
    assert.equal(respuestas[ID_ACUERDO], 'acepto');
    const a = resultado.acuerdo!;
    assert.equal(a.version, ACUERDO_VERSION);
    assert.equal(a.hash, crypto.createHash('sha256').update(acuerdoEnTexto()).digest('hex'));
    assert.ok(Math.abs(new Date(a.at).getTime() - desde) < 60_000, 'la hora de la aceptación es la de ahora');
    assert.equal(a.ip, '203.0.113.9');
    assert.match(a.dispositivo ?? '', /Mozilla\/5\.0 \(iPhone/);
    assert.equal(resultado.terminado, undefined);
  }
});

await prueba('quien dice «No acepto» al acuerdo al final queda registrado, terminado ahí y sin constancia de aceptación', async () => {
  await enviar('conaviso', { ...COMPLETA, [ID_ACUERDO]: 'no_acepto' });
  const r = await ultima();
  assert.deepEqual(r.resultado.terminado, { motivo: 'No aceptó el acuerdo de confidencialidad', clave: ID_ACUERDO });
  assert.equal(r.resultado.acuerdo, undefined);
});

await prueba('quien se corta antes por otro criterio (aceptó el aviso) se recibe sin acuerdo: nunca llegó al final', async () => {
  await enviar('sinaviso', { [ID_AVISO]: 'acepto', p1: 'no' });
  const r = await ultima();
  assert.equal(r.resultado.terminado?.motivo, 'Casa rentada');
  assert.equal(r.resultado.acuerdo, undefined);
});

await prueba('un borrador sigue sin recibir respuestas', async () => {
  await assert.rejects(() => enviar('borr', { ...COMPLETA, [ID_ACUERDO]: 'acepto' }), (e: any) => /ya no recibe respuestas/.test(e.message));
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
