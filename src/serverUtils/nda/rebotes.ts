// Rebotes del correo del NDA (guía: docs/nda.md → «Si el correo no llega»). Cuando un correo no se puede entregar (el correo no existe, está mal escrito, el buzón está lleno…) el servidor de la persona
// devuelve un aviso al buzón desde el que se mandó (`sesiones@`). Aquí se leen esos avisos, se ligan a la salida del correo que los causó y se anotan en la bitácora (`rebotado` / `copia_rebotada`).
// Solo LEE el buzón (no marca, mueve ni borra nada), solo toma lo que es del NDA y no guarda el aviso: solo el correo (que ya está en el envío), el motivo en palabras, el código y la clave del mensaje.
// La tabla del NDA muestra «No llegó» cuando la ÚLTIMA salida de un envío rebotó y la persona todavía no abre la liga (ver `rebotesVigentes`).
// Lo que NO se ve: un correo que el servidor de la persona acepta y manda a spam; ahí solo cuenta que la persona abra la liga («Abrió»).
import { pool } from '../../../server/compat';
import { graphFetch, graphMailboxBase } from '../../../server/microsoft/graph';
import { remitenteNda } from './outlook';

export type TipoAviso = 'invitacion' | 'copia';
export interface AvisoLeido { tipo: TipoAviso; correo: string; codigos: string[]; motivo: string }
/** Un mensaje del buzón que parece un aviso de «no se pudo entregar». `clave` es única y estable (para no anotarlo dos veces); `ref` es lo que el lector necesita para traer su texto. */
export interface AvisoCandidato { clave: string; ref: string; asunto: string; de: string; recibidoAt: Date }
export interface LectorBuzon {
  listar(desde: Date): Promise<AvisoCandidato[]>;
  texto(ref: string): Promise<string>;
}
/** Lo que queda anotado en `detalle` de un evento `rebotado` o `copia_rebotada` (JSON). `salida` es el `n` del evento `enviado`/`reenviado`/`copia_enviada` que rebotó. */
export interface DetalleRebote { salida: string; correo: string; motivo: string; codigo?: string; aviso: string }
export interface ReboteDeEnvio { at: string; motivo: string; codigo?: string }

// ── leer un aviso ───────────────────────────────────────────────────────────────────────────────────
const DE_SISTEMA = /postmaster|mailer-daemon|microsoftexchange/i;
const ASUNTO_DE_AVISO = /undeliver|no se (puede|pudo) entregar|couldn.?t be delivered|wasn.?t delivered|delivery (status|has failed|failure)|returned mail|failure notice|rebot/i;

const ES_DEMORA = /\b(delay(ed)?|retrasad[oa]|demorad[oa]|demora)\b/i;
const ES_FALLA = /undeliver|failure|failed|no se (puede|pudo) entregar|couldn.?t be delivered/i;

/** ¿Parece un aviso de que un correo no se pudo entregar? (por quién lo manda o por su asunto; después se confirma que es del NDA). */
export const pareceAviso = (asunto: string, de: string): boolean => DE_SISTEMA.test(de) || ASUNTO_DE_AVISO.test(asunto);

const CORREO = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const CORREOS = new RegExp(CORREO.source, 'g');
// Cómo anuncian los servidores a quién no le llegó (Microsoft 365 en inglés y en español, y los formatos más comunes de otros).
const ANTES_DEL_CORREO = [
  /failed to these recipients or groups:\s*/i,
  /no se pudo entregar a estos destinatarios o grupos:\s*/i,
  /your message to\s+/i,
  /wasn.?t delivered to\s+/i,
  /couldn.?t be delivered to\s+/i,
  /tu mensaje (?:a|para)\s+/i,
];

function destinatario(texto: string, propio: string): string | undefined {
  for (const re of ANTES_DEL_CORREO) {
    const m = re.exec(texto);
    if (!m) continue;
    const c = CORREO.exec(texto.slice(m.index + m[0].length, m.index + m[0].length + 200));
    if (c) return c[0].toLowerCase();
  }
  // Otro formato: el primer correo que no es el nuestro ni de un sistema.
  for (const c of texto.match(CORREOS) ?? []) {
    const l = c.toLowerCase();
    if (l !== propio.toLowerCase() && !DE_SISTEMA.test(l)) return l;
  }
  return undefined;
}

/** El motivo en palabras. Gana el más específico: un buzón lleno llega con el código genérico de «mensaje expirado» (5.4.300) y el de buzón lleno (4.2.2) juntos. */
export function motivoEnPalabras(codigos: string[], texto: string): string {
  const t = texto.toLowerCase();
  const tiene = (...cs: string[]) => cs.some((c) => codigos.includes(c));
  if (tiene('4.2.2', '5.2.2') || /out of storage|over ?quota|mailbox (is )?full|inbox is full|storage space|buz[oó]n .{0,20}lleno/.test(t)) return 'El buzón de la persona está lleno';
  if (tiene('5.4.310', '5.1.2', '5.4.4') || /dns domain|domain .{0,40}(does not exist|not found|couldn.?t be found)|host not found|no such domain|dominio .{0,30}no existe/.test(t)) return 'El dominio del correo no existe (revisa cómo está escrito)';
  if (tiene('5.1.1', '5.1.10', '5.1.0') || /address(es)? (couldn.?t|could not|not) be found|does not exist|user unknown|unknown user|no such user|recipient not found|recipientnotfound|not found by smtp|no existe/.test(t)) return 'Ese correo no existe (revisa que esté bien escrito)';
  if (tiene('5.2.1') || /disabled|inactive|suspended|deshabilitad|desactivad/.test(t)) return 'El buzón de la persona está desactivado';
  if (codigos.some((c) => c.startsWith('5.7')) || /blocked|spam|policy|refused|rejected|denied|bloque/.test(t)) return 'El servidor del correo lo bloqueó';
  if (tiene('5.4.300') || /message expired|didn.?t respond|isn.?t accepting connection|not responding|no respondi/.test(t)) return 'El servidor del correo de la persona no respondió';
  return 'No se pudo entregar el correo';
}

/**
 * Lo que dice un aviso, si es de un correo del NDA (la invitación con la liga o la copia firmada); `null` si es de otra cosa (un correo de Prework, por ejemplo).
 * `texto` es el texto del aviso sin etiquetas; `propio` es el buzón del que sale el NDA (no cuenta como destinatario).
 */
export function leerAviso(asunto: string, texto: string, propio: string = remitenteNda()): AvisoLeido | null {
  // «Se está demorando» no es un rebote: el servidor sigue intentándolo y puede terminar entregándolo.
  if (ES_DEMORA.test(asunto) && !ES_FALLA.test(asunto)) return null;
  const todo = `${asunto}\n${texto}`;
  const tipo: TipoAviso | null = /tu copia del acuerdo de confidencialidad/i.test(todo) ? 'copia' : /tu acuerdo de confidencialidad/i.test(todo) ? 'invitacion' : null;
  if (!tipo) return null;
  const correo = destinatario(texto, propio);
  if (!correo) return null;
  // Los códigos de estado solo se buscan antes de las cabeceras del mensaje original (ahí hay números de versión que se les parecen).
  const aviso = texto.split(/original message headers|encabezados del mensaje original|mensaje original/i)[0];
  const codigos = [...new Set(aviso.match(/\b[45]\.\d{1,3}\.\d{1,3}\b/g) ?? [])];
  return { tipo, correo, codigos, motivo: motivoEnPalabras(codigos, aviso) };
}

export function htmlATexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── leer el buzón (Microsoft Graph) ─────────────────────────────────────────────────────────────────
const MAX_PAGINAS = 20;
const ESPERA_GRAPH_MS = 20_000;

/** El lector real: la bandeja de entrada del buzón del NDA, solo lectura (el permiso `Mail.Read` de la aplicación). Trae los mensajes desde `desde` y se queda con los que parecen avisos de rebote. */
export const lectorGraph: LectorBuzon = {
  async listar(desde) {
    const base = graphMailboxBase(remitenteNda());
    const filtro = encodeURIComponent(`receivedDateTime ge ${desde.toISOString()}`);
    let url: string | null = `${base}/mailFolders/inbox/messages?$filter=${filtro}&$select=id,internetMessageId,subject,from,receivedDateTime&$top=100&$orderby=receivedDateTime desc`;
    const out: AvisoCandidato[] = [];
    for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina++) {
      const r: Response = await graphFetch(url, { signal: AbortSignal.timeout(ESPERA_GRAPH_MS) });
      if (!r.ok) throw new Error(`Graph respondió ${r.status} al leer el buzón del NDA`);
      const j = (await r.json()) as { value?: { id: string; internetMessageId?: string; subject?: string; from?: { emailAddress?: { address?: string } }; receivedDateTime: string }[]; '@odata.nextLink'?: string };
      for (const m of j.value ?? []) {
        const asunto = m.subject ?? '';
        const de = m.from?.emailAddress?.address ?? '';
        if (pareceAviso(asunto, de)) out.push({ clave: m.internetMessageId || m.id, ref: m.id, asunto, de, recibidoAt: new Date(m.receivedDateTime) });
      }
      url = j['@odata.nextLink'] ?? null;
    }
    return out;
  },
  async texto(ref) {
    const r = await graphFetch(`${graphMailboxBase(remitenteNda())}/messages/${encodeURIComponent(ref)}?$select=body`, { signal: AbortSignal.timeout(ESPERA_GRAPH_MS) });
    if (!r.ok) throw new Error(`Graph respondió ${r.status} al leer un aviso`);
    const j = (await r.json()) as { body?: { content?: string } };
    return htmlATexto(j.body?.content ?? '');
  },
};

// ── anotar los rebotes ──────────────────────────────────────────────────────────────────────────────
/** Candado de la base para que dos servidores (o dos revisiones a la vez) no anoten el mismo aviso dos veces. */
const CANDADO_REBOTES = 724_001;
/** Cuánto atrás se busca la salida de un correo que rebotó: un servidor reintenta hasta uno o dos días antes de rendirse. */
const DIAS_ATRAS_DE_LA_SALIDA = 14;
/** Un aviso inmediato (el dominio no existe) puede llegar un instante antes de que se anote la salida del correo. */
const MARGEN_DE_RELOJ_MIN = 2;

export interface Planeado { envioId: string; tipo: 'rebotado' | 'copia_rebotada'; salida: string; correo: string; motivo: string; codigo?: string; recibidoAt: Date; clave: string }
export interface ResultadoRebotes { revisados: number; nuevos: number; sinSalida: number; planeados?: Planeado[] }

/** Avisos ya leídos que no hay que volver a pedir en cada revisión (no eran del NDA, como un correo de Prework, o repetían uno ya anotado), mientras el servidor siga encendido. */
const ajenos = new Set<string>();

async function yaAnotadas(claves: string[]): Promise<Set<string>> {
  const vistas = new Set<string>();
  if (!claves.length) return vistas;
  const { rows } = await pool.query<{ detalle: string | null }>(`select detalle from nda_eventos where tipo in ('rebotado', 'copia_rebotada')`);
  for (const r of rows) {
    try { const d = JSON.parse(r.detalle ?? '{}') as Partial<DetalleRebote>; if (d.aviso) vistas.add(d.aviso); } catch { /* una anotación que no es JSON no es de aquí */ }
  }
  return vistas;
}

/**
 * Revisa el buzón y anota los rebotes nuevos del NDA. Idempotente: un aviso se anota una sola vez (por su clave), aunque se revise cien veces o desde dos servidores.
 * La anotación lleva la hora en que LLEGÓ el aviso (no la de ahora) y la salida del correo que rebotó: la salida más reciente a ese correo antes del aviso.
 * Así un aviso tardío por una salida vieja no marca como rebotada una salida nueva, y un reenvío limpia el «No llegó» solo.
 * Con `simular` no escribe nada: devuelve lo que anotaría (para ensayar contra el buzón real).
 */
export async function sincronizarRebotes(o: { lector?: LectorBuzon; ahora?: Date; dias?: number; simular?: boolean } = {}): Promise<ResultadoRebotes> {
  const lector = o.lector ?? lectorGraph;
  const desde = new Date((o.ahora ?? new Date()).getTime() - (o.dias ?? 14) * 86_400_000);
  const candidatos = (await lector.listar(desde)).filter((c) => !ajenos.has(c.clave));
  const vistas = await yaAnotadas(candidatos.map((c) => c.clave));
  const nuevos = candidatos.filter((c) => !vistas.has(c.clave));

  const propio = remitenteNda();
  const leidos: { c: AvisoCandidato; a: AvisoLeido }[] = [];
  for (const c of nuevos) {
    let texto: string;
    try { texto = await lector.texto(c.ref); } catch (e) { console.error('[nda] no se pudo leer un aviso de rebote', e instanceof Error ? e.message : e); continue; }
    const a = leerAviso(c.asunto, texto, propio);
    if (a) leidos.push({ c, a }); else ajenos.add(c.clave);
  }
  const resultado: ResultadoRebotes = { revisados: candidatos.length, nuevos: 0, sinSalida: 0, ...(o.simular ? { planeados: [] } : {}) };
  if (!leidos.length) return resultado;

  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    await cliente.query('select pg_advisory_xact_lock($1)', [CANDADO_REBOTES]);
    // Otra revisión pudo anotarlos mientras se leían: se vuelve a mirar ya con el candado.
    const hechas = await yaAnotadas(leidos.map((x) => x.c.clave));
    const conAviso = new Set<string>(); // `tipo:salida` que ya tienen su aviso (en la base o en esta revisión)
    for (const { c, a } of leidos) {
      if (hechas.has(c.clave)) continue;
      const tiposDeSalida = a.tipo === 'invitacion' ? ['enviado', 'reenviado'] : ['copia_enviada'];
      const antes = await cliente.query<{ n: string; envio_id: string }>(
        `select n::text as n, envio_id from nda_eventos where tipo = any($1::text[]) and lower(detalle) = $2
            and created_at <= $3::timestamptz and created_at >= $3::timestamptz - $4::interval
          order by created_at desc, n desc limit 1`,
        [tiposDeSalida, a.correo, c.recibidoAt, `${DIAS_ATRAS_DE_LA_SALIDA} days`],
      );
      const salida = antes.rows[0] ?? (await cliente.query<{ n: string; envio_id: string }>(
        `select n::text as n, envio_id from nda_eventos where tipo = any($1::text[]) and lower(detalle) = $2
            and created_at > $3::timestamptz and created_at <= $3::timestamptz + $4::interval
          order by created_at asc, n asc limit 1`,
        [tiposDeSalida, a.correo, c.recibidoAt, `${MARGEN_DE_RELOJ_MIN} minutes`],
      )).rows[0];
      if (!salida) { resultado.sinSalida++; continue; }
      const tipo = a.tipo === 'invitacion' ? 'rebotado' : 'copia_rebotada';
      // Un mismo correo que rebota a veces avisa dos veces (dos mensajes distintos): se anota una sola por salida.
      const marca = `${tipo}:${salida.n}`;
      if (!conAviso.has(marca)) {
        const previas = await cliente.query<{ detalle: string | null }>(`select detalle from nda_eventos where envio_id = $1 and tipo = $2`, [salida.envio_id, tipo]);
        for (const p of previas.rows) { try { conAviso.add(`${tipo}:${(JSON.parse(p.detalle ?? '{}') as Partial<DetalleRebote>).salida}`); } catch { /* no es de aquí */ } }
      }
      if (conAviso.has(marca)) { ajenos.add(c.clave); continue; }
      conAviso.add(marca);
      const codigo = a.codigos[a.codigos.length - 1];
      const detalle: DetalleRebote = { salida: salida.n, correo: a.correo, motivo: a.motivo, ...(codigo ? { codigo } : {}), aviso: c.clave };
      if (o.simular) resultado.planeados!.push({ envioId: salida.envio_id, tipo, salida: salida.n, correo: a.correo, motivo: a.motivo, ...(codigo ? { codigo } : {}), recibidoAt: c.recibidoAt, clave: c.clave });
      else await cliente.query(`insert into nda_eventos (envio_id, tipo, detalle, actor, created_at) values ($1, $2, $3, 'sistema', $4)`, [salida.envio_id, tipo, JSON.stringify(detalle), c.recibidoAt]);
      resultado.nuevos++;
    }
    await cliente.query(o.simular ? 'rollback' : 'commit');
  } catch (e) {
    await cliente.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
  return resultado;
}

// ── cuándo revisar ──────────────────────────────────────────────────────────────────────────────────
let ultimaRevision = 0;
let enCurso: Promise<void> | null = null;
let ultimoAviso = 0;

/**
 * La revisión no tiene un reloj propio: la dispara la tabla del NDA (`getNDAStatuses`, que se pide cada 45 s mientras alguien la tiene abierta), como mucho una vez cada 5 minutos y sin hacer esperar la respuesta.
 * Si falla (el permiso, la red, la base) lo anota en el registro del servidor, a lo más una vez por hora, y la tabla sigue como siempre. `NDA_REBOTES=no` la apaga.
 */
export function revisarRebotesSiToca(o: { cadaMs?: number; ahora?: () => number; sincronizar?: () => Promise<unknown> } = {}): void {
  if ((process.env.NDA_REBOTES ?? '').toLowerCase() === 'no') return;
  const ahora = (o.ahora ?? Date.now)();
  if (enCurso || ahora - ultimaRevision < (o.cadaMs ?? 5 * 60_000)) return;
  ultimaRevision = ahora;
  enCurso = (o.sincronizar ?? sincronizarRebotes)()
    .then(() => undefined)
    .catch((e) => {
      if (ahora - ultimoAviso > 3_600_000) { ultimoAviso = ahora; console.error('[nda] no se pudieron revisar los rebotes', e instanceof Error ? e.message : e); }
    })
    .finally(() => { enCurso = null; });
}
/** Solo para las pruebas: olvida cuándo fue la última revisión y espera a la que esté corriendo. */
export async function reiniciarRevisionDeRebotes(): Promise<void> {
  await enCurso;
  ultimaRevision = 0; ultimoAviso = 0; ajenos.clear();
}

// ── lo que se ve en la tabla y en el detalle ────────────────────────────────────────────────────────
/**
 * El rebote vigente de cada envío: el de su ÚLTIMA salida (un reenvío lo limpia). Devuelve solo los que tienen uno.
 * Quien llama decide si lo muestra: la tabla lo muestra solo mientras el envío siga en «enviado» (si la persona ya abrió la liga por otro lado, el correo ya no importa).
 */
export async function rebotesVigentes(envioIds: string[]): Promise<Map<string, ReboteDeEnvio>> {
  const out = new Map<string, ReboteDeEnvio>();
  if (!envioIds.length) return out;
  const { rows } = await pool.query<{ envio_id: string; tipo: string; n: string; created_at: string; detalle: string | null }>(
    `select envio_id, tipo, n::text as n, created_at, detalle from nda_eventos where envio_id = any($1::uuid[]) and tipo in ('enviado', 'reenviado', 'rebotado') order by n`,
    [envioIds],
  );
  const ultimaSalida = new Map<string, string>();
  for (const r of rows) if (r.tipo !== 'rebotado') ultimaSalida.set(r.envio_id, r.n);
  for (const r of rows) {
    if (r.tipo !== 'rebotado') continue;
    let d: Partial<DetalleRebote>;
    try { d = JSON.parse(r.detalle ?? '{}') as Partial<DetalleRebote>; } catch { continue; }
    if (d.salida !== ultimaSalida.get(r.envio_id)) continue;
    out.set(r.envio_id, { at: new Date(r.created_at).toISOString(), motivo: d.motivo ?? 'No se pudo entregar el correo', ...(d.codigo ? { codigo: d.codigo } : {}) });
  }
  return out;
}

/** El motivo escrito en una anotación de rebote (para la línea de tiempo del detalle). */
export function motivoDeAnotacion(detalle: string | null | undefined): string | undefined {
  try { return (JSON.parse(detalle ?? '{}') as Partial<DetalleRebote>).motivo; } catch { return undefined; }
}
