// Todo el SQL y el ciclo de vida del NDA con firma (guía: docs/nda.md). Cada envío (nda_envios) tiene una liga personal y pasa por: enviado → abierto (entró a la liga) → firmado | rechazado.
// Lo que firma o rechaza la persona entra por endpoints públicos (sin login, con el token de la liga); lo que ve el equipo, por los de Reclutamiento.
// Los cambios de estado son UNA sola sentencia con condición (`where estado in (...)`) que además escribe la bitácora (nda_eventos) en la misma sentencia: dos clics a la vez no firman dos veces
// y nunca queda un estado sin su registro. El PDF se hace DESPUÉS de guardar la firma (la firma nunca se pierde aunque Chrome o Storage fallen; se puede rehacer a pedido).
import crypto from 'node:crypto';
import sharp from 'sharp';
import { ZiteError, pool } from '../../../server/compat';
import { URL_FORMULARIOS } from '../../lib/formularios/dominio';
import {
  APERTURA_ANTES, APERTURA_DESPUES, NDA_SECCIONES, NDA_TEXTO_VERSION, NDA_TITULO,
  construirCorreoCopia, fechaHoraMx, limpiarNombre, ndaEnTexto,
} from './correo';
import { enviarPorOutlook, remitenteNda, type EnvioCorreo } from './outlook';
import { generarPdfNda, sha256, type DatosPdf } from './pdf';
import { almacenSupabase, type AlmacenNda } from './storage';

export type EstadoNda = 'enviado' | 'abierto' | 'firmado' | 'rechazado';

/** Lo que toca el mundo de afuera (correo, Chrome, Storage). En las pruebas se reemplaza. */
export interface DepsNda {
  enviarCorreo: EnvioCorreo;
  generarPdf: (d: DatosPdf) => Promise<Buffer>;
  almacen: AlmacenNda;
}
export const depsNda: DepsNda = { enviarCorreo: enviarPorOutlook, generarPdf: generarPdfNda, almacen: almacenSupabase };

/** De dónde vino la petición pública (sale de las cabeceras en server/index.ts). La IP es aproximada: apoya la constancia, no la prueba por sí sola. */
export type Peticion = { ip?: string; userAgent?: string };

/**
 * Dónde viven las ligas del NDA: el dominio de los participantes (sharpli.mx), que solo sirve las pantallas de ellos y nunca el Hub (src/lib/formularios/dominio.ts).
 * NDA_PUBLIC_URL lo cambia (p. ej. `http://localhost:5173` para probar las ligas contra el Hub local, o `http://sharpli.localhost:5173` para verlas como las ve el participante).
 */
export const urlPublica = () => (process.env.NDA_PUBLIC_URL ?? '').trim().replace(/\/+$/, '') || URL_FORMULARIOS;
export const enlaceDe = (token: string) => `${urlPublica()}/nda/${token}`;
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
const recortar = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);
const iso = (v: unknown): string | undefined => (v ? new Date(v as string).toISOString() : undefined);

const noEncontrado = () => new ZiteError({ code: 'NOT_FOUND', message: 'Este enlace no es válido.' });
const mala = (message: string) => new ZiteError({ code: 'BAD_REQUEST', message });
const conflicto = (message: string) => new ZiteError({ code: 'CONFLICT', message });

export type FilaEnvio = {
  id: string; token: string; recruitment_row_id: string; project_code: string | null; board_id: string | null;
  nombre: string | null; correo: string | null; estado: EstadoNda;
  enviado_at: string | null; ultimo_envio_at: string | null; envios: number | null;
  abierto_at: string | null; firmado_at: string | null; rechazado_at: string | null;
  motivo_rechazo: string | null; nombre_firmado: string | null; texto_version: string | null; texto_hash: string | null;
  pdf_path: string | null; pdf_hash: string | null; pdf_at: string | null;
  ip: string | null; user_agent: string | null; enviado_por: string | null; created_at: string;
  sesion_at: string | null; sesion_lugar: string | null; sesion_texto: string | null;
};
// (sin firma_png: pesa decenas de KB y solo hace falta al armar el PDF)
const COLS = 'id, token, recruitment_row_id, project_code, board_id, nombre, correo, estado, enviado_at, ultimo_envio_at, envios, abierto_at, firmado_at, rechazado_at, motivo_rechazo, nombre_firmado, texto_version, texto_hash, pdf_path, pdf_hash, pdf_at, ip, user_agent, enviado_por, created_at, sesion_at, sesion_lugar, sesion_texto';

async function evento(envioId: string, tipo: string, d: { ip?: string | null; userAgent?: string | null; detalle?: string | null; actor?: string | null } = {}) {
  await pool.query(
    `insert into nda_eventos (envio_id, tipo, ip, user_agent, detalle, actor, created_at) values ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [envioId, tipo, d.ip ?? null, recortar(d.userAgent, 300), recortar(d.detalle, 500), d.actor ?? null],
  );
}

async function porToken(token: string): Promise<FilaEnvio | null> {
  const { rows } = await pool.query<FilaEnvio>(`select ${COLS} from nda_envios where token = $1`, [token]);
  return rows[0] ?? null;
}

// ── Del lado del equipo: crear y registrar el envío (lo usa enviar.ts) ─────────────────────────────────
export async function ultimoEnvioDeFila(rowId: string): Promise<FilaEnvio | null> {
  const { rows } = await pool.query<FilaEnvio>(`select ${COLS} from nda_envios where recruitment_row_id = $1 order by n desc limit 1`, [rowId]);
  return rows[0] ?? null;
}

/** La sesión a la que se compromete la persona: el instante, el lugar (opcional) y el texto ya armado, que se congela con el envío. */
export type SesionNda = { at: Date; lugar: string | null; texto: string };

export async function crearEnvio(d: { rowId: string; projectCode: string | null; boardId: string | null; nombre: string; correo: string; por?: string | null; sesion?: SesionNda | null }): Promise<FilaEnvio> {
  const { rows } = await pool.query<FilaEnvio>(
    `insert into nda_envios (token, recruitment_row_id, project_code, board_id, nombre, correo, estado, envios, texto_version, enviado_por, sesion_at, sesion_lugar, sesion_texto)
     values ($1, $2, $3, $4, $5, $6, 'enviado', 0, $7, $8, $9, $10, $11) returning ${COLS}`,
    [nuevoToken(), d.rowId, d.projectCode, d.boardId, d.nombre, d.correo, NDA_TEXTO_VERSION, d.por ?? null, d.sesion?.at ?? null, d.sesion?.lugar ?? null, d.sesion?.texto ?? null],
  );
  return rows[0];
}

/** Para deshacer un envío que nació y no pudo salir. Solo borra si nunca salió (no hay evidencia que perder). */
export async function borrarEnvioSinSalir(envioId: string): Promise<void> {
  await pool.query(`delete from nda_envios where id = $1 and enviado_at is null`, [envioId]);
}

export async function registrarSalida(envioId: string, d: { reenvio: boolean; nombre: string; correo: string; por?: string | null; sesion?: SesionNda | null }): Promise<void> {
  // Un reenvío puede traer la sesión corregida (se movió): solo cambia mientras no haya firmado ni rechazado; lo firmado queda congelado.
  await pool.query(
    `update nda_envios set enviado_at = coalesce(enviado_at, clock_timestamp()), ultimo_envio_at = clock_timestamp(), envios = coalesce(envios, 0) + 1,
            nombre = $2, correo = $3, enviado_por = coalesce($4, enviado_por),
            sesion_at = case when $5::boolean and estado in ('enviado', 'abierto') then $6::timestamptz else sesion_at end,
            sesion_lugar = case when $5::boolean and estado in ('enviado', 'abierto') then $7 else sesion_lugar end,
            sesion_texto = case when $5::boolean and estado in ('enviado', 'abierto') then $8 else sesion_texto end
      where id = $1`,
    [envioId, d.nombre, d.correo, d.por ?? null, !!d.sesion, d.sesion?.at ?? null, d.sesion?.lugar ?? null, d.sesion?.texto ?? null],
  );
  await evento(envioId, d.reenvio ? 'reenviado' : 'enviado', { actor: d.por ?? null, detalle: d.correo });
}

// ── Del lado de la persona (endpoints públicos) ────────────────────────────────────────────────────────
export function textoEstructurado() {
  return { version: NDA_TEXTO_VERSION, titulo: NDA_TITULO, aperturaAntes: APERTURA_ANTES, aperturaDespues: APERTURA_DESPUES, secciones: NDA_SECCIONES };
}

/** Lo que ve la persona al abrir su liga. La primera vez deja constancia de que entró (estado «abierto»). */
export async function verEnlace(token: string, p: Peticion = {}, deps: DepsNda = depsNda) {
  let e = await porToken(token);
  if (!e) throw noEncontrado();
  if (e.estado === 'enviado') {
    await pool.query(
      `with t as (update nda_envios set estado = 'abierto', abierto_at = clock_timestamp() where id = $1 and estado = 'enviado' returning id)
       insert into nda_eventos (envio_id, tipo, ip, user_agent, actor, created_at) select id, 'abierto', $2, $3, 'participante', clock_timestamp() from t`,
      [e.id, p.ip ?? null, recortar(p.userAgent, 300)],
    );
    e = (await porToken(token))!;
  }
  const estado = e.estado === 'firmado' ? 'firmado' : e.estado === 'rechazado' ? 'rechazado' : 'pendiente';
  let pdfUrl: string | undefined;
  if (e.estado === 'firmado' && e.pdf_path) {
    try { pdfUrl = await deps.almacen.urlFirmada(e.pdf_path, 600); } catch { /* sin PDF por ahora: la página lo avisa */ }
  }
  return {
    estado,
    nombre: e.nombre_firmado || e.nombre || '',
    sesion: e.sesion_texto ?? undefined,
    texto: textoEstructurado(),
    firmadoAt: iso(e.firmado_at),
    rechazadoAt: iso(e.rechazado_at),
    pdfUrl,
  } as const;
}

/**
 * Revisa que la firma sea un PNG de verdad con trazo (no un cuadro vacío), la reduce a 600 px de ancho y la vuelve a codificar (así lo que se guarda es una imagen limpia y chica).
 * Acepta fondo transparente o blanco. Devuelve el PNG en base64 (sin prefijo).
 */
export async function normalizarFirma(entrada: string): Promise<string> {
  const falla = () => mala('Dibuja tu firma en el recuadro.');
  const b64 = entrada.replace(/^data:image\/png;base64,/, '').trim();
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw falla();
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 100 || buf.length > 400_000 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw falla();
  try {
    const reducida = sharp(buf, { limitInputPixels: 16_000_000 }).resize({ width: 600, withoutEnlargement: true });
    const { data, info } = await reducida.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let tinta = 0; let minX = info.width; let maxX = -1;
    for (let i = 0; i < data.length; i += 4) {
      const alfa = data[i + 3];
      if (alfa > 40 && (data[i] + data[i + 1] + data[i + 2]) / 3 < 200) {
        tinta++;
        const x = (i / 4) % info.width;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (tinta < 150 || maxX - minX < 40) throw falla();
    return (await reducida.png({ compressionLevel: 9 }).toBuffer()).toString('base64');
  } catch (e) {
    if (e instanceof ZiteError) throw e;
    throw falla();
  }
}

export type EntradaFirma = { nombre: string; firma: string; acepta: boolean };

export async function firmarEnvio(token: string, entrada: EntradaFirma, p: Peticion = {}): Promise<{ firmadoAt: string }> {
  const envio = await porToken(token);
  if (!envio) throw noEncontrado();
  if (envio.estado === 'firmado') throw conflicto('Este acuerdo ya está firmado.');
  if (envio.estado === 'rechazado') throw conflicto('Ya registramos que no aceptaste este acuerdo. Si fue un error, avísale a quien te lo mandó para que te envíe otro enlace.');
  const nombre = limpiarNombre(entrada.nombre);
  if (nombre.length < 5 || nombre.split(' ').length < 2) throw mala('Escribe tu nombre completo.');
  if (nombre.length > 120) throw mala('Tu nombre es demasiado largo.');
  if (entrada.acepta !== true) throw mala('Marca que leíste y aceptas el acuerdo.');
  const firma = await normalizarFirma(entrada.firma);
  const huella = sha256(`${NDA_TEXTO_VERSION}\n${ndaEnTexto(nombre, envio.sesion_texto)}`);

  const r = await pool.query<{ firmado_at: string }>(
    `with t as (
       update nda_envios set estado = 'firmado', firmado_at = clock_timestamp(), abierto_at = coalesce(abierto_at, clock_timestamp()),
              nombre_firmado = $2, texto_version = $3, texto_hash = $4, firma_png = $5, ip = $6, user_agent = $7
        where id = $1 and estado in ('enviado', 'abierto') returning id, firmado_at
     ), ev as (
       insert into nda_eventos (envio_id, tipo, ip, user_agent, detalle, actor, created_at)
       select id, 'firmado', $6, $7, $4, 'participante', clock_timestamp() from t returning id
     )
     select firmado_at from t`,
    [envio.id, nombre, NDA_TEXTO_VERSION, huella, firma, p.ip ?? null, recortar(p.userAgent, 300)],
  );
  if (r.rows.length === 0) throw conflicto('Este acuerdo ya no se puede firmar. Recarga la página.');
  programar(() => procesarPosFirma(envio.id));
  return { firmadoAt: iso(r.rows[0].firmado_at)! };
}

export async function rechazarEnvio(token: string, motivo: string | undefined, p: Peticion = {}): Promise<{ rechazadoAt: string }> {
  const envio = await porToken(token);
  if (!envio) throw noEncontrado();
  if (envio.estado === 'firmado') throw conflicto('Este acuerdo ya está firmado.');
  if (envio.estado === 'rechazado') return { rechazadoAt: iso(envio.rechazado_at)! };
  const razon = recortar(limpiarNombre(motivo ?? ''), 500);
  const r = await pool.query<{ rechazado_at: string }>(
    `with t as (
       update nda_envios set estado = 'rechazado', rechazado_at = clock_timestamp(), abierto_at = coalesce(abierto_at, clock_timestamp()),
              motivo_rechazo = $2, ip = $3, user_agent = $4
        where id = $1 and estado in ('enviado', 'abierto') returning id, rechazado_at
     ), ev as (
       insert into nda_eventos (envio_id, tipo, ip, user_agent, detalle, actor, created_at)
       select id, 'rechazado', $3, $4, $2, 'participante', clock_timestamp() from t returning id
     )
     select rechazado_at from t`,
    [envio.id, razon, p.ip ?? null, recortar(p.userAgent, 300)],
  );
  if (r.rows.length === 0) throw conflicto('Este acuerdo ya no se puede rechazar. Recarga la página.');
  return { rechazadoAt: iso(r.rows[0].rechazado_at)! };
}

// ── Después de firmar: el PDF y la copia por correo ────────────────────────────────────────────────────
const pendientes = new Set<Promise<unknown>>();
/** Trabajo que sigue después de responderle a la persona (PDF, copia). Si falla se registra y se puede rehacer a pedido; nunca tumba la firma. */
export function programar(trabajo: () => Promise<unknown>): void {
  const p: Promise<unknown> = trabajo()
    .catch((e) => console.error('[nda] tarea posterior a la firma falló', e instanceof Error ? e.message : e))
    .finally(() => { pendientes.delete(p); });
  pendientes.add(p);
}
/** Para las pruebas: espera a que terminen las tareas que quedaron corriendo. */
export const esperarTareasNda = () => Promise.all([...pendientes]).then(() => undefined);

const enCurso = new Map<string, Promise<{ ruta: string; pdf: Buffer | null }>>();

/** Hace el PDF del acuerdo firmado, lo guarda en Storage y anota ruta y huella. Si ya existe devuelve la ruta. Una sola vez a la vez por envío. */
export function crearPdfDeEnvio(envioId: string, deps: DepsNda = depsNda): Promise<{ ruta: string; pdf: Buffer | null }> {
  const previo = enCurso.get(envioId);
  if (previo) return previo;
  const p = (async () => {
    const { rows } = await pool.query<FilaEnvio & { firma_png: string | null }>(`select ${COLS}, firma_png from nda_envios where id = $1`, [envioId]);
    const e = rows[0];
    if (!e || e.estado !== 'firmado' || !e.firma_png || !e.firmado_at) throw new Error('El acuerdo no está firmado.');
    if (e.pdf_path) return { ruta: e.pdf_path, pdf: null };
    let pdf: Buffer;
    try {
      pdf = await deps.generarPdf({
        envioId, nombre: e.nombre_firmado ?? e.nombre ?? '', correo: e.correo ?? '', firmaPng: e.firma_png,
        firmadoAt: new Date(e.firmado_at), enviadoAt: e.enviado_at ? new Date(e.enviado_at) : null, abiertoAt: e.abierto_at ? new Date(e.abierto_at) : null,
        ip: e.ip, userAgent: e.user_agent, textoHash: e.texto_hash ?? '', textoVersion: e.texto_version ?? NDA_TEXTO_VERSION, sesion: e.sesion_texto,
      });
    } catch (err) {
      await evento(envioId, 'pdf_fallido', { detalle: err instanceof Error ? err.message : String(err), actor: 'sistema' }).catch(() => undefined);
      throw err;
    }
    const ruta = `${new Date(e.firmado_at).getUTCFullYear()}/${envioId}.pdf`;
    try {
      await deps.almacen.subir(ruta, pdf);
    } catch (err) {
      await evento(envioId, 'pdf_fallido', { detalle: err instanceof Error ? err.message : String(err), actor: 'sistema' }).catch(() => undefined);
      throw err;
    }
    const huella = sha256(pdf);
    await pool.query(`update nda_envios set pdf_path = $2, pdf_hash = $3, pdf_at = clock_timestamp() where id = $1 and pdf_path is null`, [envioId, ruta, huella]);
    await evento(envioId, 'pdf_creado', { detalle: huella, actor: 'sistema' });
    return { ruta, pdf };
  })().finally(() => { enCurso.delete(envioId); });
  enCurso.set(envioId, p);
  return p;
}

const nombreDeArchivo = (s: string) => limpiarNombre(s).replace(/[\\/:*?"<>|]/g, '').slice(0, 80);

async function enviarCopia(envioId: string, pdf: Buffer, deps: DepsNda): Promise<void> {
  const { rows } = await pool.query<{ nombre_firmado: string | null; correo: string | null; firmado_at: string | null }>(
    `select nombre_firmado, correo, firmado_at from nda_envios where id = $1`, [envioId],
  );
  const e = rows[0];
  if (!e?.correo || !e.firmado_at) return;
  try {
    const nombre = e.nombre_firmado ?? '';
    const { asunto, html } = construirCorreoCopia(nombre, fechaHoraMx(new Date(e.firmado_at)));
    await deps.enviarCorreo({
      desde: remitenteNda(), para: e.correo, asunto, html,
      adjuntos: [{ nombre: `Acuerdo de confidencialidad - ${nombreDeArchivo(nombre)}.pdf`, tipo: 'application/pdf', base64: pdf.toString('base64') }],
    });
    await evento(envioId, 'copia_enviada', { detalle: e.correo, actor: 'sistema' });
  } catch (err) {
    console.error('[nda] no se pudo mandar la copia firmada', err instanceof Error ? err.message : err);
    await evento(envioId, 'copia_fallida', { detalle: err instanceof Error ? err.message : String(err), actor: 'sistema' }).catch(() => undefined);
  }
}

export async function procesarPosFirma(envioId: string, deps: DepsNda = depsNda): Promise<void> {
  const hecho = await crearPdfDeEnvio(envioId, deps);
  if (hecho.pdf) await enviarCopia(envioId, hecho.pdf, deps);
}

// ── Del lado del equipo: lo que se ve en la tabla y en el detalle ─────────────────────────────────────
export type EstadoDeFila = {
  rowId: string; envioId: string; estado: EstadoNda;
  enviadoAt?: string; abiertoAt?: string; firmadoAt?: string; rechazadoAt?: string; tienePdf: boolean;
  /** Para llenar de nuevo el diálogo de reenvío con la sesión que ya tenía el envío. */
  sesionAt?: string; sesionLugar?: string;
};

/** El último envío de cada fila de un proyecto (lo que pinta la columna «NDA» de la tabla). */
export async function estadosDeProyecto(projectCode: string): Promise<EstadoDeFila[]> {
  const { rows } = await pool.query<{ recruitment_row_id: string; id: string; estado: EstadoNda; enviado_at: string | null; abierto_at: string | null; firmado_at: string | null; rechazado_at: string | null; tiene_pdf: boolean; sesion_at: string | null; sesion_lugar: string | null }>(
    `select distinct on (recruitment_row_id) recruitment_row_id, id, estado, enviado_at, abierto_at, firmado_at, rechazado_at, (pdf_path is not null) as tiene_pdf, sesion_at, sesion_lugar
       from nda_envios where project_code = $1 order by recruitment_row_id, n desc`,
    [projectCode],
  );
  return rows.map((r) => ({
    rowId: r.recruitment_row_id, envioId: r.id, estado: r.estado, tienePdf: r.tiene_pdf,
    ...(r.enviado_at ? { enviadoAt: iso(r.enviado_at) } : {}), ...(r.abierto_at ? { abiertoAt: iso(r.abierto_at) } : {}),
    ...(r.firmado_at ? { firmadoAt: iso(r.firmado_at) } : {}), ...(r.rechazado_at ? { rechazadoAt: iso(r.rechazado_at) } : {}),
    ...(r.sesion_at ? { sesionAt: iso(r.sesion_at) } : {}), ...(r.sesion_lugar ? { sesionLugar: r.sesion_lugar } : {}),
  }));
}

/**
 * Lo único del NDA que ve una vista externa (la liga de solo lectura que se comparte fuera del equipo): el estado del último envío de cada fila y la fecha de ese paso.
 * Nunca la liga de firma, el correo del envío, la IP, el dispositivo, la firma ni el PDF: con la liga alguien podría firmar por la persona.
 */
export async function estadoPublicoDeProyecto(projectCode: string): Promise<Map<string, { estado: EstadoNda; fecha?: string }>> {
  const porFila = new Map<string, { estado: EstadoNda; fecha?: string }>();
  for (const e of await estadosDeProyecto(projectCode)) {
    const fecha = e.estado === 'firmado' ? e.firmadoAt : e.estado === 'rechazado' ? e.rechazadoAt : e.estado === 'abierto' ? e.abiertoAt : e.enviadoAt;
    porFila.set(e.rowId, { estado: e.estado, ...(fecha ? { fecha } : {}) });
  }
  return porFila;
}

export async function detalleDeFila(rowId: string) {
  const { rows } = await pool.query<FilaEnvio>(`select ${COLS} from nda_envios where recruitment_row_id = $1 order by n desc`, [rowId]);
  const ids = rows.map((r) => r.id);
  const ev = ids.length
    ? (await pool.query<{ envio_id: string; tipo: string; created_at: string; actor: string | null; detalle: string | null }>(
        `select envio_id, tipo, created_at, actor, detalle from nda_eventos where envio_id = any($1::uuid[]) order by n`, [ids],
      )).rows
    : [];
  return rows.map((r) => ({
    id: r.id, estado: r.estado, nombre: r.nombre ?? '', correo: r.correo ?? '', enlace: enlaceDe(r.token), envios: r.envios ?? 0, tienePdf: !!r.pdf_path,
    ...(r.nombre_firmado ? { nombreFirmado: r.nombre_firmado } : {}),
    ...(r.enviado_at ? { enviadoAt: iso(r.enviado_at) } : {}), ...(r.ultimo_envio_at ? { ultimoEnvioAt: iso(r.ultimo_envio_at) } : {}),
    ...(r.abierto_at ? { abiertoAt: iso(r.abierto_at) } : {}), ...(r.firmado_at ? { firmadoAt: iso(r.firmado_at) } : {}), ...(r.rechazado_at ? { rechazadoAt: iso(r.rechazado_at) } : {}),
    ...(r.motivo_rechazo ? { motivoRechazo: r.motivo_rechazo } : {}), ...(r.enviado_por ? { enviadoPor: r.enviado_por } : {}),
    ...(r.ip ? { ip: r.ip } : {}), ...(r.user_agent ? { userAgent: r.user_agent } : {}),
    ...(r.sesion_texto ? { sesion: r.sesion_texto } : {}), ...(r.sesion_at ? { sesionAt: iso(r.sesion_at) } : {}), ...(r.sesion_lugar ? { sesionLugar: r.sesion_lugar } : {}),
    eventos: ev.filter((e) => e.envio_id === r.id).map((e) => ({ tipo: e.tipo, at: iso(e.created_at)!, ...(e.actor ? { actor: e.actor } : {}), ...(e.detalle ? { detalle: e.detalle } : {}) })),
  }));
}

/** Liga temporal al PDF firmado. Si por algún fallo no se alcanzó a guardar, se rehace aquí (y, si a la persona nunca le llegó su copia, se le manda). */
export async function urlDelPdf(envioId: string, deps: DepsNda = depsNda): Promise<string> {
  const { rows } = await pool.query<{ estado: EstadoNda; pdf_path: string | null }>(`select estado, pdf_path from nda_envios where id = $1`, [envioId]);
  const e = rows[0];
  if (!e) throw new ZiteError({ code: 'NOT_FOUND', message: 'No encontré ese acuerdo.' });
  if (e.estado !== 'firmado') throw mala('Este acuerdo todavía no está firmado.');
  let ruta = e.pdf_path;
  if (!ruta) {
    const hecho = await crearPdfDeEnvio(envioId, deps);
    ruta = hecho.ruta;
    if (hecho.pdf) {
      const ya = await pool.query(`select 1 from nda_eventos where envio_id = $1 and tipo = 'copia_enviada' limit 1`, [envioId]);
      if (ya.rows.length === 0) await enviarCopia(envioId, hecho.pdf, deps);
    }
  }
  return deps.almacen.urlFirmada(ruta, 600);
}
