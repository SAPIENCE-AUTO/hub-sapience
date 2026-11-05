// Pruebas del NDA de participantes con firma (docs/nda.md), contra una base en memoria (PGlite) con el esquema real y el SQL real de server/scripts/add-nda-tables.ts.
// Lo que cuidan: el texto del acuerdo palabra por palabra como el original; que el correo lleve la liga personal y el nombre salga de la fila (sin poder meter HTML); que no se mande nada sin nombre,
// sin correo o a una fila eliminada; que el doble clic no duplique el correo; que un fallo de Outlook no deje nada a medias; el ciclo enviado → abrió → firmó | rechazó (una sola vez, aunque lleguen
// dos clics a la vez); que la firma se valide (un recuadro vacío no es firma) y se guarde con huella del texto, IP y dispositivo; que el PDF y la copia por correo salgan DESPUÉS de guardar la firma
// y, si fallan, la firma quede a salvo y el PDF se pueda rehacer; que la bitácora no se pueda editar; y un PDF real con Chrome leído de vuelta. Nada sale a internet: Graph y Storage se simulan.
// Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-nda.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

process.env.STRICT_OUTPUT = 'true';
// Un dominio de Hub de mentira: las ligas del NDA NO deben salir de ahí sino del dominio de los participantes (sharpli.mx).
process.env.ZITE_APP_URL = 'https://hub.ejemplo.test,https://otro.ejemplo.test';
delete process.env.NDA_PUBLIC_URL;

const correo = await import('../../src/serverUtils/nda/correo');
const { construirCorreoNda, construirCorreoCopia, ndaEnTexto, limpiarNombre, describirSesion, desdeHoraMx, NDA_ASUNTO, NDA_SECCIONES, NDA_TEXTO_VERSION } = correo;
const { enviarNdaDeFila, enviarPorOutlook, remitenteNda, NDA_REMITENTE_POR_DEFECTO, ErrorDeEnvio } = await import('../../src/serverUtils/nda/enviar');
const servicio = await import('../../src/serverUtils/nda/servicio');
const { depsNda, esperarTareasNda, firmarEnvio, rechazarEnvio, verEnlace, normalizarFirma, estadosDeProyecto, detalleDeFila, urlDelPdf, enlaceDe } = servicio;
const { htmlDelPdf, generarPdfNda, sha256 } = await import('../../src/serverUtils/nda/pdf');
const { GraphAuthError, resetGraphTokenCache } = await import('../microsoft/graph');
const { SQL_NDA } = await import('./add-nda-tables');
const ep = {
  enviar: (await import('../../src/api/sendNDAEmail')).default,
  publico: (await import('../../src/api/getNDAPublic')).default,
  firmar: (await import('../../src/api/signNDA')).default,
  rechazar: (await import('../../src/api/rejectNDA')).default,
  estados: (await import('../../src/api/getNDAStatuses')).default,
  detalle: (await import('../../src/api/getNDADetail')).default,
  pdf: (await import('../../src/api/getNDAPdfUrl')).default,
  boton: (await import('../../src/api/executeButtonAction')).default,
};

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
const rechaza = (fn: () => Promise<unknown>, texto: string) => assert.rejects(fn, (e: Error) => { assert.ok(e.message.includes(texto), `esperaba «${texto}» y salió «${e.message}»`); return true; });

const parsers = { [DATE_OID]: parseDate, [TIMESTAMPTZ_OID]: parseTimestamptz, [NUMERIC_OID]: parseNumeric };
const pg = await PGlite.create({ parsers });
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
// El SQL real del script (índices, bitácora que no se edita): corre encima del esquema, igual que en producción.
for (const sql of SQL_NDA) await pg.exec(sql);

const equipo = { user: { id: 'u-1', email: 'reclutador@ejemplo.test', role: 'Coordinador' } } as any;
const anonimo = { user: null, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Prueba' } as any;
const una = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params as any)).rows[0];
const todas = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params as any)).rows;

// ── Datos inventados ────────────────────────────────────────────────────────
async function fila(campos: { nombre?: string | null; fila?: string | null; correo?: string | null; borrada?: string | null; proyecto?: string; tablero?: string }) {
  const r = await una(
    `insert into recruitment_rows (participant_name, row_name, email, deleted_at, project_code, board_id) values ($1, $2, $3, $4, $5, $6) returning id`,
    [campos.nombre ?? null, campos.fila ?? null, campos.correo ?? null, campos.borrada ?? null, campos.proyecto ?? 'PRY-001', campos.tablero ?? 'tablero-1'],
  );
  return r.id as string;
}
const filaRow = async (id: string) => una(`select nda_sent, nda_sent_date::text as fecha from recruitment_rows where id = $1`, [id]);
const envios = (rowId: string) => todas(`select * from nda_envios where recruitment_row_id = $1 order by n`, [rowId]);
const eventos = async (envioId: string) => (await todas(`select tipo, ip, user_agent, detalle, actor from nda_eventos where envio_id = $1 order by n`, [envioId]));
const tipos = async (envioId: string) => (await eventos(envioId)).map((e) => e.tipo);
const envejecer = (rowId: string) => pg.query(`update recruitment_rows set nda_sent_date = now() - interval '2 minutes' where id = $1`, [rowId]);

type Salida = { desde: string; para: string; asunto: string; html: string; adjuntos?: { nombre: string; tipo: string; base64: string }[] };
function remitenteFalso(opciones: { falla?: Error } = {}) {
  const enviados: Salida[] = [];
  const enviar = async (m: Salida) => {
    if (opciones.falla) throw opciones.falla;
    enviados.push(m);
  };
  return { enviados, enviar };
}
const tokenDe = (html: string) => /\/nda\/([A-Za-z0-9_-]+)/.exec(html)![1];

/** Una firma de prueba: PNG con un trazo, vacío, un solo punto o con fondo blanco. */
async function firmaPng(tipo: 'buena' | 'vacia' | 'punto' | 'fondoBlanco' = 'buena', ancho = 600) {
  const alto = 200;
  const base = sharp({ create: { width: ancho, height: alto, channels: 4, background: tipo === 'fondoBlanco' ? { r: 255, g: 255, b: 255, alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 } } });
  const svg = tipo === 'vacia' ? null
    : tipo === 'punto' ? `<svg width="${ancho}" height="${alto}"><circle cx="300" cy="100" r="3" fill="#000"/></svg>`
    : `<svg width="${ancho}" height="${alto}"><path d="M30 120 C 80 20, 120 20, 140 110 S 200 190, 260 90 S 340 30, 400 120 S 480 160, 560 70" stroke="#0b2530" stroke-width="5" fill="none" stroke-linecap="round"/></svg>`;
  const buf = await (svg ? base.composite([{ input: Buffer.from(svg) }]) : base).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Deja listas las pruebas del ciclo de vida: reemplaza lo que toca el mundo de afuera (Chrome, Storage y correo) y devuelve lo que pasó. */
function mundoFalso(opciones: { fallaPdf?: boolean; fallaStorage?: boolean; fallaCopia?: boolean } = {}) {
  const original = { ...depsNda };
  const guardados = new Map<string, Buffer>();
  const pdfsHechos: any[] = [];
  const correos: Salida[] = [];
  depsNda.generarPdf = async (d) => {
    if (opciones.fallaPdf) throw new Error('Chrome no arrancó');
    pdfsHechos.push(d);
    return Buffer.from(`%PDF-falso ${d.envioId} ${d.nombre}`);
  };
  depsNda.almacen = {
    subir: async (ruta, data) => { if (opciones.fallaStorage) throw new Error('Storage caído'); guardados.set(ruta, data); },
    urlFirmada: async (ruta, seg) => `https://almacen.ejemplo.test/nda/${ruta}?firmada=${seg}`,
  };
  depsNda.enviarCorreo = async (m) => { if (opciones.fallaCopia && m.adjuntos?.length) throw new Error('Outlook caído'); correos.push(m); };
  return { guardados, pdfsHechos, correos, restaurar: () => Object.assign(depsNda, original) };
}

/** Manda el NDA a una fila nueva y devuelve su liga y su token (con un remitente falso que no sale a internet). */
async function enviado(campos: Parameters<typeof fila>[0] = { nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' }, extra: Partial<Parameters<typeof enviarNdaDeFila>[1]> = {}) {
  const id = await fila(campos);
  const f = remitenteFalso();
  const r = await enviarNdaDeFila(id, { enviar: f.enviar, por: 'reclutador@ejemplo.test', ...extra });
  assert.equal(r.enviado, true, r.mensaje);
  const token = tokenDe(f.enviados[0].html);
  return { id, token, envio: (await envios(id))[0], html: f.enviados[0].html };
}

// ═══ El texto y los correos ═════════════════════════════════════════════════
// Copia del texto que pasó Sergio (2026-11-04), sin las dos líneas de firma y fecha (las hace la página de firma y salen en el PDF), más los dos párrafos que agregó al final ese mismo día:
// la aceptación expresa de los términos y el aviso de privacidad de AGC.
const ORIGINAL = `ACUERDO DE CONFIDENCIALIDAD, CONSENTIMIENTO INFORMADO Y RESPONSIVA
Yo, ____________ (nombre completo), declaro que:
1. Confidencialidad
Me comprometo a mantener absoluta confidencialidad sobre toda la información, productos, materiales y comentarios que pueda observar o probar durante mi participación en la sesión de investigación de mercados organizada por ASESORES GLOBALES CORPORATIVOS SC (en adelante, “la Agencia”).
Entiendo que dicha información es confidencial y no podrá ser divulgada, compartida o utilizada fuera de este contexto bajo ninguna circunstancia.
2. Consentimiento informado
Declaro que he sido informado(a) de que durante la sesión tendré acceso a información confidencial que no podré compartir ni divulgar.
Reconozco que mi participación es completamente voluntaria, y acepto participar en el estudio por mi propia voluntad.
Declaraciones finales
Por la presente, confirmo que participo en esta actividad de manera consciente y voluntaria, y que he tenido la oportunidad de resolver todas las dudas relacionadas con mi participación.
Al firmar, acepto los términos y condiciones de este acuerdo y confirmo que soy mayor de edad, que lo leí y lo entendí, y que la firma que aparece aquí es mía.
Conozco el aviso de privacidad de Asesores Globales Corporativos SC, disponible en sharpli.mx/f/aviso, y acepto que se registren mi nombre, mi firma, la fecha y hora, mi dispositivo y mi dirección IP como constancia de esta firma.`;
const lineas = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

await prueba('el texto del acuerdo es el original, solo con el nombre puesto donde estaba la raya', () => {
  assert.deepEqual(lineas(ndaEnTexto('Ana Torres Ruiz')), lineas(ORIGINAL).map((l) => l.replace('____________', 'Ana Torres Ruiz')));
});

await prueba('el acuerdo termina con la aceptación expresa y el aviso de privacidad; el aviso lo cita con su dirección y la versión del texto es la nueva', () => {
  const finales = NDA_SECCIONES[NDA_SECCIONES.length - 1];
  assert.equal(finales.titulo, 'Declaraciones finales');
  const [confirmo, acepto, aviso] = finales.parrafos.slice(-3);
  assert.ok(confirmo.startsWith('Por la presente, confirmo que participo'));
  assert.equal(acepto, 'Al firmar, acepto los términos y condiciones de este acuerdo y confirmo que soy mayor de edad, que lo leí y lo entendí, y que la firma que aparece aquí es mía.');
  assert.equal(aviso, 'Conozco el aviso de privacidad de Asesores Globales Corporativos SC, disponible en sharpli.mx/f/aviso, y acepto que se registren mi nombre, mi firma, la fecha y hora, mi dispositivo y mi dirección IP como constancia de esta firma.');
  assert.ok(ndaEnTexto('Ana Torres Ruiz').trimEnd().endsWith(aviso), 'lo último que se firma es el aviso');
  assert.equal(NDA_TEXTO_VERSION, '2026-11-04-2', 'si cambia el texto hay que subir la versión');
});

await prueba('el nombre se limpia: espacios dobles y saltos de línea quedan en una sola línea', () => {
  assert.equal(limpiarNombre('  Ana   Torres \n Ruiz '), 'Ana Torres Ruiz');
  assert.ok(ndaEnTexto('  Ana   Torres \n Ruiz ').includes('Yo, Ana Torres Ruiz (nombre completo), declaro que:'));
});

await prueba('el correo de invitación lleva el nombre, la liga personal (botón y texto) y nada de rayas de firma; el nombre y la liga no meten HTML', () => {
  const enlace = 'https://hub.ejemplo.test/nda/abc_DEF-123?x=1&y=2';
  const { asunto, html } = construirCorreoNda('Ana Torres Ruiz', enlace);
  assert.equal(asunto, NDA_ASUNTO);
  assert.ok(html.includes('Hola Ana Torres Ruiz,'));
  assert.ok(html.includes('Leer y firmar'));
  assert.equal((html.match(/https:\/\/hub\.ejemplo\.test\/nda\/abc_DEF-123\?x=1&amp;y=2/g) ?? []).length, 3, 'la liga debe ir en el botón (href), en el texto de respaldo y en su propio href');
  assert.ok(!html.includes('____'));
  const hostil = construirCorreoNda('Ana <script>alert(1)</script> & "Luz" <img src=x onerror=1>', 'https://hub.ejemplo.test/nda/x"><script>1</script>').html;
  assert.ok(!hostil.includes('<script>') && !hostil.includes('<img src=x'));
  assert.ok(hostil.includes('Ana &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Luz&quot; &lt;img src=x onerror=1&gt;'));
});

await prueba('el correo con la copia firmada dice cuándo firmó y escapa el nombre', () => {
  const { asunto, html } = construirCorreoCopia('Ana <b>Torres</b>', '4 de noviembre de 2026, 10:42 h');
  assert.ok(asunto.includes('copia'));
  assert.ok(html.includes('Hola Ana &lt;b&gt;Torres&lt;/b&gt;,') && html.includes('4 de noviembre de 2026, 10:42 h') && html.includes('PDF adjunta'));
});

await prueba('el HTML del PDF lleva el nombre de quien firmó, todo el texto, la firma, la fecha y la constancia', () => {
  const html = htmlDelPdf({
    envioId: 'e1e1e1e1-aaaa-bbbb-cccc-000000000001', nombre: 'Ana <Torres> Ruiz', correo: 'ana@ejemplo.test', firmaPng: 'AAAA', firmadoAt: new Date('2026-11-04T16:42:00Z'),
    enviadoAt: new Date('2026-11-04T15:00:00Z'), abiertoAt: new Date('2026-11-04T16:30:00Z'), ip: '203.0.113.9', userAgent: 'Dispositivo de prueba', textoHash: 'ab'.repeat(32),
  });
  assert.ok(html.includes('Yo, <b>Ana &lt;Torres&gt; Ruiz</b> (nombre completo), declaro que:'));
  for (const s of NDA_SECCIONES) {
    assert.ok(html.includes(s.titulo));
    for (const p of s.parrafos) {
      // la dirección del aviso de privacidad sale como liga: se revisa lo de antes, lo de después y la liga
      const [antes, despues] = p.split('sharpli.mx/f/aviso');
      assert.ok(html.includes(antes) && (despues === undefined || html.includes(despues)), p.slice(0, 40));
    }
  }
  assert.ok(html.includes('<a href="https://sharpli.mx/f/aviso"'), 'la dirección del aviso debe ser una liga en el PDF');
  assert.ok(html.includes('data:image/png;base64,AAAA') && html.includes('Firma del participante: Ana &lt;Torres&gt; Ruiz'));
  assert.ok(html.includes('4 de noviembre de 2026 a las 10:42 h'), 'la fecha va en hora de la Ciudad de México (UTC-6 en noviembre)');
  assert.ok(html.includes('Constancia de firma electrónica') && html.includes('203.0.113.9') && html.includes('ab'.repeat(32)) && html.includes('ana@ejemplo.test'));
});

// ═══ La liga vive en el dominio de los participantes ════════════════════════
await prueba('la liga del NDA es del dominio de los participantes (sharpli.mx) y NDA_PUBLIC_URL la cambia (sin barra final); vacío cae al de siempre', () => {
  assert.equal(enlaceDe('abc'), 'https://sharpli.mx/nda/abc');
  process.env.NDA_PUBLIC_URL = ' http://sharpli.localhost:5173/ ';
  try { assert.equal(enlaceDe('abc'), 'http://sharpli.localhost:5173/nda/abc'); } finally { delete process.env.NDA_PUBLIC_URL; }
  process.env.NDA_PUBLIC_URL = '   ';
  try { assert.equal(enlaceDe('abc'), 'https://sharpli.mx/nda/abc'); } finally { delete process.env.NDA_PUBLIC_URL; }
});

await prueba('desde sharpli.mx el navegador solo puede llamar lo de los participantes: ver, firmar y rechazar el NDA sí; lo del equipo no', async () => {
  const { origenPermitido, FORMULARIO_ENDPOINTS, FORMULARIO_ORIGINS } = await import('../corsFormularios');
  const hub = ['https://hub.ejemplo.test'];
  const publicos = [ep.publico, ep.firmar, ep.rechazar];
  const delEquipo = [ep.enviar, ep.estados, ep.detalle, ep.pdf, ep.boton];
  for (const e of publicos) assert.equal((e as any).authenticated, false);
  for (const e of delEquipo) assert.equal((e as any).authenticated, true);
  for (const o of FORMULARIO_ORIGINS) {
    for (const nombre of ['getNDAPublic', 'signNDA', 'rejectNDA', 'getFormularioPublico', 'submitFormularioRespuesta']) assert.equal(origenPermitido(o, nombre, hub), o, `${o} → ${nombre}`);
    for (const nombre of ['sendNDAEmail', 'getNDAStatuses', 'getNDADetail', 'getNDAPdfUrl', 'executeButtonAction', 'markNDASent', 'getUsers']) assert.equal(origenPermitido(o, nombre, hub), null, `${o} → ${nombre}`);
  }
  assert.deepEqual(['getNDAPublic', 'signNDA', 'rejectNDA'].filter((x) => FORMULARIO_ENDPOINTS.has(x)), ['getNDAPublic', 'signNDA', 'rejectNDA']);
  assert.equal(origenPermitido('https://hub.ejemplo.test', 'sendNDAEmail', hub), 'https://hub.ejemplo.test', 'el front del Hub puede con todo');
  assert.equal(origenPermitido('https://otro-sitio.ejemplo.test', 'signNDA', hub), null);
  assert.equal(origenPermitido('', 'signNDA', hub), null);
});

await prueba('la página del NDA está montada en el dominio de los participantes (y también en el Hub) y en ese dominio no se menciona a Sapience', () => {
  const lee = (ruta: string) => fs.readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const solo = lee('../../src/SoloFormularios.tsx');
  assert.ok(solo.includes('path="/nda/:token"') && solo.includes("import NdaPage from './pages/NdaPage'"), 'sin la ruta, en sharpli.mx la liga diría «Este enlace no existe»');
  assert.ok(lee('../../src/App.tsx').includes('path="/nda/:token"'));
  for (const archivo of ['../../src/pages/NdaPage.tsx', '../../src/components/nda/SignaturePad.tsx', '../../src/lib/nda.ts', '../../src/SoloFormularios.tsx']) {
    assert.ok(!/sapience/i.test(lee(archivo)), `${archivo} menciona a Sapience: en sharpli.mx no debe salir`);
  }
});

// ═══ Mandar el NDA ═══════════════════════════════════════════════════════════
await prueba('manda el correo con la liga personal al correo de la fila, crea el envío y marca la fila', async () => {
  const id = await fila({ nombre: 'Ana Torres Ruiz', correo: '  ana@ejemplo.test ', proyecto: 'PRY-042', tablero: 'tablero-7' });
  const f = remitenteFalso();
  const r = await enviarNdaDeFila(id, { enviar: f.enviar, por: 'reclutador@ejemplo.test' });
  assert.equal(r.enviado, true);
  assert.equal(r.correo, 'ana@ejemplo.test');
  assert.equal(r.mensaje, 'NDA enviado a ana@ejemplo.test');
  assert.equal(f.enviados.length, 1);
  const m = f.enviados[0];
  assert.equal(m.para, 'ana@ejemplo.test');
  assert.equal(m.desde, NDA_REMITENTE_POR_DEFECTO);
  assert.equal(m.asunto, NDA_ASUNTO);
  assert.ok(m.html.includes('Hola Ana Torres Ruiz,'));
  const [e] = await envios(id);
  assert.equal(e.estado, 'enviado');
  assert.ok(e.token.length >= 40, 'el token debe ser largo (no se adivina)');
  assert.equal(e.project_code, 'PRY-042');
  assert.equal(e.board_id, 'tablero-7');
  assert.equal(e.correo, 'ana@ejemplo.test');
  assert.equal(e.nombre, 'Ana Torres Ruiz');
  assert.equal(e.enviado_por, 'reclutador@ejemplo.test');
  assert.equal(e.envios, 1);
  assert.equal(e.texto_version, NDA_TEXTO_VERSION);
  assert.ok(e.enviado_at && e.ultimo_envio_at);
  assert.equal(r.enlace, `https://sharpli.mx/nda/${e.token}`, 'la liga es del dominio de los participantes, no del Hub');
  assert.ok(m.html.includes(r.enlace!));
  assert.deepEqual(await tipos(e.id), ['enviado']);
  const f2 = await filaRow(id);
  assert.equal(f2.nda_sent, true);
  assert.ok(f2.fecha);
});

await prueba('sin nombre de participante usa el nombre de la fila (igual que la tabla) y una marca de borrado vacía cuenta como viva', async () => {
  const id = await fila({ nombre: '', fila: 'Luis Prado', correo: 'luis@ejemplo.test', borrada: '' });
  const f = remitenteFalso();
  assert.equal((await enviarNdaDeFila(id, { enviar: f.enviar })).enviado, true);
  assert.ok(f.enviados[0].html.includes('Hola Luis Prado,'));
});

await prueba('no manda nada sin nombre, sin correo, con un correo que no es correo o con varios correos, y no crea ningún envío', async () => {
  const casos: [string, Parameters<typeof fila>[0], string][] = [
    ['sin nombre', { nombre: null, fila: null, correo: 'x@ejemplo.test' }, 'Falta el nombre del participante.'],
    ['nombre en blanco', { nombre: '   ', fila: ' ', correo: 'x@ejemplo.test' }, 'Falta el nombre del participante.'],
    ['sin correo', { nombre: 'Ana', correo: null }, 'Este participante no tiene correo.'],
    ['correo en blanco', { nombre: 'Ana', correo: '  ' }, 'Este participante no tiene correo.'],
    ['correo mal escrito', { nombre: 'Ana', correo: 'ana arroba ejemplo' }, 'El correo «ana arroba ejemplo» no parece válido.'],
    ['dos correos', { nombre: 'Ana', correo: 'a@ejemplo.test, b@ejemplo.test' }, 'El correo «a@ejemplo.test, b@ejemplo.test» no parece válido.'],
  ];
  for (const [que, campos, mensaje] of casos) {
    const id = await fila(campos);
    const f = remitenteFalso();
    const r = await enviarNdaDeFila(id, { enviar: f.enviar });
    assert.equal(r.enviado, false, que);
    assert.equal(r.mensaje, mensaje, que);
    assert.equal(f.enviados.length, 0, que);
    assert.equal((await envios(id)).length, 0, `${que}: nació un envío`);
    const e = await filaRow(id);
    assert.ok(!e.nda_sent && e.fecha === null, `${que}: la fila cambió`);
  }
});

await prueba('una fila eliminada (con fecha de borrado escrita) o que no existe no recibe el NDA', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test', borrada: '2026-10-01T10:00:00.000Z' });
  const f = remitenteFalso();
  assert.equal((await enviarNdaDeFila(id, { enviar: f.enviar })).mensaje, 'Este participante está eliminado.');
  assert.equal((await enviarNdaDeFila('00000000-0000-4000-8000-000000000000', { enviar: f.enviar })).mensaje, 'No encontré a este participante.');
  assert.equal(f.enviados.length, 0);
});

await prueba('si Outlook no acepta el envío no queda nada a medias (ni envío, ni marca, ni fecha) y se puede reintentar enseguida', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  const r = await enviarNdaDeFila(id, { enviar: remitenteFalso({ falla: new ErrorDeEnvio(400, 'invalid recipient') }).enviar });
  assert.equal(r.enviado, false);
  assert.ok(r.mensaje.includes('(400)') && r.mensaje.includes('bien escrito'), r.mensaje);
  assert.equal((await envios(id)).length, 0, 'quedó un envío que nunca salió');
  const e = await filaRow(id);
  assert.ok(!e.nda_sent && e.fecha === null);
  assert.equal((await enviarNdaDeFila(id, { enviar: remitenteFalso().enviar })).enviado, true);
});

await prueba('si falta configurar Outlook o no hay red, el mensaje es claro y todo queda igual', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  assert.equal((await enviarNdaDeFila(id, { enviar: remitenteFalso({ falla: new GraphAuthError('Falta la variable de entorno MS_TENANT_ID') }).enviar })).mensaje, 'No se pudo mandar el NDA: falta configurar Outlook en el servidor.');
  assert.equal((await enviarNdaDeFila(id, { enviar: remitenteFalso({ falla: new TypeError('fetch failed') }).enviar })).mensaje, 'No se pudo conectar con Outlook. Inténtalo de nuevo.');
  assert.equal((await envios(id)).length, 0);
  assert.ok(!(await filaRow(id)).nda_sent);
});

await prueba('dos clics casi juntos mandan un solo correo y crean un solo envío', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  const f = remitenteFalso();
  const [a, b] = await Promise.all([enviarNdaDeFila(id, { enviar: f.enviar }), enviarNdaDeFila(id, { enviar: f.enviar })]);
  assert.equal(f.enviados.length, 1, 'salieron dos correos');
  assert.deepEqual([a.enviado, b.enviado].sort(), [false, true]);
  const rechazado = a.enviado ? b : a;
  assert.equal(rechazado.yaEnviado, true);
  assert.ok(rechazado.mensaje.includes('espera un minuto'));
  assert.equal((await envios(id)).length, 1);
  assert.equal((await enviarNdaDeFila(id, { enviar: f.enviar })).yaEnviado, true, 'un tercer clic enseguida tampoco');
});

await prueba('reenviar un envío pendiente usa la MISMA liga, cuenta el reenvío y no borra que ya la abrió', async () => {
  const { id, token, envio } = await enviado();
  await verEnlace(token, { ip: '203.0.113.9' });
  await envejecer(id);
  const f = remitenteFalso();
  const r = await enviarNdaDeFila(id, { enviar: f.enviar, por: 'otra@ejemplo.test' });
  assert.equal(r.enviado, true);
  assert.equal(tokenDe(f.enviados[0].html), token, 'cambió la liga');
  const lista = await envios(id);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].id, envio.id);
  assert.equal(lista[0].envios, 2);
  assert.equal(lista[0].estado, 'abierto');
  assert.deepEqual(await tipos(envio.id), ['enviado', 'abierto', 'reenviado']);
});

await prueba('una persona que ya firmó o rechazó no recibe otro NDA a menos que se pida «nuevo» (y entonces nace un envío con liga nueva)', async () => {
  const mundo = mundoFalso();
  try {
    const a = await enviado();
    await firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma: await firmaPng(), acepta: true });
    await esperarTareasNda();
    await envejecer(a.id);
    const f = remitenteFalso();
    const sinPedir = await enviarNdaDeFila(a.id, { enviar: f.enviar });
    assert.equal(sinPedir.enviado, false);
    assert.ok(sinPedir.mensaje.startsWith('Esta persona ya firmó el NDA el 4 de noviembre') || /^Esta persona ya firmó el NDA el \d/.test(sinPedir.mensaje), sinPedir.mensaje);
    assert.equal(f.enviados.length, 0);
    const nuevo = await enviarNdaDeFila(a.id, { enviar: f.enviar, nuevo: true });
    assert.equal(nuevo.enviado, true);
    assert.notEqual(tokenDe(f.enviados[0].html), a.token);
    assert.equal((await envios(a.id)).length, 2);

    const b = await enviado({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test' });
    await rechazarEnvio(b.token, 'No tengo tiempo');
    await envejecer(b.id);
    const g = remitenteFalso();
    const r2 = await enviarNdaDeFila(b.id, { enviar: g.enviar });
    assert.ok(r2.mensaje.startsWith('Esta persona rechazó el NDA el '), r2.mensaje);
    assert.equal((await enviarNdaDeFila(b.id, { enviar: g.enviar, nuevo: true })).enviado, true);
  } finally { mundo.restaurar(); }
});

await prueba('si las tablas del NDA todavía no existen avisa claro, no manda nada y deja la fila intacta', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  await pg.exec(`alter table nda_envios rename to nda_envios_x`);
  try {
    const f = remitenteFalso();
    const r = await enviarNdaDeFila(id, { enviar: f.enviar });
    assert.equal(r.enviado, false);
    assert.ok(r.mensaje.startsWith('Faltan crear las tablas del NDA'), r.mensaje);
    assert.equal(f.enviados.length, 0);
    assert.ok(!(await filaRow(id)).nda_sent);
    const est: any = await ep.estados.run({ projectCode: 'PRY-001' }, equipo);
    assert.deepEqual(est, { items: [] }, 'la tabla debe seguir funcionando sin estados');
  } finally { await pg.exec(`alter table nda_envios_x rename to nda_envios`); }
});

// ═══ La petición real a Graph (con un fetch falso: no sale nada a internet) ═══
const fetchOriginal = globalThis.fetch;
type Llamada = { url: string; metodo: string; autorizacion: string | null; cuerpo: any };
function graphFalso(respuestaCorreo: () => Response) {
  const llamadas: Llamada[] = [];
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url);
    if (u.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'token-falso', expires_in: 3600 }), { status: 200 });
    const h = new Headers(init.headers ?? {});
    llamadas.push({ url: u, metodo: init.method ?? 'GET', autorizacion: h.get('Authorization'), cuerpo: init.body ? JSON.parse(init.body) : null });
    return respuestaCorreo();
  }) as typeof fetch;
  return llamadas;
}
const ENV_GRAPH = { MS_TENANT_ID: 'tenant-prueba', MS_CLIENT_ID: 'cliente-prueba', MS_CLIENT_SECRET: 'secreto-prueba', MS_SEND_AS_EMAIL: 'compras@ejemplo.test' };
function conGraph<T>(fn: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(ENV_GRAPH).map((k) => [k, process.env[k]]));
  Object.assign(process.env, ENV_GRAPH);
  resetGraphTokenCache();
  return fn().finally(() => {
    for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    globalThis.fetch = fetchOriginal;
    resetGraphTokenCache();
  });
}

await prueba('la petición a Graph sale del buzón de sesiones, al correo de la fila, con la liga y copia en «Enviados»', () => conGraph(async () => {
  const llamadas = graphFalso(() => new Response(null, { status: 202 }));
  const id = await fila({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' });
  const r = await enviarNdaDeFila(id); // sin remitente falso: pasa por enviarPorOutlook de verdad
  assert.equal(r.enviado, true);
  assert.equal(llamadas.length, 1);
  const [l] = llamadas;
  assert.equal(l.url, 'https://graph.microsoft.com/v1.0/users/sesiones%40sapience.com.mx/sendMail');
  assert.equal(l.metodo, 'POST');
  assert.equal(l.autorizacion, 'Bearer token-falso');
  assert.equal(l.cuerpo.saveToSentItems, true);
  assert.equal(l.cuerpo.message.subject, NDA_ASUNTO);
  assert.equal(l.cuerpo.message.body.contentType, 'HTML');
  assert.ok(l.cuerpo.message.body.content.includes(r.enlace));
  assert.deepEqual(l.cuerpo.message.toRecipients, [{ emailAddress: { address: 'ana@ejemplo.test' } }]);
  assert.equal(l.cuerpo.message.attachments, undefined);
}));

await prueba('un adjunto sale como fileAttachment de Graph; si Graph responde 400 el envío no queda y el mensaje trae el código', () => conGraph(async () => {
  const llamadas = graphFalso(() => new Response(null, { status: 202 }));
  await enviarPorOutlook({ desde: 'sesiones@sapience.com.mx', para: 'ana@ejemplo.test', asunto: 'a', html: '<p>a</p>', adjuntos: [{ nombre: 'copia.pdf', tipo: 'application/pdf', base64: 'QUJD' }] });
  assert.deepEqual(llamadas[0].cuerpo.message.attachments, [{ '@odata.type': '#microsoft.graph.fileAttachment', name: 'copia.pdf', contentType: 'application/pdf', contentBytes: 'QUJD' }]);
  graphFalso(() => new Response('{"error":{"code":"ErrorInvalidRecipients"}}', { status: 400 }));
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  const r = await enviarNdaDeFila(id);
  assert.equal(r.enviado, false);
  assert.ok(r.mensaje.includes('(400)'), r.mensaje);
  assert.equal((await envios(id)).length, 0);
  graphFalso(() => new Response('no', { status: 429 }));
  await assert.rejects(() => enviarPorOutlook({ desde: 'sesiones@sapience.com.mx', para: 'a@ejemplo.test', asunto: 'a', html: 'a' }), (e: any) => e instanceof ErrorDeEnvio && e.status === 429);
}));

await prueba('el buzón de salida se puede cambiar con NDA_SEND_AS_EMAIL y por defecto es el de sesiones', async () => {
  delete process.env.NDA_SEND_AS_EMAIL;
  assert.equal(remitenteNda(), 'sesiones@sapience.com.mx');
  process.env.NDA_SEND_AS_EMAIL = ' nda@ejemplo.test ';
  try {
    const f = remitenteFalso();
    await enviarNdaDeFila(await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' }), { enviar: f.enviar });
    assert.equal(f.enviados[0].desde, 'nda@ejemplo.test');
  } finally { delete process.env.NDA_SEND_AS_EMAIL; }
});

// ═══ La liga de la persona: abrir, firmar, rechazar ═════════════════════════
await prueba('abrir la liga la primera vez deja constancia (estado «abierto», una sola vez, con IP y dispositivo) y muestra el texto con su nombre', async () => {
  const { token, envio } = await enviado();
  const v1: any = await ep.publico.run({ token }, anonimo);
  assert.equal(v1.estado, 'pendiente');
  assert.equal(v1.nombre, 'Ana Torres Ruiz');
  assert.equal(v1.texto.version, NDA_TEXTO_VERSION);
  assert.equal(v1.texto.aperturaAntes + '____' + v1.texto.aperturaDespues, 'Yo, ____ (nombre completo), declaro que:');
  assert.deepEqual(v1.texto.secciones.map((s: any) => s.titulo), NDA_SECCIONES.map((s) => s.titulo));
  await ep.publico.run({ token }, anonimo);
  const [e] = await envios(envio.recruitment_row_id);
  assert.equal(e.estado, 'abierto');
  assert.ok(e.abierto_at);
  const ev = await eventos(envio.id);
  assert.deepEqual(ev.map((x) => x.tipo), ['enviado', 'abierto'], 'la segunda visita no debe repetir el evento');
  assert.equal(ev[1].ip, '203.0.113.9');
  assert.ok(ev[1].user_agent.includes('iPhone'));
  assert.equal(ev[1].actor, 'participante');
});

await prueba('una liga que no existe o está mal escrita responde «no es válido» sin dar pistas', async () => {
  await rechaza(async () => ep.publico.run({ token: 'x'.repeat(43) }, anonimo) as Promise<unknown>, 'Este enlace no es válido.');
  await rechaza(async () => ep.firmar.run({ token: 'x'.repeat(43), nombre: 'Ana Torres', firma: 'a', acepta: true }, anonimo) as Promise<unknown>, 'Este enlace no es válido.');
  await rechaza(async () => ep.publico.run({ token: 'corto' }, anonimo) as Promise<unknown>, '');
});

await prueba('la firma se valida: un recuadro vacío, un punto, algo que no es PNG o demasiado grande no cuentan; con fondo blanco o transparente sí', async () => {
  const mala = 'Dibuja tu firma en el recuadro.';
  await rechaza(async () => normalizarFirma(''), mala);
  await rechaza(async () => normalizarFirma('esto no es base64!!'), mala);
  await rechaza(async () => normalizarFirma(Buffer.from('no soy un png, solo texto largo '.repeat(10)).toString('base64')), mala);
  await rechaza(async () => normalizarFirma(await firmaPng('vacia')), mala);
  await rechaza(async () => normalizarFirma(await firmaPng('punto')), mala);
  await rechaza(async () => normalizarFirma(`data:image/png;base64,${Buffer.alloc(450_000, 1).toString('base64')}`), mala);
  for (const tipo of ['buena', 'fondoBlanco'] as const) {
    const ok = await normalizarFirma(await firmaPng(tipo));
    const meta = await sharp(Buffer.from(ok, 'base64')).metadata();
    assert.equal(meta.format, 'png');
    assert.ok((meta.width ?? 0) <= 600);
  }
  const grande = await normalizarFirma(await firmaPng('buena', 1500));
  assert.equal((await sharp(Buffer.from(grande, 'base64')).metadata()).width, 600, 'una firma grande se reduce a 600 px');
});

await prueba('no se firma sin nombre completo, sin aceptar o sin firma, y el envío no cambia', async () => {
  const { token, envio } = await enviado();
  const firma = await firmaPng();
  await rechaza(async () => firmarEnvio(token, { nombre: 'Ana', firma, acepta: true }), 'Escribe tu nombre completo.');
  await rechaza(async () => firmarEnvio(token, { nombre: '   ', firma, acepta: true }), 'Escribe tu nombre completo.');
  await rechaza(async () => firmarEnvio(token, { nombre: 'x'.repeat(130) + ' y', firma, acepta: true }), 'Tu nombre es demasiado largo.');
  await rechaza(async () => firmarEnvio(token, { nombre: 'Ana Torres', firma, acepta: false }), 'Marca que leíste y aceptas el acuerdo.');
  await rechaza(async () => firmarEnvio(token, { nombre: 'Ana Torres', firma: await firmaPng('vacia'), acepta: true }), 'Dibuja tu firma en el recuadro.');
  const [e] = await envios(envio.recruitment_row_id);
  assert.equal(e.estado, 'enviado');
  assert.equal(e.firma_png, null);
  assert.deepEqual(await tipos(envio.id), ['enviado']);
});

await prueba('firmar guarda nombre, firma, huella del texto, IP y dispositivo; luego hace el PDF, lo guarda con su huella y manda la copia a la persona', async () => {
  const mundo = mundoFalso();
  try {
    const { token, envio } = await enviado();
    await ep.publico.run({ token }, anonimo);
    const r: any = await ep.firmar.run({ token, nombre: '  Ana   María Torres Ruiz ', firma: await firmaPng(), acepta: true }, anonimo);
    assert.ok(r.firmadoAt);
    // lo primero que queda, antes de que exista el PDF: la firma
    const [e0] = await envios(envio.recruitment_row_id);
    assert.equal(e0.estado, 'firmado');
    assert.equal(e0.nombre_firmado, 'Ana María Torres Ruiz');
    assert.equal(e0.texto_hash, sha256(`${NDA_TEXTO_VERSION}\n${ndaEnTexto('Ana María Torres Ruiz')}`));
    assert.ok(e0.firma_png && (await sharp(Buffer.from(e0.firma_png, 'base64')).metadata()).format === 'png');
    assert.equal(e0.ip, '203.0.113.9');
    assert.ok(e0.user_agent.includes('iPhone'));
    assert.ok(e0.firmado_at && e0.abierto_at);

    await esperarTareasNda();
    const [e] = await envios(envio.recruitment_row_id);
    assert.equal(mundo.pdfsHechos.length, 1);
    const d = mundo.pdfsHechos[0];
    assert.equal(d.nombre, 'Ana María Torres Ruiz');
    assert.equal(d.correo, 'ana@ejemplo.test');
    assert.equal(d.ip, '203.0.113.9');
    assert.equal(d.textoHash, e.texto_hash);
    assert.ok(d.enviadoAt instanceof Date && d.abiertoAt instanceof Date && d.firmadoAt instanceof Date);
    const ruta = `${new Date(e.firmado_at).getUTCFullYear()}/${envio.id}.pdf`;
    assert.equal(e.pdf_path, ruta);
    assert.ok(mundo.guardados.has(ruta));
    assert.equal(e.pdf_hash, sha256(mundo.guardados.get(ruta)!));
    assert.ok(e.pdf_at);
    assert.equal(mundo.correos.length, 1);
    const c = mundo.correos[0];
    assert.equal(c.para, 'ana@ejemplo.test');
    assert.equal(c.desde, NDA_REMITENTE_POR_DEFECTO);
    assert.ok(c.html.includes('Hola Ana María Torres Ruiz,'));
    assert.equal(c.adjuntos?.length, 1);
    assert.equal(c.adjuntos![0].nombre, 'Acuerdo de confidencialidad - Ana María Torres Ruiz.pdf');
    assert.equal(c.adjuntos![0].tipo, 'application/pdf');
    assert.equal(c.adjuntos![0].base64, mundo.guardados.get(ruta)!.toString('base64'));
    assert.deepEqual(await tipos(envio.id), ['enviado', 'abierto', 'firmado', 'pdf_creado', 'copia_enviada']);
    // la liga ya firmada enseña el estado y la liga al PDF
    const v: any = await ep.publico.run({ token }, anonimo);
    assert.equal(v.estado, 'firmado');
    assert.equal(v.nombre, 'Ana María Torres Ruiz');
    assert.equal(v.pdfUrl, `https://almacen.ejemplo.test/nda/${ruta}?firmada=600`);
  } finally { mundo.restaurar(); }
});

await prueba('firmar o rechazar dos veces (o uno después del otro) no se puede, y dos firmas simultáneas dejan UNA firma y UN PDF', async () => {
  const mundo = mundoFalso();
  try {
    const a = await enviado();
    const firma = await firmaPng();
    const resultados = await Promise.allSettled([
      firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma, acepta: true }),
      firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma, acepta: true }),
    ]);
    assert.deepEqual(resultados.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
    await esperarTareasNda();
    assert.equal(mundo.pdfsHechos.length, 1, 'se hicieron dos PDF');
    assert.equal((await todas(`select 1 from nda_eventos where envio_id = $1 and tipo = 'firmado'`, [a.envio.id])).length, 1);
    await rechaza(async () => firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma, acepta: true }), 'Este acuerdo ya está firmado.');
    await rechaza(async () => rechazarEnvio(a.token, 'ya firmé'), 'Este acuerdo ya está firmado.');

    const b = await enviado({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test' });
    const r1 = await rechazarEnvio(b.token, '  No   me interesa ');
    const r2 = await rechazarEnvio(b.token, 'otra vez');
    assert.equal(r1.rechazadoAt, r2.rechazadoAt, 'rechazar dos veces es lo mismo que una');
    await rechaza(async () => firmarEnvio(b.token, { nombre: 'Luis Prado Gil', firma, acepta: true }), 'Ya registramos que no aceptaste este acuerdo.');
  } finally { mundo.restaurar(); }
});

await prueba('rechazar guarda el motivo, la IP y el dispositivo, deja el evento y la liga muestra «rechazado»', async () => {
  const { token, envio } = await enviado();
  const r: any = await ep.rechazar.run({ token, motivo: '  No   puedo   ese día ' }, anonimo);
  assert.ok(r.rechazadoAt);
  const [e] = await envios(envio.recruitment_row_id);
  assert.equal(e.estado, 'rechazado');
  assert.equal(e.motivo_rechazo, 'No puedo ese día');
  assert.equal(e.ip, '203.0.113.9');
  assert.ok(e.abierto_at, 'rechazar sin abrir antes también cuenta como que entró');
  const ev = await eventos(envio.id);
  assert.deepEqual(ev.map((x) => x.tipo), ['enviado', 'rechazado']);
  assert.equal(ev[1].detalle, 'No puedo ese día');
  const v: any = await ep.publico.run({ token }, anonimo);
  assert.equal(v.estado, 'rechazado');
  assert.ok(v.rechazadoAt);
  assert.equal(v.pdfUrl, undefined);
});

await prueba('si falla Chrome o Storage la firma queda a salvo, se anota «pdf_fallido» y el PDF se rehace al pedirlo (mandando entonces la copia que no salió)', async () => {
  for (const modo of [{ fallaPdf: true }, { fallaStorage: true }]) {
    const mundo = mundoFalso(modo);
    try {
      const { token, envio } = await enviado();
      await firmarEnvio(token, { nombre: 'Ana Torres Ruiz', firma: await firmaPng(), acepta: true });
      await esperarTareasNda();
      const [e] = await envios(envio.recruitment_row_id);
      assert.equal(e.estado, 'firmado', 'la firma se perdió');
      assert.ok(e.firma_png);
      assert.equal(e.pdf_path, null);
      assert.deepEqual(await tipos(envio.id), ['enviado', 'firmado', 'pdf_fallido']);
      assert.equal(mundo.correos.length, 0, 'no se debe mandar una copia sin PDF');
      // ahora todo funciona: al pedir el PDF se hace, se guarda y se manda la copia pendiente
      mundo.restaurar();
      const bueno = mundoFalso();
      try {
        const url = await urlDelPdf(envio.id);
        assert.ok(url.startsWith('https://almacen.ejemplo.test/nda/'));
        assert.equal(bueno.pdfsHechos.length, 1);
        assert.equal(bueno.correos.length, 1);
        assert.ok((await tipos(envio.id)).includes('copia_enviada'));
        await urlDelPdf(envio.id);
        assert.equal(bueno.pdfsHechos.length, 1, 'el PDF ya existe: no se rehace');
        assert.equal(bueno.correos.length, 1, 'ni se manda otra copia');
      } finally { bueno.restaurar(); }
    } finally { mundo.restaurar(); }
  }
});

await prueba('si falla la copia por correo el PDF queda guardado y se anota «copia_fallida»', async () => {
  const mundo = mundoFalso({ fallaCopia: true });
  try {
    const { token, envio } = await enviado();
    await firmarEnvio(token, { nombre: 'Ana Torres Ruiz', firma: await firmaPng(), acepta: true });
    await esperarTareasNda();
    const [e] = await envios(envio.recruitment_row_id);
    assert.ok(e.pdf_path);
    assert.deepEqual(await tipos(envio.id), ['enviado', 'firmado', 'pdf_creado', 'copia_fallida']);
  } finally { mundo.restaurar(); }
});

await prueba('el PDF solo se pide de un acuerdo firmado y de uno que existe', async () => {
  const mundo = mundoFalso();
  try {
    const { envio } = await enviado();
    await rechaza(async () => urlDelPdf(envio.id), 'todavía no está firmado');
    await rechaza(async () => urlDelPdf('00000000-0000-4000-8000-000000000000'), 'No encontré ese acuerdo.');
  } finally { mundo.restaurar(); }
});

// ═══ Lo que ve el equipo ═════════════════════════════════════════════════════
await prueba('la tabla ve el último envío de cada fila del proyecto (y solo de ese proyecto), con sus fechas', async () => {
  const mundo = mundoFalso();
  try {
    const p = 'PRY-TABLA';
    const a = await enviado({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test', proyecto: p });
    const b = await enviado({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test', proyecto: p });
    const c = await enviado({ nombre: 'Rosa Vega Soto', correo: 'rosa@ejemplo.test', proyecto: p });
    const otro = await enviado({ nombre: 'Otro Proyecto Ejemplo', correo: 'otro@ejemplo.test', proyecto: 'PRY-OTRO' });
    await verEnlace(b.token);
    await firmarEnvio(c.token, { nombre: 'Rosa Vega Soto', firma: await firmaPng(), acepta: true });
    await esperarTareasNda();
    await envejecer(c.id);
    await enviarNdaDeFila(c.id, { enviar: remitenteFalso().enviar, nuevo: true }); // c: ahora su último envío es uno nuevo (enviado)
    const { items } = (await ep.estados.run({ projectCode: p }, equipo)) as any;
    const por = Object.fromEntries(items.map((i: any) => [i.rowId, i]));
    assert.equal(items.length, 3);
    assert.equal(por[a.id].estado, 'enviado');
    assert.equal(por[b.id].estado, 'abierto');
    assert.ok(por[b.id].abiertoAt && por[b.id].enviadoAt);
    assert.equal(por[c.id].estado, 'enviado', 'el último envío manda');
    assert.equal(por[c.id].tienePdf, false);
    assert.ok(!(otro.id in por));
    // el anterior de c sigue guardado, firmado y con PDF
    const lista = await envios(c.id);
    assert.equal(lista.length, 2);
    assert.equal(lista[0].estado, 'firmado');
    assert.ok(lista[0].pdf_path);
    assert.deepEqual((await estadosDeProyecto('PRY-SIN-NADA')), []);
  } finally { mundo.restaurar(); }
});

await prueba('el detalle trae todos los envíos (el último primero) con su línea de tiempo, la constancia y la liga personal', async () => {
  const mundo = mundoFalso();
  try {
    const a = await enviado();
    await verEnlace(a.token, { ip: '203.0.113.9', userAgent: 'Prueba/1.0' });
    await firmarEnvio(a.token, { nombre: 'Ana María Torres Ruiz', firma: await firmaPng(), acepta: true }, { ip: '203.0.113.9', userAgent: 'Prueba/1.0' });
    await esperarTareasNda();
    await envejecer(a.id);
    await enviarNdaDeFila(a.id, { enviar: remitenteFalso().enviar, nuevo: true, por: 'reclutador@ejemplo.test' });
    const r: any = await ep.detalle.run({ rowId: a.id }, equipo);
    assert.equal(r.envios.length, 2);
    const [nuevo, viejo] = r.envios;
    assert.equal(nuevo.estado, 'enviado');
    assert.notEqual(nuevo.enlace, viejo.enlace);
    assert.ok(nuevo.enlace.startsWith('https://sharpli.mx/nda/'));
    assert.equal(viejo.estado, 'firmado');
    assert.equal(viejo.nombreFirmado, 'Ana María Torres Ruiz');
    assert.equal(viejo.ip, '203.0.113.9');
    assert.equal(viejo.userAgent, 'Prueba/1.0');
    assert.equal(viejo.tienePdf, true);
    assert.deepEqual(viejo.eventos.map((e: any) => e.tipo), ['enviado', 'abierto', 'firmado', 'pdf_creado', 'copia_enviada']);
    assert.equal(viejo.eventos[0].actor, 'reclutador@ejemplo.test');
    assert.equal(nuevo.enviadoPor, 'reclutador@ejemplo.test');
    assert.deepEqual((await ep.detalle.run({ rowId: '00000000-0000-4000-8000-000000000000' }, equipo) as any).envios, []);
  } finally { mundo.restaurar(); }
});

await prueba('los endpoints del equipo piden sesión y los de la persona no; el botón de columna «Enviar NDA» usa el mismo envío', async () => {
  const mundo = mundoFalso();
  const antesEnviar = depsNda.enviarCorreo;
  const f = remitenteFalso();
  depsNda.enviarCorreo = f.enviar;
  try {
    const id = await fila({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' });
    const sinSesion = { user: null } as any;
    await assert.rejects(() => ep.enviar.run({ id }, sinSesion));
    await assert.rejects(() => ep.estados.run({ projectCode: 'x' }, sinSesion));
    await assert.rejects(() => ep.detalle.run({ rowId: id }, sinSesion));
    await assert.rejects(() => ep.pdf.run({ envioId: id }, sinSesion));
    const r: any = await ep.enviar.run({ id }, equipo);
    assert.equal(r.success, true);
    assert.equal(r.email, 'ana@ejemplo.test');
    assert.ok(r.link.startsWith('https://sharpli.mx/nda/'));
    assert.equal((await envios(id))[0].enviado_por, 'reclutador@ejemplo.test');
    const repetido: any = await ep.enviar.run({ id }, equipo);
    assert.equal(repetido.success, false);
    assert.equal(repetido.alreadySent, true);
    assert.equal(f.enviados.length, 1);
    // público sin sesión
    const v: any = await ep.publico.run({ token: tokenDe(f.enviados[0].html) }, sinSesion);
    assert.equal(v.estado, 'pendiente');
    // botón de columna
    const col = await una(`insert into board_columns (column_name, board_id, column_type, options_json) values ('Enviar NDA', 'tablero-prueba', 'button', $1) returning id`, [JSON.stringify({ action: 'send_nda', label: 'Enviar NDA' })]);
    const otra = await fila({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test' });
    const b: any = await ep.boton.run({ columnId: col.id, rowId: otra, boardId: 'tablero-prueba' }, equipo);
    assert.deepEqual(b, { success: true, message: 'NDA enviado a luis@ejemplo.test' });
    assert.equal(f.enviados.length, 2);
    assert.equal((await envios(otra)).length, 1);
    const sinNombre = await fila({ nombre: null, fila: null, correo: 'x@ejemplo.test' });
    assert.deepEqual(await ep.boton.run({ columnId: col.id, rowId: sinNombre, boardId: 'tablero-prueba' }, equipo), { success: false, message: 'Falta el nombre del participante.' });
  } finally { depsNda.enviarCorreo = antesEnviar; mundo.restaurar(); }
});

// ═══ El día y la hora de la sesión (arriba del acuerdo; nunca el nombre del proyecto) ═══
const SESION = { fecha: '2026-11-05T18:00', lugar: ' en   línea ' };
const SESION_TEXTO = 'jueves, 5 de noviembre de 2026, 18:00 h (hora de la Ciudad de México) · en línea';

await prueba('la fecha de la sesión se lee en hora de la Ciudad de México (−6) y las fechas imposibles se rechazan', () => {
  assert.equal(desdeHoraMx('2026-11-05T18:00')?.toISOString(), '2026-11-06T00:00:00.000Z');
  assert.equal(desdeHoraMx('2026-07-15T09:30')?.toISOString(), '2026-07-15T15:30:00.000Z', 'sin horario de verano');
  assert.equal(describirSesion(desdeHoraMx('2026-11-05T18:00')!, ' en   línea '), SESION_TEXTO);
  assert.equal(describirSesion(desdeHoraMx('2026-11-05T09:05')!), 'jueves, 5 de noviembre de 2026, 09:05 h (hora de la Ciudad de México)');
  for (const mala of ['2026-02-31T10:00', 'hola', '', '2026-11-05T25:00', '2026-13-01T10:00', '2026-11-05']) assert.equal(desdeHoraMx(mala), null, mala);
});

await prueba('el acuerdo con sesión es el original con un renglón «Sesión: …» arriba; sin sesión es idéntico al original', () => {
  const con = ndaEnTexto('Ana Torres Ruiz', SESION_TEXTO).split('\n\n');
  const sin = ndaEnTexto('Ana Torres Ruiz').split('\n\n');
  assert.equal(con[0], `Sesión: ${SESION_TEXTO}`);
  assert.deepEqual(con.slice(1), sin);
  assert.equal(ndaEnTexto('Ana Torres Ruiz', null), ndaEnTexto('Ana Torres Ruiz'));
});

await prueba('mandar con sesión: el correo la trae, el envío la guarda congelada y la liga la muestra; sin sesión todo sigue como antes', async () => {
  const a = await enviado({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' }, { sesion: SESION });
  assert.ok(a.html.includes(`<b>Sesión:</b> ${SESION_TEXTO}`));
  assert.equal(a.envio.sesion_texto, SESION_TEXTO);
  assert.equal(a.envio.sesion_lugar, 'en línea');
  assert.equal(new Date(a.envio.sesion_at).toISOString(), '2026-11-06T00:00:00.000Z');
  const v: any = await ep.publico.run({ token: a.token }, anonimo);
  assert.equal(v.sesion, SESION_TEXTO);
  const b = await enviado({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test' });
  assert.ok(!b.html.includes('Sesión:'));
  assert.equal(b.envio.sesion_texto, null);
  assert.equal(((await ep.publico.run({ token: b.token }, anonimo)) as any).sesion, undefined);
});

await prueba('el diálogo viene lleno con lo que ya se sabe: la sesión del envío al reenviar, el evento del calendario del grupo, la del envío anterior; si no, vacío', async () => {
  const { sesionInicial, aHoraMxLocal } = await import('../../src/lib/nda');
  const eventos = { 'ev-1': { eventDate: '2026-11-06T00:00:00.000Z', location: 'Sede Reforma' }, 'ev-sin-hora': { eventDate: '2026-11-06', location: 'Sede' } };
  const grupo = JSON.stringify({ linkedCalEvent: { eventId: 'ev-1' } });
  assert.equal(aHoraMxLocal('2026-11-06T00:00:00.000Z'), '2026-11-05T18:00');
  assert.equal(aHoraMxLocal('2026-11-06'), '');
  assert.equal(aHoraMxLocal('basura'), '');
  assert.deepEqual(sesionInicial('primero', undefined, grupo, eventos), { fecha: '2026-11-05T18:00', lugar: 'Sede Reforma' });
  const previo = { sesionAt: '2026-11-12T22:00:00.000Z', sesionLugar: 'en línea' };
  assert.deepEqual(sesionInicial('reenviar', previo, grupo, eventos), { fecha: '2026-11-12T16:00', lugar: 'en línea' }, 'al reenviar manda la sesión del envío');
  assert.deepEqual(sesionInicial('nuevo', previo, grupo, eventos), { fecha: '2026-11-05T18:00', lugar: 'Sede Reforma' }, 'uno nuevo parte del evento del calendario');
  assert.deepEqual(sesionInicial('nuevo', previo, undefined, eventos), { fecha: '2026-11-12T16:00', lugar: 'en línea' }, 'sin grupo ligado, la del envío anterior');
  assert.deepEqual(sesionInicial('primero', undefined, JSON.stringify({ linkedCalEvent: { eventId: 'ev-sin-hora' } }), eventos), { fecha: '', lugar: '' }, 'un evento sin hora no llena la hora');
  assert.deepEqual(sesionInicial('primero', undefined, '{no es json', eventos), { fecha: '', lugar: '' });
  assert.deepEqual(sesionInicial('primero', undefined, undefined, {}), { fecha: '', lugar: '' });
});

await prueba('una sesión con fecha inválida no manda nada, no crea envío y no toca la fila', async () => {
  const id = await fila({ nombre: 'Ana', correo: 'ana@ejemplo.test' });
  const f = remitenteFalso();
  for (const fecha of ['mañana', '2026-02-31T10:00', '']) {
    const r = await enviarNdaDeFila(id, { enviar: f.enviar, sesion: { fecha } });
    assert.deepEqual([r.enviado, r.mensaje], [false, 'El día y la hora de la sesión no son válidos.'], fecha);
  }
  assert.equal(f.enviados.length, 0);
  assert.equal((await envios(id)).length, 0);
  const e = await filaRow(id);
  assert.ok(!e.nda_sent && e.fecha === null);
});

await prueba('al firmar, la huella incluye el renglón de la sesión y el PDF recibe la sesión; un envío viejo sin sesión firma con la huella de siempre', async () => {
  const mundo = mundoFalso();
  try {
    const a = await enviado({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' }, { sesion: SESION });
    await firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma: await firmaPng(), acepta: true });
    const b = await enviado({ nombre: 'Luis Prado Gil', correo: 'luis@ejemplo.test' });
    await firmarEnvio(b.token, { nombre: 'Luis Prado Gil', firma: await firmaPng(), acepta: true });
    await esperarTareasNda();
    const [ea] = await envios(a.id);
    const [eb] = await envios(b.id);
    assert.equal(ea.texto_hash, sha256(`${NDA_TEXTO_VERSION}\n${ndaEnTexto('Ana Torres Ruiz', SESION_TEXTO)}`));
    assert.equal(eb.texto_hash, sha256(`${NDA_TEXTO_VERSION}\n${ndaEnTexto('Luis Prado Gil')}`));
    assert.notEqual(ea.texto_hash, sha256(`${NDA_TEXTO_VERSION}\n${ndaEnTexto('Ana Torres Ruiz')}`));
    const porNombre = Object.fromEntries(mundo.pdfsHechos.map((d) => [d.nombre, d]));
    assert.equal(porNombre['Ana Torres Ruiz'].sesion, SESION_TEXTO);
    assert.ok(!porNombre['Luis Prado Gil'].sesion);
    const html = htmlDelPdf(porNombre['Ana Torres Ruiz']);
    assert.ok(html.includes(`<b>Sesión:</b> ${SESION_TEXTO}`));
    assert.ok(html.indexOf('<b>Sesión:</b>') < html.indexOf('<h1>'), 'la sesión va arriba del título');
    assert.ok(!htmlDelPdf(porNombre['Luis Prado Gil']).includes('Sesión:'));
  } finally { mundo.restaurar(); }
});

await prueba('reenviar un envío pendiente con la sesión corregida cambia la sesión (después de que salga el correo); sin sesión nueva conserva la anterior; si el correo falla no cambia', async () => {
  const a = await enviado({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' }, { sesion: SESION });
  await envejecer(a.id);
  const f = remitenteFalso({ falla: new ErrorDeEnvio(503, 'busy') });
  await enviarNdaDeFila(a.id, { enviar: f.enviar, sesion: { fecha: '2026-11-09T10:30', lugar: 'Sede Reforma' } });
  assert.equal((await envios(a.id))[0].sesion_texto, SESION_TEXTO, 'el correo falló: la sesión no debe cambiar');
  const g = remitenteFalso();
  await enviarNdaDeFila(a.id, { enviar: g.enviar, sesion: { fecha: '2026-11-09T10:30', lugar: 'Sede Reforma' } });
  const nueva = 'lunes, 9 de noviembre de 2026, 10:30 h (hora de la Ciudad de México) · Sede Reforma';
  assert.ok(g.enviados[0].html.includes(nueva));
  assert.equal((await envios(a.id))[0].sesion_texto, nueva);
  await envejecer(a.id);
  const h = remitenteFalso();
  await enviarNdaDeFila(a.id, { enviar: h.enviar });
  assert.ok(h.enviados[0].html.includes(nueva), 'un reenvío sin sesión nueva usa la que ya tenía');
  assert.equal((await envios(a.id))[0].sesion_texto, nueva);
});

await prueba('lo ya firmado conserva su sesión; un envío «nuevo» trae la suya; la tabla y el detalle la entregan para llenar el diálogo', async () => {
  const mundo = mundoFalso();
  try {
    const a = await enviado({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test', proyecto: 'PRY-SESION' }, { sesion: SESION });
    await firmarEnvio(a.token, { nombre: 'Ana Torres Ruiz', firma: await firmaPng(), acepta: true });
    await esperarTareasNda();
    await envejecer(a.id);
    const f = remitenteFalso();
    assert.equal((await enviarNdaDeFila(a.id, { enviar: f.enviar, nuevo: true, sesion: { fecha: '2026-11-12T16:00' } })).enviado, true);
    const [viejo, nuevo] = await envios(a.id);
    assert.equal(viejo.sesion_texto, SESION_TEXTO, 'lo firmado no cambia');
    assert.equal(nuevo.sesion_texto, 'jueves, 12 de noviembre de 2026, 16:00 h (hora de la Ciudad de México)');
    const { items } = (await ep.estados.run({ projectCode: 'PRY-SESION' }, equipo)) as any;
    assert.equal(items[0].estado, 'enviado');
    assert.equal(items[0].sesionAt, '2026-11-12T22:00:00.000Z');
    assert.equal(items[0].sesionLugar, undefined);
    const { envios: lista } = (await ep.detalle.run({ rowId: a.id }, equipo)) as any;
    assert.equal(lista[1].sesion, SESION_TEXTO);
    assert.equal(lista[1].sesionLugar, 'en línea');
    assert.equal(lista[0].sesion, nuevo.sesion_texto);
  } finally { mundo.restaurar(); }
});

await prueba('el endpoint del botón recibe la sesión y valida su forma', async () => {
  const f = remitenteFalso();
  const antes = depsNda.enviarCorreo;
  depsNda.enviarCorreo = f.enviar;
  try {
    const id = await fila({ nombre: 'Ana Torres Ruiz', correo: 'ana@ejemplo.test' });
    await assert.rejects(() => ep.enviar.run({ id, sesion: { lugar: 'sin fecha' } } as any, equipo));
    const mala: any = await ep.enviar.run({ id, sesion: { fecha: 'pronto' } }, equipo);
    assert.deepEqual(mala, { success: false, message: 'El día y la hora de la sesión no son válidos.' });
    const ok: any = await ep.enviar.run({ id, sesion: SESION }, equipo);
    assert.equal(ok.success, true);
    assert.ok(f.enviados[0].html.includes(SESION_TEXTO));
  } finally { depsNda.enviarCorreo = antes; }
});

// ═══ La bitácora y el script ═════════════════════════════════════════════════
await prueba('la bitácora no se puede editar, borrar ni vaciar', async () => {
  const { envio } = await enviado();
  await assert.rejects(() => pg.query(`update nda_eventos set tipo = 'rechazado' where envio_id = $1`, [envio.id]), /bitácora/);
  await assert.rejects(() => pg.query(`delete from nda_eventos where envio_id = $1`, [envio.id]), /bitácora/);
  await assert.rejects(() => pg.query(`truncate nda_eventos`), /bitácora/);
  await assert.rejects(() => pg.query(`insert into nda_eventos (envio_id, tipo) values ($1, 'inventado')`, [envio.id]), /nda_eventos_tipo_chk/);
  assert.ok((await eventos(envio.id)).length >= 1);
});

await prueba('el estado y el token del envío tienen candados (estado válido, token único)', async () => {
  const { envio } = await enviado();
  await assert.rejects(() => pg.query(`update nda_envios set estado = 'inventado' where id = $1`, [envio.id]), /nda_envios_estado_chk/);
  await assert.rejects(() => pg.query(`insert into nda_envios (token, recruitment_row_id, estado) values ($1, $2, 'enviado')`, [envio.token, envio.recruitment_row_id]), /nda_envios_token_uniq/);
});

await prueba('el script crea las tablas desde cero en una base vacía y se puede correr dos veces', async () => {
  const limpia = await PGlite.create({ parsers });
  for (const sql of SQL_NDA) await limpia.exec(sql);
  for (const sql of SQL_NDA) await limpia.exec(sql);
  const t = (await limpia.query<{ table_name: string }>(`select table_name from information_schema.tables where table_name in ('nda_envios', 'nda_eventos') order by 1`)).rows.map((r) => r.table_name);
  assert.deepEqual(t, ['nda_envios', 'nda_eventos']);
  await limpia.exec(`insert into nda_envios (token, estado) values ('t1', 'enviado')`);
  await limpia.close();
});

// ═══ Un PDF de verdad, hecho con Chrome y leído de vuelta ═══════════════════
await prueba('el PDF real (Chrome) sale con el nombre, el texto, la fecha y la constancia, y se lee de vuelta', async () => {
  let pdf: Buffer;
  try {
    pdf = await generarPdfNda({
      envioId: 'e1e1e1e1-aaaa-bbbb-cccc-000000000001', nombre: 'Ana María Torres Ruiz', correo: 'ana@ejemplo.test', firmaPng: (await firmaPng()).split(',')[1], firmadoAt: new Date('2026-11-04T16:42:00Z'),
      enviadoAt: new Date('2026-11-04T15:00:00Z'), abiertoAt: new Date('2026-11-04T16:30:00Z'), ip: '203.0.113.9', userAgent: 'Prueba/1.0', textoHash: sha256('texto de prueba'),
      sesion: SESION_TEXTO,
    });
  } catch (e) {
    if (/Could not find|Failed to launch|browser/i.test((e as Error).message)) { console.log('     (omitida: no hay Chrome en esta máquina)'); n--; return; }
    throw e;
  }
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 20_000 && pdf.length < 3_000_000, `tamaño raro: ${pdf.length}`);
  // pdfjs-dist es opcional aquí (no siempre está instalado): sin él solo se comprueba que salió un PDF de tamaño razonable.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  if (!pdfjs) { console.log('     (sin pdfjs-dist: solo se revisó que sea un PDF)'); return; }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
  let texto = '';
  for (let i = 1; i <= doc.numPages; i++) texto += ' ' + (await (await doc.getPage(i)).getTextContent()).items.map((it: any) => it.str).join(' ');
  // el título de la constancia se imprime en mayúsculas (text-transform), así que se compara sin distinguir mayúsculas
  const plano = texto.replace(/\s+/g, ' ').toLowerCase();
  for (const buscado of ['ACUERDO DE CONFIDENCIALIDAD', 'Ana María Torres Ruiz', 'ASESORES GLOBALES CORPORATIVOS SC', 'Firma del participante', 'Fecha:', 'acepto los términos y condiciones de este acuerdo', 'Conozco el aviso de privacidad de Asesores Globales Corporativos SC', 'sharpli.mx/f/aviso', '4 de noviembre de 2026', 'Sesión: jueves, 5 de noviembre de 2026, 18:00 h', 'en línea', 'Constancia de firma electrónica', '203.0.113.9', 'ana@ejemplo.test', sha256('texto de prueba').slice(0, 16)]) {
    assert.ok(plano.includes(buscado.toLowerCase()), `el PDF no trae «${buscado}»`);
  }
  assert.ok(doc.numPages >= 1 && doc.numPages <= 3, `páginas: ${doc.numPages}`);
});

console.log(`\n${n - fallas}/${n} pruebas pasan`);
await pg.close();
process.exit(fallas ? 1 : 0);
