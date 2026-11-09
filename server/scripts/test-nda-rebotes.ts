// Pruebas de los rebotes del correo del NDA (docs/nda.md → «Si el correo no llega»): leer los avisos de «no se pudo entregar» (con el formato de los reales: Microsoft 365 en inglés y en español, Gmail),
// el motivo en palabras, ligar cada aviso a la salida del correo que lo causó (y no a una más nueva), que un reenvío limpie el «No llegó», que si la persona ya abrió la liga no cuente,
// que anotar dos veces el mismo aviso no duplique nada, que un aviso de otra cosa (Prework) no se anote y que lo que muestran la tabla y el detalle sea lo correcto.
// Contra una base en memoria (PGlite) con el esquema real y el SQL real de server/scripts/add-nda-tables.ts. Nada sale a internet: el buzón se simula. Todo con datos inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-nda-rebotes.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../compat';
import { DATE_OID, NUMERIC_OID, TIMESTAMPTZ_OID, parseDate, parseNumeric, parseTimestamptz } from '../compat/datetimeParsers';

process.env.STRICT_OUTPUT = 'true';
// La revisión que dispara la tabla no debe salir a internet en las pruebas (las que la prueban la prenden a propósito).
process.env.NDA_REBOTES = 'no';

const R = await import('../../src/serverUtils/nda/rebotes');
const { leerAviso, motivoEnPalabras, pareceAviso, htmlATexto, sincronizarRebotes, rebotesVigentes, revisarRebotesSiToca, reiniciarRevisionDeRebotes, motivoDeAnotacion } = R;
const { estadosDeProyecto, detalleDeFila } = await import('../../src/serverUtils/nda/servicio');
const { SQL_NDA } = await import('./add-nda-tables');
const ep = {
  estados: (await import('../../src/api/getNDAStatuses')).default,
  detalle: (await import('../../src/api/getNDADetail')).default,
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
for (const sql of SQL_NDA) await pg.exec(sql);

const equipo = { user: { id: 'u-1', email: 'reclutador@ejemplo.test', role: 'Coordinador' } } as any;
const una = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params as any)).rows[0];
const todas = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params as any)).rows;

// ── Avisos con el formato de los reales (correos inventados) ──────────────────────────────────────────
const ASUNTO_INVITACION = 'Tu acuerdo de confidencialidad — Sapience';
const ASUNTO_COPIA = 'Tu copia del acuerdo de confidencialidad firmado — Sapience';
const CABECERAS = (asunto: string) => `Original message headers: Received: from SJ0P220MB0510.NAMP220.PROD.OUTLOOK.COM (2603:10b6:a03:300::21) by PH0P220MB0524.NAMP220.PROD.OUTLOOK.COM (2603:10b6:510:d5::9) with Microsoft SMTP Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.21.592.8; Sat, 7 Nov 2026 11:30:22 +0000 From: sesiones@sapience.com.mx To: persona@ejemplo.test Subject: ${asunto}`;

const AVISO_BUZON_LLENO = (para: string, asunto = ASUNTO_INVITACION) => `Delivery has failed to these recipients or groups: ${para} (${para}) Your message couldn't be delivered. Despite repeated attempts to contact the recipient's email system it didn't respond. Contact the recipient by some other means (by phone, for example) and ask them to tell their email admin that it appears that their email system isn't accepting connection requests from your email system. Give them the error details shown below. It's likely that the recipient's email admin is the only one who can fix this problem. For more information and tips to fix this issue see this article: https://go.microsoft.com/fwlink/?LinkId=389361. Diagnostic information for administrators: Generating server: PH0P220MB0524.NAMP220.PROD.OUTLOOK.COM Total retry attempts: 4 ${para} Remote server returned '550 5.4.300 Message expired -> 452 4.2.2 The recipient's inbox is out of storage space. Please direct the;recipient to; https://support.google.com/mail/?p=OverQuotaTemp 41be03b00d2f7-cdb708a98c9si7097123a12.82 - gsmtp' ${CABECERAS(asunto)}`;

const AVISO_NO_EXISTE = (para: string) => `Delivery has failed to these recipients or groups: ${para} (${para}) Your message wasn't delivered because the recipient's email provider rejected it. Diagnostic information for administrators: Generating server: PH0P220MB0524.NAMP220.PROD.OUTLOOK.COM ${para} Remote server returned '550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces. For more information, go to https://support.google.com/mail/?p=NoSuchUser gsmtp' ${CABECERAS(ASUNTO_INVITACION)}`;

const AVISO_DOMINIO = (para: string) => `Delivery has failed to these recipients or groups: ${para} (${para}) Your message couldn't be delivered because the recipient's domain doesn't exist. Diagnostic information for administrators: Generating server: PH0P220MB0524.NAMP220.PROD.OUTLOOK.COM ${para} Remote server returned '550 5.4.310 DNS domain gmail.con does not exist [DB1PEPF000509F1.eurprd03.prod.outlook.com 2026-11-05T16:36:22.431Z 08DE]' ${CABECERAS(ASUNTO_INVITACION)}`;

const AVISO_EN_ESPANOL = (para: string) => `No se pudo entregar a estos destinatarios o grupos: ${para} (${para}) Su mensaje no se pudo entregar. Información de diagnóstico para administradores: Servidor generador: PH0P220MB0524.NAMP220.PROD.OUTLOOK.COM ${para} Remote server returned '550 5.7.1 Message rejected as spam by policy. blocked' ${CABECERAS(ASUNTO_INVITACION)}`;

const AVISO_GMAIL = (para: string) => `Address not found Your message wasn't delivered to ${para} because the address couldn't be found, or is unable to receive mail. The response from the remote server was: 550 5.1.1 The email account that you tried to reach does not exist. ---------- Original message ---------- From: sesiones@sapience.com.mx Subject: ${ASUNTO_INVITACION}`;

const AVISO_SIN_MARCA = (para: string) => `Mail delivery failed. A message you sent to sesiones@sapience.com.mx could not be delivered to ${para}. 554 5.7.1 Rejected as spam. Subject: ${ASUNTO_INVITACION}`;

// ── Pruebas del lector (puras) ──────────────────────────────────────────────────────────────────────
await prueba('buzón lleno: se lee el correo, los códigos y el motivo (gana «buzón lleno» sobre «mensaje expirado»)', () => {
  const a = leerAviso(`Undeliverable: ${ASUNTO_INVITACION}`, AVISO_BUZON_LLENO('persona.uno@ejemplo.test'))!;
  assert.equal(a.tipo, 'invitacion');
  assert.equal(a.correo, 'persona.uno@ejemplo.test');
  assert.deepEqual(a.codigos, ['5.4.300', '4.2.2']);
  assert.equal(a.motivo, 'El buzón de la persona está lleno');
});
await prueba('correo que no existe (5.1.1)', () => {
  const a = leerAviso(`Undeliverable: ${ASUNTO_INVITACION}`, AVISO_NO_EXISTE('Nombre.Mal@Ejemplo.test'))!;
  assert.equal(a.correo, 'nombre.mal@ejemplo.test', 'el correo se guarda en minúsculas');
  assert.deepEqual(a.codigos, ['5.1.1']);
  assert.equal(a.motivo, 'Ese correo no existe (revisa que esté bien escrito)');
});
await prueba('dominio mal escrito (gmail.con, 5.4.310)', () => {
  const a = leerAviso(`Undeliverable: ${ASUNTO_INVITACION}`, AVISO_DOMINIO('persona.tres@gmail.con'))!;
  assert.equal(a.correo, 'persona.tres@gmail.con');
  assert.equal(a.motivo, 'El dominio del correo no existe (revisa cómo está escrito)');
});
await prueba('aviso en español (Microsoft 365) y bloqueado por el servidor', () => {
  const a = leerAviso(`No se puede entregar: ${ASUNTO_INVITACION}`, AVISO_EN_ESPANOL('persona.cinco@ejemplo.test'))!;
  assert.equal(a.correo, 'persona.cinco@ejemplo.test');
  assert.equal(a.motivo, 'El servidor del correo lo bloqueó');
});
await prueba('aviso con el formato de Gmail: «wasn\'t delivered to …»', () => {
  const a = leerAviso('Delivery Status Notification (Failure)', AVISO_GMAIL('otra.persona@ejemplo.test'))!;
  assert.equal(a.tipo, 'invitacion');
  assert.equal(a.correo, 'otra.persona@ejemplo.test');
});
await prueba('un formato desconocido: toma el primer correo que no es el del buzón del NDA ni del sistema', () => {
  const a = leerAviso('Returned mail', AVISO_SIN_MARCA('persona.seis@ejemplo.test'), 'sesiones@sapience.com.mx')!;
  assert.equal(a.correo, 'persona.seis@ejemplo.test');
  assert.equal(a.motivo, 'El servidor del correo lo bloqueó');
});
await prueba('el aviso de la copia firmada se distingue del de la invitación', () => {
  const a = leerAviso(`Undeliverable: ${ASUNTO_COPIA}`, AVISO_BUZON_LLENO('persona.uno@ejemplo.test', ASUNTO_COPIA))!;
  assert.equal(a.tipo, 'copia');
});
await prueba('un aviso de otra cosa (un correo de Prework) no es del NDA', () => {
  assert.equal(leerAviso('Undeliverable: Sesión 1 - M 0.4', AVISO_NO_EXISTE('persona@ejemplo.test').replace(ASUNTO_INVITACION, 'Sesión 1 - M 0.4')), null);
});
await prueba('los números de versión de las cabeceras no se toman por códigos de estado', () => {
  const a = leerAviso(`Undeliverable: ${ASUNTO_INVITACION}`, AVISO_NO_EXISTE('persona@ejemplo.test') + ' x-ms-exchange 4.0.123 5.21.592')!;
  assert.deepEqual(a.codigos, ['5.1.1']);
});
await prueba('sin ningún correo en el aviso no se inventa uno', () => {
  assert.equal(leerAviso(`Undeliverable: ${ASUNTO_INVITACION}`, 'No se pudo entregar el mensaje.'), null);
});
await prueba('los motivos: expirado sin más, desactivado y lo que no se reconoce', () => {
  assert.equal(motivoEnPalabras(['5.4.300'], "Message expired. Despite repeated attempts the recipient's email system didn't respond"), 'El servidor del correo de la persona no respondió');
  assert.equal(motivoEnPalabras(['5.2.1'], 'The mailbox is disabled'), 'El buzón de la persona está desactivado');
  assert.equal(motivoEnPalabras([], 'algo raro'), 'No se pudo entregar el correo');
});
await prueba('qué mensajes del buzón parecen avisos de rebote (por quién los manda o por su asunto)', () => {
  assert.equal(pareceAviso('Undeliverable: lo que sea', 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@sapience.com.mx'), true);
  assert.equal(pareceAviso('Your message couldn\'t be delivered', 'postmaster@ejemplo.test'), true);
  assert.equal(pareceAviso('No se puede entregar: algo', 'x@ejemplo.test'), true);
  assert.equal(pareceAviso('Re: Mi horario de la sesión', 'persona@ejemplo.test'), false);
});
await prueba('el HTML de un aviso se vuelve texto', () => {
  assert.equal(htmlATexto('<style>p{}</style><p>Delivery&nbsp;has failed &gt; <b>x@ejemplo.test</b></p>\n<p>It&#39;s &amp; done</p>'), "Delivery has failed > x@ejemplo.test It's & done");
});

// ── Datos inventados en la base ───────────────────────────────────────────────────────────────────────
const PROYECTO = 'PRY-REB';
const T0 = new Date('2026-11-05T16:36:00Z');
const despues = (base: Date, ms: number) => new Date(base.getTime() + ms);
const MIN = 60_000, HORA = 3_600_000;

async function envio(correo: string, o: { estado?: string; cuando?: Date } = {}) {
  const cuando = o.cuando ?? T0;
  const fila = crypto.randomUUID();
  const e = await una(
    `insert into nda_envios (token, recruitment_row_id, project_code, nombre, correo, estado, enviado_at, ultimo_envio_at, envios)
     values ($1, $2, $3, 'Persona Prueba', $4, $5, $6, $6, 1) returning id`,
    [crypto.randomBytes(8).toString('hex'), fila, PROYECTO, correo, o.estado ?? 'enviado', cuando],
  );
  await salida(e.id, 'enviado', correo, cuando);
  return { id: e.id as string, fila };
}
async function salida(envioId: string, tipo: 'enviado' | 'reenviado' | 'copia_enviada', correo: string, cuando: Date) {
  await pg.query(`insert into nda_eventos (envio_id, tipo, detalle, actor, created_at) values ($1, $2, $3, 'reclutador@ejemplo.test', $4)`, [envioId, tipo, correo, cuando]);
  if (tipo !== 'copia_enviada') await pg.query(`update nda_envios set correo = $2, ultimo_envio_at = $3 where id = $1`, [envioId, correo, cuando]);
}
const eventosDe = (envioId: string) => todas(`select tipo, detalle, created_at from nda_eventos where envio_id = $1 order by n`, [envioId]);
const estadoDe = async (fila: string) => (await estadosDeProyecto(PROYECTO)).find((x) => x.rowId === fila);

/** Un buzón de mentira con avisos; cuenta cuántas veces se pidió el texto de cada uno. */
function buzon(avisos: { clave: string; asunto: string; de?: string; recibidoAt: Date; texto: string }[]) {
  const pedidos: string[] = [];
  return {
    pedidos,
    lector: {
      listar: async (desde: Date) => avisos.filter((a) => a.recibidoAt >= desde).map((a) => ({ clave: a.clave, ref: a.clave, asunto: a.asunto, de: a.de ?? 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@sapience.com.mx', recibidoAt: a.recibidoAt })),
      texto: async (ref: string) => { pedidos.push(ref); return avisos.find((a) => a.clave === ref)!.texto; },
    },
  };
}
const aviso = (clave: string, para: string, cuando: Date, o: { texto?: string; asunto?: string } = {}) => ({
  clave, asunto: `Undeliverable: ${o.asunto ?? ASUNTO_INVITACION}`, recibidoAt: cuando, texto: o.texto ?? AVISO_NO_EXISTE(para),
});
const AHORA = despues(T0, 2 * HORA);

// ── Ligar el aviso a la salida del correo ─────────────────────────────────────────────────────────────
const ana = await envio('ana.mal@ejemplo.test');
await prueba('un aviso se anota en la bitácora con la hora en que LLEGÓ y la salida que rebotó', async () => {
  const b = buzon([aviso('<aviso-1@ejemplo.test>', 'ana.mal@ejemplo.test', despues(T0, 10_000))]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.deepEqual({ revisados: r.revisados, nuevos: r.nuevos, sinSalida: r.sinSalida }, { revisados: 1, nuevos: 1, sinSalida: 0 });
  const ev = (await eventosDe(ana.id)).filter((e) => e.tipo === 'rebotado');
  assert.equal(ev.length, 1);
  assert.equal(new Date(ev[0].created_at).toISOString(), despues(T0, 10_000).toISOString(), 'la hora del aviso, no la de ahora');
  const d = JSON.parse(ev[0].detalle);
  assert.equal(d.correo, 'ana.mal@ejemplo.test');
  assert.equal(d.codigo, '5.1.1');
  assert.equal(d.aviso, '<aviso-1@ejemplo.test>');
  const salidaDeAna = (await todas(`select n::text as n from nda_eventos where envio_id = $1 and tipo = 'enviado'`, [ana.id]))[0].n;
  assert.equal(d.salida, salidaDeAna);
});
await prueba('la tabla lo muestra: el último envío trae `rebote` con el motivo en palabras', async () => {
  const e = await estadoDe(ana.fila);
  assert.equal(e?.estado, 'enviado');
  assert.equal(e?.rebote?.motivo, 'Ese correo no existe (revisa que esté bien escrito)');
  assert.equal(e?.rebote?.codigo, '5.1.1');
});
await prueba('revisar otra vez el mismo aviso no lo anota dos veces', async () => {
  const b = buzon([aviso('<aviso-1@ejemplo.test>', 'ana.mal@ejemplo.test', despues(T0, 10_000))]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(r.nuevos, 0);
  assert.equal(b.pedidos.length, 0, 'ni siquiera se vuelve a pedir su texto');
  assert.equal((await eventosDe(ana.id)).filter((e) => e.tipo === 'rebotado').length, 1);
});
await prueba('un reenvío después del rebote lo limpia: ya no sale «No llegó»', async () => {
  await salida(ana.id, 'reenviado', 'ana.bien@ejemplo.test', despues(T0, 6 * HORA));
  assert.equal((await estadoDe(ana.fila))?.rebote, undefined);
  assert.equal((await estadoDe(ana.fila))?.estado, 'enviado');
});

await prueba('un aviso TARDÍO por la salida vieja no marca como rebotada la salida nueva (reenviada a otro correo)', async () => {
  const beto = await envio('beto.mal@ejemplo.test');
  await salida(beto.id, 'reenviado', 'beto.bien@ejemplo.test', despues(T0, 6 * HORA));
  const b = buzon([aviso('<aviso-tardio@ejemplo.test>', 'beto.mal@ejemplo.test', despues(T0, 24 * HORA), { texto: AVISO_BUZON_LLENO('beto.mal@ejemplo.test') })]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: despues(T0, 25 * HORA) });
  assert.equal(r.nuevos, 1, 'el aviso se anota (es evidencia de la primera salida)');
  assert.equal((await estadoDe(beto.fila))?.rebote, undefined, 'pero la última salida sigue sin rebotar');
  assert.deepEqual((await eventosDe(beto.id)).map((e) => e.tipo), ['enviado', 'reenviado', 'rebotado']);
});

await prueba('si el aviso es de la salida más reciente al mismo correo, esa es la que cuenta', async () => {
  const carla = await envio('carla@ejemplo.test');
  await salida(carla.id, 'reenviado', 'carla@ejemplo.test', despues(T0, 3 * HORA));
  const b = buzon([aviso('<aviso-carla@ejemplo.test>', 'carla@ejemplo.test', despues(T0, 3 * HORA + 30_000), { texto: AVISO_BUZON_LLENO('carla@ejemplo.test') })]);
  await sincronizarRebotes({ lector: b.lector, ahora: despues(T0, 4 * HORA) });
  const d = JSON.parse((await eventosDe(carla.id)).find((e) => e.tipo === 'rebotado')!.detalle);
  const reenvio = (await todas(`select n::text as n from nda_eventos where envio_id = $1 and tipo = 'reenviado'`, [carla.id]))[0].n;
  assert.equal(d.salida, reenvio, 'ligado al reenvío, no al primer envío');
  assert.equal((await estadoDe(carla.fila))?.rebote?.motivo, 'El buzón de la persona está lleno');
});

await prueba('si la persona ya abrió la liga (por WhatsApp, por ejemplo), el rebote ya no cuenta en la tabla', async () => {
  const dani = await envio('dani.mal@ejemplo.test');
  const b = buzon([aviso('<aviso-dani@ejemplo.test>', 'dani.mal@ejemplo.test', despues(T0, 20_000))]);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.ok((await estadoDe(dani.fila))?.rebote, 'mientras no abra, sale');
  await pg.query(`update nda_envios set estado = 'abierto', abierto_at = $2 where id = $1`, [dani.id, despues(T0, 3 * HORA)]);
  const e = await estadoDe(dani.fila);
  assert.equal(e?.estado, 'abierto');
  assert.equal(e?.rebote, undefined);
  assert.equal((await eventosDe(dani.id)).filter((x) => x.tipo === 'rebotado').length, 1, 'pero el aviso sigue anotado en la bitácora');
});

await prueba('un aviso inmediato (el dominio no existe) puede llegar un instante ANTES de que se anote la salida: se liga igual', async () => {
  const eli = await envio('eli@gmail.con', { cuando: despues(T0, 1000) });
  const b = buzon([aviso('<aviso-eli@ejemplo.test>', 'eli@gmail.con', T0, { texto: AVISO_DOMINIO('eli@gmail.con') })]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(r.nuevos, 1);
  assert.equal((await estadoDe(eli.fila))?.rebote?.motivo, 'El dominio del correo no existe (revisa cómo está escrito)');
});

await prueba('un aviso de un correo al que nunca se mandó un NDA (Prework) no se anota', async () => {
  const antes = (await una(`select count(*)::int as c from nda_eventos`)).c;
  const b = buzon([aviso('<aviso-ajeno@ejemplo.test>', 'nadie@ejemplo.test', despues(T0, 30_000))]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.deepEqual({ nuevos: r.nuevos, sinSalida: r.sinSalida }, { nuevos: 0, sinSalida: 1 });
  assert.equal((await una(`select count(*)::int as c from nda_eventos`)).c, antes);
});

await prueba('un aviso que no es del NDA no se vuelve a pedir en cada revisión', async () => {
  const b = buzon([{ clave: '<prework-1@ejemplo.test>', asunto: 'Undeliverable: Sesión 1 - M 0.4', recibidoAt: despues(T0, 40_000), texto: AVISO_NO_EXISTE('persona@ejemplo.test').replace(ASUNTO_INVITACION, 'Sesión 1 - M 0.4') }]);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(b.pedidos.length, 1);
});

await prueba('dos avisos del mismo rebote (dos mensajes distintos) se anotan una sola vez', async () => {
  const nora = await envio('nora.mal@ejemplo.test');
  const b = buzon([
    aviso('<aviso-nora-1@ejemplo.test>', 'nora.mal@ejemplo.test', despues(T0, 20_000), { texto: AVISO_BUZON_LLENO('nora.mal@ejemplo.test') }),
    aviso('<aviso-nora-2@ejemplo.test>', 'nora.mal@ejemplo.test', despues(T0, 21_000), { texto: AVISO_BUZON_LLENO('nora.mal@ejemplo.test') }),
  ]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(r.nuevos, 1);
  assert.equal((await eventosDe(nora.id)).filter((e) => e.tipo === 'rebotado').length, 1);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(b.pedidos.filter((x) => x.includes('nora-2')).length, 1, 'el repetido tampoco se vuelve a pedir');
});

await prueba('un aviso de «se está demorando» no es un rebote todavía', async () => {
  const olga = await envio('olga@ejemplo.test');
  const demora = AVISO_BUZON_LLENO('olga@ejemplo.test').replace(/Remote server returned.*?(?= Original message headers)/, "Remote server returned '4.4.7 Message delayed'");
  const b = buzon([{ clave: '<aviso-olga@ejemplo.test>', asunto: `Delivery Status Notification (Delay): ${ASUNTO_INVITACION}`, recibidoAt: despues(T0, 30_000), texto: demora }]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.equal(r.nuevos, 0);
  assert.equal((await estadoDe(olga.fila))?.rebote, undefined);
  assert.equal(leerAviso('Delivery Status Notification (Failure)', AVISO_NO_EXISTE('olga@ejemplo.test'))?.correo, 'olga@ejemplo.test', 'y uno de falla sí');
});

await prueba('el aviso de la COPIA firmada se anota aparte y no cambia el estado del envío', async () => {
  const fer = await envio('fer@ejemplo.test', { estado: 'firmado' });
  await salida(fer.id, 'copia_enviada', 'fer@ejemplo.test', despues(T0, 5 * MIN));
  const b = buzon([aviso('<aviso-copia@ejemplo.test>', 'fer@ejemplo.test', despues(T0, 10 * MIN), { asunto: ASUNTO_COPIA, texto: AVISO_BUZON_LLENO('fer@ejemplo.test', ASUNTO_COPIA) })]);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  assert.deepEqual((await eventosDe(fer.id)).map((e) => e.tipo), ['enviado', 'copia_enviada', 'copia_rebotada']);
  const e = await estadoDe(fer.fila);
  assert.equal(e?.estado, 'firmado');
  assert.equal(e?.rebote, undefined);
  const det = (await detalleDeFila(fer.fila))[0];
  const ev = det.eventos.find((x) => x.tipo === 'copia_rebotada')!;
  assert.equal(ev.detalle, 'El buzón de la persona está lleno', 'el detalle muestra el motivo, no el registro técnico');
});

await prueba('en el detalle, el envío trae `rebote` y su línea de tiempo muestra el motivo', async () => {
  const gabo = await envio('gabo.mal@ejemplo.test');
  const b = buzon([aviso('<aviso-gabo@ejemplo.test>', 'gabo.mal@ejemplo.test', despues(T0, 15_000))]);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  const det = (await detalleDeFila(gabo.fila))[0];
  assert.equal(det.rebote?.motivo, 'Ese correo no existe (revisa que esté bien escrito)');
  const ev = det.eventos.find((x) => x.tipo === 'rebotado')!;
  assert.equal(ev.detalle, 'Ese correo no existe (revisa que esté bien escrito)');
  assert.equal(motivoDeAnotacion('esto no es JSON'), undefined);
});

await prueba('solo mira los avisos de los últimos días: uno más viejo no se toma', async () => {
  const hugo = await envio('hugo.mal@ejemplo.test');
  const b = buzon([aviso('<aviso-viejo@ejemplo.test>', 'hugo.mal@ejemplo.test', despues(T0, 30_000))]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: despues(T0, 20 * 86_400_000), dias: 14 });
  assert.equal(r.revisados, 0);
  assert.equal((await estadoDe(hugo.fila))?.rebote, undefined);
});

await prueba('en modo de ensayo no escribe nada y dice qué anotaría', async () => {
  const ines = await envio('ines.mal@ejemplo.test');
  const antes = (await una(`select count(*)::int as c from nda_eventos`)).c;
  const b = buzon([aviso('<aviso-ines@ejemplo.test>', 'ines.mal@ejemplo.test', despues(T0, 25_000))]);
  const r = await sincronizarRebotes({ lector: b.lector, ahora: AHORA, simular: true });
  assert.equal(r.nuevos, 1);
  assert.equal(r.planeados?.[0].envioId, ines.id);
  assert.equal(r.planeados?.[0].motivo, 'Ese correo no existe (revisa que esté bien escrito)');
  assert.equal((await una(`select count(*)::int as c from nda_eventos`)).c, antes, 'no quedó nada anotado');
  assert.equal((await estadoDe(ines.fila))?.rebote, undefined);
});

await prueba('si el buzón no se puede leer, la revisión truena con un error claro y no deja nada a medias', async () => {
  const antes = (await una(`select count(*)::int as c from nda_eventos`)).c;
  await assert.rejects(() => sincronizarRebotes({ lector: { listar: async () => { throw new Error('Graph respondió 403 al leer el buzón del NDA'); }, texto: async () => '' }, ahora: AHORA }), /403/);
  assert.equal((await una(`select count(*)::int as c from nda_eventos`)).c, antes);
});

await prueba('rebotesVigentes: solo cuenta el rebote de la última salida de cada envío', async () => {
  const jose = await envio('jose@ejemplo.test');
  const luis = await envio('luis@ejemplo.test');
  const vigentes = await rebotesVigentes([jose.id, luis.id]);
  assert.equal(vigentes.size, 0);
  assert.equal((await rebotesVigentes([])).size, 0);
});

// ── Lo que ve la tabla por el endpoint ────────────────────────────────────────────────────────────────
await prueba('getNDAStatuses deja pasar `rebote` por su esquema (salida estricta) y no falla si la revisión falla', async () => {
  const max = await envio('max.mal@ejemplo.test');
  const b = buzon([aviso('<aviso-max@ejemplo.test>', 'max.mal@ejemplo.test', despues(T0, 12_000))]);
  await sincronizarRebotes({ lector: b.lector, ahora: AHORA });
  const r: any = await ep.estados.run({ projectCode: PROYECTO }, equipo);
  const fila = r.items.find((i: any) => i.rowId === max.fila);
  assert.equal(fila.estado, 'enviado');
  assert.equal(fila.rebote.codigo, '5.1.1');
  assert.ok(!r.items.find((i: any) => i.rowId === ana.fila).rebote, 'el que ya se reenvió no trae rebote');
  const d: any = await ep.detalle.run({ rowId: max.fila }, equipo);
  assert.equal(d.envios[0].rebote.motivo, 'Ese correo no existe (revisa que esté bien escrito)');
});

// ── La bitácora y su restricción ──────────────────────────────────────────────────────────────────────
await prueba('la bitácora acepta los dos tipos nuevos, sigue rechazando otros y sigue sin poder editarse', async () => {
  const x = await envio('bitacora@ejemplo.test');
  await pg.query(`insert into nda_eventos (envio_id, tipo) values ($1, 'rebotado'), ($1, 'copia_rebotada')`, [x.id]);
  await assert.rejects(() => pg.query(`insert into nda_eventos (envio_id, tipo) values ($1, 'inventado')`, [x.id]), /nda_eventos_tipo_chk/);
  await assert.rejects(() => pg.query(`update nda_eventos set detalle = 'otra cosa' where envio_id = $1 and tipo = 'rebotado'`, [x.id]), /bitácora/);
  await assert.rejects(() => pg.query(`delete from nda_eventos where envio_id = $1 and tipo = 'rebotado'`, [x.id]), /bitácora/);
});
await prueba('correr otra vez el script de tablas (con la base ya en uso) deja los datos y la restricción nueva', async () => {
  const antes = (await una(`select count(*)::int as c from nda_eventos where tipo = 'rebotado'`)).c;
  for (const sql of SQL_NDA) await pg.exec(sql);
  assert.equal((await una(`select count(*)::int as c from nda_eventos where tipo = 'rebotado'`)).c, antes);
  await pg.query(`insert into nda_eventos (envio_id, tipo) values ($1, 'rebotado')`, [ana.id]);
});
await prueba('una base que todavía tiene la restricción VIEJA la recibe ampliada al correr el script', async () => {
  const vieja = await PGlite.create({ parsers });
  await vieja.exec(
    fs.readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8')
      .replace(/create extension if not exists pg_trgm;.*/g, '')
      .replace(/create index on recruitment_rows using gin \(participant_name gin_trgm_ops\);/, ''),
  );
  await vieja.exec(`alter table nda_eventos drop constraint nda_eventos_tipo_chk, add constraint nda_eventos_tipo_chk check ("tipo" in ('enviado', 'reenviado', 'abierto', 'firmado', 'rechazado', 'copia_enviada', 'copia_fallida', 'pdf_creado', 'pdf_fallido'))`);
  await assert.rejects(() => vieja.query(`insert into nda_eventos (tipo) values ('rebotado')`), /nda_eventos_tipo_chk/);
  for (const sql of SQL_NDA) await vieja.exec(sql);
  await vieja.query(`insert into nda_eventos (tipo) values ('rebotado'), ('copia_rebotada')`);
  await assert.rejects(() => vieja.query(`insert into nda_eventos (tipo) values ('inventado')`), /nda_eventos_tipo_chk/);
  await vieja.close();
});

// ── Cuándo se revisa ──────────────────────────────────────────────────────────────────────────────────
await prueba('la revisión la dispara la tabla, como mucho cada 5 minutos, sin esperar y sin tumbar nada si falla', async () => {
  delete process.env.NDA_REBOTES;
  const errores: unknown[][] = [];
  const antesDeError = console.error;
  console.error = (...a: unknown[]) => { errores.push(a); };
  try {
    await reiniciarRevisionDeRebotes();
    let corridas = 0;
    let reloj = 10_000_000_000;
    const ahora = () => reloj;
    const sincronizar = async () => { corridas++; };
    revisarRebotesSiToca({ ahora, sincronizar });
    revisarRebotesSiToca({ ahora, sincronizar });
    assert.equal(corridas, 1, 'la segunda llamada, enseguida, no corre otra');
    await reiniciarRevisionDeRebotes();
    revisarRebotesSiToca({ ahora, sincronizar }); // reiniciar olvidó la última: corre
    await reiniciarRevisionDeRebotes();
    reloj += 6 * MIN;
    revisarRebotesSiToca({ ahora, sincronizar });
    revisarRebotesSiToca({ ahora, sincronizar });
    assert.equal(corridas, 3, 'pasados 5 minutos corre otra vez, y solo una');
    // Si falla, lo anota en el registro y sigue.
    await reiniciarRevisionDeRebotes();
    reloj += 6 * MIN;
    revisarRebotesSiToca({ ahora, sincronizar: async () => { throw new Error('Graph respondió 403'); } });
    await reiniciarRevisionDeRebotes();
    assert.equal(errores.length, 1);
    // NDA_REBOTES=no la apaga.
    process.env.NDA_REBOTES = 'no';
    await reiniciarRevisionDeRebotes();
    revisarRebotesSiToca({ ahora, sincronizar });
    assert.equal(corridas, 3);
  } finally {
    console.error = antesDeError;
    process.env.NDA_REBOTES = 'no';
  }
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
