// Pruebas de la comprobación del NDA contra la identificación (src/serverUtils/nda/identificacion.ts): el nombre con que firmó contra el que la IA ya leyó de la identificación, y la firma del NDA
// contra la de la identificación (IA, solo orientativa). Contra una base en memoria (PGlite) con el esquema real; Storage y la IA van simulados. Datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-nda-identificacion.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';
import { cajaValida, comprobarIdentificacion, type ComparacionIA, type DepsIdentificacion } from '../../src/serverUtils/nda/identificacion';
import { nombreCoincide } from '../../src/serverUtils/formularios/identificacion';
import { origenRespuesta } from '../../src/serverUtils/formularios/reclutamiento';
import checkNDAIdentificacion from '../../src/api/checkNDAIdentificacion';

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
await pg.exec(
  fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
    .replace(/create extension if not exists pg_trgm;.*/g, '')
    .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
);
// Las tablas de Filtros se crean aparte (server/scripts/add-formularios-tables.ts); aquí solo las columnas que lee la comprobación.
await pg.exec(`
  create table formularios (id uuid primary key default gen_random_uuid(), titulo text);
  create table formulario_respuestas (id uuid primary key default gen_random_uuid(), formulario_id uuid, respuestas jsonb not null, resultado jsonb not null);
`);

// ── Imágenes inventadas: la firma del NDA (trazo sobre fondo transparente) y la foto de una «identificación» (un rectángulo oscuro donde iría la firma) ──
const firmaNda = await sharp({ create: { width: 400, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="150"><path d="M20 100 C 80 20, 120 140, 200 60 S 320 120, 380 40" stroke="#111" stroke-width="6" fill="none"/></svg>') }])
  .png().toBuffer();
const FIRMA_B64 = firmaNda.toString('base64');
const fotoId = await sharp({ create: { width: 1000, height: 640, channels: 3, background: '#e8e2d0' } })
  .composite([{ input: await sharp({ create: { width: 300, height: 100, channels: 3, background: '#222222' } }).png().toBuffer(), left: 550, top: 460 }])
  .jpeg().toBuffer();

// ── Datos inventados: cuatro personas ─────────────────────────────────────────────────────────────
const respuesta = async (respuestas: object, resultado: object) =>
  (await pg.query<{ id: string }>(`insert into formulario_respuestas (respuestas, resultado) values ($1::jsonb, $2::jsonb) returning id`, [JSON.stringify(respuestas), JSON.stringify(resultado)])).rows[0].id;
const fila = async (nombre: string, sourceForm: string | null) =>
  (await pg.query<{ id: string }>(`insert into recruitment_rows (participant_name, email, project_code, board_name, source_form) values ($1, $2, 'PRY-001', 'TABLERO A', $3) returning id`, [nombre, `${nombre.toLowerCase().replace(/\s/g, '.')}@ejemplo.test`, sourceForm])).rows[0].id;
const envio = async (filaId: string, o: { estado?: string; nombreFirmado?: string | null; firma?: boolean; token: string }) =>
  (await pg.query<{ id: string }>(
    `insert into nda_envios (token, recruitment_row_id, project_code, nombre, correo, estado, firmado_at, nombre_firmado, firma_png, ip, user_agent)
     values ($1, $2, 'PRY-001', 'Nombre', 'envio@ejemplo.test', $3, $4, $5, $6, '203.0.113.7', 'DISPOSITIVO-SECRETO') returning id`,
    [o.token, filaId, o.estado ?? 'firmado', (o.estado ?? 'firmado') === 'firmado' ? '2026-11-05T17:00:00Z' : null, o.nombreFirmado ?? null, o.firma === false ? null : FIRMA_B64],
  )).rows[0].id;

const RUTA = 'respuestas/secreto/foto-identificacion.jpg';
const rA = await respuesta({ hub_id_foto: [{ ruta: RUTA, nombre: 'foto.jpg' }] }, { identificacion: { nombre: 'MARIA DE LOS ANGELES LOPEZ GARCIA', tipo: 'INE', alertas: [] } });
const rB = await respuesta({ otra: 'sin foto' }, { identificacion: { nombre: 'ALGUIEN' } });
const rD = await respuesta({ hub_id_foto: [{ ruta: RUTA, nombre: 'foto.jpg' }] }, { identificacion: { tipo: 'otra', alertas: ['No se alcanza a leer la identificación'] } });
const filaA = await fila('Maria Lopez', origenRespuesta('Filtro de prueba', rA));
const filaB = await fila('Persona Sin Foto', origenRespuesta('Filtro de prueba', rB));
const filaC = await fila('Persona De Fillout', null);
const filaD = await fila('Persona Ilegible', origenRespuesta('Filtro de prueba', rD));
const filaE = await fila('Juan Perez', origenRespuesta('Filtro de prueba', rA)); // misma identificación, otro nombre firmado: para el caso «distinto»

const eA = await envio(filaA, { nombreFirmado: 'María López', token: 'TOKEN-SECRETO-A' });
const eB = await envio(filaB, { nombreFirmado: 'Persona Sin Foto', token: 'TOKEN-SECRETO-B' });
const eC = await envio(filaC, { nombreFirmado: 'Persona De Fillout', token: 'TOKEN-SECRETO-C' });
const eD = await envio(filaD, { nombreFirmado: 'Persona Ilegible', token: 'TOKEN-SECRETO-D' });
const eE = await envio(filaE, { nombreFirmado: 'Juan Pérez', token: 'TOKEN-SECRETO-E' });
const ePendiente = await envio(filaA, { estado: 'enviado', token: 'TOKEN-SECRETO-P' });
const eSinFirma = await envio(filaA, { nombreFirmado: 'María López', firma: false, token: 'TOKEN-SECRETO-S' });

// ── IA y Storage falsos ───────────────────────────────────────────────────────────────────────────
let descargas: string[] = [];
let comparaciones: { firma: Buffer; identificacion: Buffer }[] = [];
let iaLista = true;
const deps = (respuestaIA: ComparacionIA | Error): DepsIdentificacion => ({
  iaDisponible: () => iaLista,
  descargarFoto: async (ruta) => { descargas.push(ruta); return fotoId; },
  comparar: async (a) => { comparaciones.push(a); if (respuestaIA instanceof Error) throw respuestaIA; return respuestaIA; },
});
const reiniciar = () => { descargas = []; comparaciones = []; iaLista = true; };
const parecidas: ComparacionIA = { firmaEnIdentificacion: true, caja: [0.55, 0.72, 0.85, 0.88], veredicto: 'parecidas', comentario: 'Los dos trazos empiezan con una curva amplia y terminan en una línea ascendente.' };
const datosDe = (url: string | undefined) => { assert.ok(url, 'falta la imagen'); const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(url); assert.ok(m, 'no es un data URL de imagen'); return { tipo: m[1], buf: Buffer.from(m[2], 'base64') }; };
const instantanea = async () => JSON.stringify([
  (await pg.query(`select id, estado, nombre_firmado, firma_png from nda_envios order by n`)).rows,
  (await pg.query(`select id, source_form, participant_name from recruitment_rows order by id`)).rows,
  (await pg.query(`select id, respuestas, resultado from formulario_respuestas order by id`)).rows,
]);

await prueba('mientras no firme no hay nada que comparar', async () => {
  reiniciar();
  const r = await comprobarIdentificacion(ePendiente, { conFirma: true }, deps(parecidas));
  assert.deepEqual(r, { disponible: false, motivo: 'Todavía no firma el acuerdo.' });
  assert.equal(descargas.length + comparaciones.length, 0);
});

await prueba('quien no llegó por un filtro del Hub no tiene identificación guardada, y se dice por qué', async () => {
  reiniciar();
  const r = await comprobarIdentificacion(eC, {}, deps(parecidas));
  assert.equal(r.disponible, false);
  assert.match(r.motivo ?? '', /filtro del Hub/);
  assert.equal(r.nombreFirmado, 'Persona De Fillout');
});

await prueba('quien llegó por un filtro pero no subió la foto tampoco', async () => {
  const r = await comprobarIdentificacion(eB, {}, deps(parecidas));
  assert.deepEqual([r.disponible, r.motivo], [false, 'No subió identificación.']);
});

await prueba('el nombre con que firmó coincide con el de la identificación aunque esta traiga más nombres y apellidos (sin acentos ni mayúsculas)', async () => {
  reiniciar();
  const r = await comprobarIdentificacion(eA, {}, deps(parecidas));
  assert.deepEqual([r.disponible, r.nombre, r.nombreFirmado, r.nombreIdentificacion], [true, 'coincide', 'María López', 'MARIA DE LOS ANGELES LOPEZ GARCIA']);
  assert.equal(r.firma, undefined);
});

await prueba('si el nombre firmado no está en la identificación sale «distinto»', async () => {
  const r = await comprobarIdentificacion(eE, {}, deps(parecidas));
  assert.equal(r.nombre, 'distinto');
});

await prueba('si la IA no alcanzó a leer el nombre de la identificación sale «sin dato» (y todavía se puede comparar la firma)', async () => {
  const r = await comprobarIdentificacion(eD, {}, deps(parecidas));
  assert.deepEqual([r.disponible, r.nombre, r.nombreIdentificacion], [true, 'sin-dato', undefined]);
});

await prueba('comparar solo el nombre no llama a la IA ni baja la foto', async () => {
  reiniciar();
  await comprobarIdentificacion(eA, {}, deps(parecidas));
  await comprobarIdentificacion(eE, { conFirma: false }, deps(parecidas));
  assert.equal(descargas.length + comparaciones.length, 0);
});

await prueba('con la firma: la IA recibe la firma del NDA sobre fondo blanco y la foto reducida, en ese orden', async () => {
  reiniciar();
  await comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas));
  assert.deepEqual(descargas, [RUTA]);
  assert.equal(comparaciones.length, 1);
  const { firma, identificacion } = comparaciones[0];
  const mf = await sharp(firma).metadata();
  assert.equal(mf.format, 'png');
  assert.equal(mf.hasAlpha, false, 'la firma debe ir sobre fondo blanco, no transparente');
  const { data } = await sharp(firma).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([data[0], data[1], data[2]], [255, 255, 255], 'la esquina de la firma debe ser blanca');
  assert.ok(data.some((v) => v < 60), 'el trazo oscuro debe seguir ahí');
  const mi = await sharp(identificacion).metadata();
  assert.equal(mi.format, 'jpeg');
  assert.ok((mi.width ?? 0) <= 1600 && (mi.height ?? 0) <= 1600);
});

await prueba('devuelve el veredicto y la frase de la IA, la firma del NDA y el recorte de la firma de la identificación', async () => {
  reiniciar();
  const r = await comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas));
  assert.equal(r.firma?.veredicto, 'parecidas');
  assert.equal(r.firma?.comentario, parecidas.comentario);
  const nda = datosDe(r.firma?.firmaNda);
  assert.equal(nda.tipo, 'image/png');
  const recorte = datosDe(r.firma?.firmaIdentificacion);
  assert.equal(recorte.tipo, 'image/jpeg');
  const m = await sharp(recorte.buf).metadata();
  // la caja mide 300 × 102 px de una foto de 1000 × 640; con el margen sale cerca de 390 × 153
  assert.ok((m.width ?? 0) > 330 && (m.width ?? 0) < 460, `ancho del recorte: ${m.width}`);
  assert.ok((m.height ?? 0) > 110 && (m.height ?? 0) < 200, `alto del recorte: ${m.height}`);
});

await prueba('el recorte de verdad trae la parte oscura donde estaba la firma de la identificación', async () => {
  const r = await comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas));
  const { data, info } = await sharp(datosDe(r.firma?.firmaIdentificacion).buf).raw().toBuffer({ resolveWithObject: true });
  let oscuros = 0;
  for (let i = 0; i < data.length; i += info.channels) if (data[i] < 80) oscuros++;
  assert.ok(oscuros / (info.width * info.height) > 0.4, 'más de 40 % del recorte debería ser el rectángulo oscuro');
});

await prueba('si la IA dice que no se ve la firma en la identificación, el veredicto es «no concluyente» y no hay recorte', async () => {
  const r = await comprobarIdentificacion(eA, { conFirma: true }, deps({ firmaEnIdentificacion: false, caja: null, veredicto: 'parecidas', comentario: '' }));
  assert.equal(r.firma?.veredicto, 'no_concluyente');
  assert.equal(r.firma?.firmaIdentificacion, undefined);
  assert.match(r.firma?.comentario ?? '', /No se alcanza a ver la firma/);
  assert.ok(r.firma?.firmaNda, 'la firma del NDA se sigue mostrando');
});

await prueba('una caja que no sirve (casi toda la foto, muy chica o rara) no recorta, pero el veredicto se conserva', async () => {
  for (const caja of [[0, 0, 1, 1], [0.5, 0.5, 0.51, 0.505], [0.9, 0.9, 0.2, 0.2], [Number.NaN, 0, 1, 1]]) {
    const r = await comprobarIdentificacion(eA, { conFirma: true }, deps({ ...parecidas, caja, veredicto: 'distintas' }));
    assert.equal(r.firma?.veredicto, 'distintas');
    assert.equal(r.firma?.firmaIdentificacion, undefined, `no debería recortar con ${JSON.stringify(caja)}`);
  }
});

await prueba('si la IA contesta la caja en píxeles de la foto, se pasa a fracciones y se recorta igual', async () => {
  const r = await comprobarIdentificacion(eA, { conFirma: true }, deps({ ...parecidas, caja: [550, 460, 850, 560] }));
  const m = await sharp(datosDe(r.firma?.firmaIdentificacion).buf).metadata();
  assert.ok((m.width ?? 0) > 330 && (m.width ?? 0) < 460, `ancho del recorte: ${m.width}`);
});

await prueba('un error raro de la IA no le muestra a nadie el detalle técnico; uno que ya trae su mensaje claro se conserva', async () => {
  await assert.rejects(() => comprobarIdentificacion(eA, { conFirma: true }, deps(new Error('boom 500 api-key secreta'))), (e: any) => e.message === 'No se pudo comparar con la IA. Inténtalo de nuevo.' && !/secreta/.test(e.message));
  const { ZiteError } = await import('../compat');
  await assert.rejects(() => comprobarIdentificacion(eA, { conFirma: true }, deps(new ZiteError({ code: 'INTERNAL_ERROR', message: 'La IA no tiene saldo.' }))), (e: any) => e.message === 'La IA no tiene saldo.');
});

await prueba('si no se puede abrir la foto o no hay IA, lo dice con palabras claras', async () => {
  const sinFoto: DepsIdentificacion = { ...deps(parecidas), descargarFoto: async () => { throw new Error('storage caído: token secreto'); } };
  await assert.rejects(() => comprobarIdentificacion(eA, { conFirma: true }, sinFoto), (e: any) => e.message === 'No se pudo abrir la foto de la identificación.');
  iaLista = false;
  await assert.rejects(() => comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas)), (e: any) => e.message === 'La IA no está disponible por ahora.');
  iaLista = true;
});

await prueba('un acuerdo firmado sin la firma guardada no se compara', async () => {
  await assert.rejects(() => comprobarIdentificacion(eSinFirma, { conFirma: true }, deps(parecidas)), (e: any) => /no tiene la firma guardada/.test(e.message));
});

await prueba('solo sale lo necesario: nada de la ruta de la foto, el correo del envío, la IP, el dispositivo ni la liga', async () => {
  const r = await comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas));
  const texto = JSON.stringify(r);
  for (const secreto of ['foto-identificacion', 'respuestas/secreto', 'envio@ejemplo.test', '203.0.113.7', 'DISPOSITIVO-SECRETO', 'TOKEN-SECRETO', 'ejemplo.test']) assert.ok(!texto.includes(secreto), `salió «${secreto}»`);
  assert.deepEqual(Object.keys(r).sort(), ['disponible', 'firma', 'nombre', 'nombreFirmado', 'nombreIdentificacion']);
  assert.deepEqual(Object.keys(r.firma!).sort(), ['comentario', 'firmaIdentificacion', 'firmaNda', 'veredicto']);
});

await prueba('comparar es de solo lectura: no cambia nada en la base', async () => {
  const antes = await instantanea();
  await comprobarIdentificacion(eA, { conFirma: true }, deps(parecidas));
  await comprobarIdentificacion(eE, {}, deps(parecidas));
  await comprobarIdentificacion(eC, {}, deps(parecidas));
  assert.equal(await instantanea(), antes);
});

await prueba('un envío que no existe da «no encontré ese acuerdo»', async () => {
  await assert.rejects(() => comprobarIdentificacion('00000000-0000-4000-8000-000000000000', {}, deps(parecidas)), (e: any) => /No encontré ese acuerdo/.test(e.message));
});

const equipo = { user: { id: 'u1', email: 'ana@ejemplo.test' } } as any;
const anonimo = { user: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Prueba)' } as any;

await prueba('el endpoint pide sesión: sin iniciar sesión se rechaza', async () => {
  await assert.rejects(() => checkNDAIdentificacion.run({ envioId: eA }, anonimo) as Promise<unknown>, (e: any) => e.code === 'UNAUTHORIZED' || /Sesión/.test(e.message));
});

await prueba('el endpoint con sesión compara el nombre y valida lo que entra', async () => {
  const r: any = await checkNDAIdentificacion.run({ envioId: eA }, equipo);
  assert.deepEqual([r.disponible, r.nombre], [true, 'coincide']);
  await assert.rejects(() => checkNDAIdentificacion.run({ envioId: 'no-es-un-uuid' }, equipo) as Promise<unknown>);
});

await prueba('el prefijo con que se reconoce una fila de un filtro del Hub es el mismo que escribe el Hub al pasar una respuesta', () => {
  assert.ok(origenRespuesta('Un título', 'abc').startsWith('Formulario Hub · '));
});

await prueba('cajaValida: fracciones válidas, píxeles pasados a fracciones y lo demás descartado', () => {
  assert.deepEqual(cajaValida([0.1, 0.2, 0.4, 0.3], 1000, 600), [0.1, 0.2, 0.4, 0.3]);
  assert.deepEqual(cajaValida([100, 120, 400, 180], 1000, 600), [0.1, 0.2, 0.4, 0.3]);
  assert.equal(cajaValida(null, 1000, 600), null);
  assert.equal(cajaValida([0, 0, 1, 1], 1000, 600), null);
  assert.equal(cajaValida([0.1, 0.1, 0.12, 0.3], 1000, 600), null);
  assert.equal(cajaValida([0.1, 0.1, 0.4], 1000, 600), null);
  assert.equal(cajaValida([0.1, 0.2, 0.4, 0.3], 0, 0), null);
});

await prueba('nombreCoincide: dos palabras en común (o la única), sin acentos ni mayúsculas', () => {
  assert.equal(nombreCoincide('Ana López', 'ANA MARÍA LÓPEZ GARCÍA'), true);
  assert.equal(nombreCoincide('Ana', 'ANA MARIA LOPEZ'), true);
  assert.equal(nombreCoincide('Ana Pérez', 'ANA MARIA LOPEZ GARCIA'), false);
  assert.equal(nombreCoincide('Juan Pérez', 'MARIA LOPEZ'), false);
  assert.equal(nombreCoincide('Li', 'MARIA LOPEZ'), true); // sin palabras que comparar no hay motivo para dudar
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
