// Mandar el NDA a un participante desde el Hub: toma de la fila el nombre y el correo, le crea (o reutiliza) su liga personal para firmar, manda el correo por Outlook y marca la fila como enviada.
// Lo usan el botón «NDA» de la tabla de Reclutamiento (endpoint sendNDAEmail) y el botón de columna con la acción «Enviar NDA» (executeButtonAction). Guía corta: docs/nda.md.
import { pool } from '../../../server/compat';
import { construirCorreoNda, describirSesion, desdeHoraMx, fechaHoraMx, limpiarNombre } from './correo';
import { mensajeDeFalla, remitenteNda, type EnvioCorreo } from './outlook';
import { borrarEnvioSinSalir, crearEnvio, depsNda, enlaceDe, registrarSalida, ultimoEnvioDeFila, type SesionNda } from './servicio';

export { ErrorDeEnvio, NDA_REMITENTE_POR_DEFECTO, enviarPorOutlook, remitenteNda } from './outlook';
export type { EnvioCorreo } from './outlook';

export interface ResultadoNda {
  enviado: boolean;
  mensaje: string;
  correo?: string;
  /** La liga personal para firmar (para copiarla y mandarla por WhatsApp). */
  enlace?: string;
  /** true cuando no se mandó porque se acababa de mandar (doble clic). */
  yaEnviado?: boolean;
}

export interface OpcionesEnvio {
  /** Mandar un NDA nuevo aunque el anterior ya esté firmado o rechazado (con su propia liga). Sin esto, esos casos no se vuelven a mandar. */
  nuevo?: boolean;
  /** Correo de quien aprieta el botón (queda en el registro del envío). */
  por?: string;
  /** La sesión a la que se compromete la persona: `fecha` es «AAAA-MM-DDTHH:mm» en hora de la Ciudad de México (lo que da un campo de fecha y hora) y `lugar` es opcional («En línea», la sede…). Sin esto el acuerdo sale sin el renglón de la sesión. */
  sesion?: { fecha: string; lugar?: string };
  /** Solo para pruebas. */
  enviar?: EnvioCorreo;
}

const fallo = (mensaje: string): ResultadoNda => ({ enviado: false, mensaje });

const CORREO_VALIDO = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const tablasFaltan = (e: unknown) => /nda_envios|nda_eventos/.test(String((e as Error)?.message)) && /does not exist|no existe/i.test(String((e as Error)?.message));

/**
 * Manda el NDA a la persona de la fila `rowId`.
 * - El nombre es el mismo que muestra la tabla (participante y, si falta, el nombre de la fila) y el correo es el de la fila.
 * - No manda nada si falta el nombre o el correo, o si la fila está eliminada.
 * - Si ya hay un envío pendiente (no ha firmado ni rechazado) se reenvía el correo con la MISMA liga; si ya firmó o rechazó, no se manda otro salvo que se pida (`nuevo`).
 * - No se manda dos veces en el mismo minuto: el doble clic no duplica el correo.
 * - Si Outlook no lo acepta, la fila y el envío quedan como estaban: nunca marca «enviado» algo que no salió.
 */
export async function enviarNdaDeFila(rowId: string, opts: OpcionesEnvio = {}): Promise<ResultadoNda> {
  const enviar = opts.enviar ?? depsNda.enviarCorreo;
  const { rows } = await pool.query<{
    participant_name: string | null; row_name: string | null; email: string | null; project_code: string | null; board_id: string | null;
    borrada: string; fecha_previa: string | null;
  }>(
    // deleted_at es TEXTO: viva = NULL o '' (ver CLAUDE.md); solo una fecha escrita la hace borrada.
    `select participant_name, row_name, email, project_code, board_id, coalesce(deleted_at, '') as borrada, nda_sent_date::text as fecha_previa
       from recruitment_rows where id = $1`,
    [rowId],
  );
  const fila = rows[0];
  if (!fila) return fallo('No encontré a este participante.');
  if (fila.borrada !== '') return fallo('Este participante está eliminado.');

  const nombre = limpiarNombre(fila.participant_name ?? '') || limpiarNombre(fila.row_name ?? '');
  if (!nombre) return fallo('Falta el nombre del participante.');
  const correo = (fila.email ?? '').trim();
  if (!correo) return fallo('Este participante no tiene correo.');
  if (!CORREO_VALIDO.test(correo)) return fallo(`El correo «${correo}» no parece válido.`);
  let sesion: SesionNda | null = null;
  if (opts.sesion) {
    const at = desdeHoraMx(opts.sesion.fecha);
    if (!at) return fallo('El día y la hora de la sesión no son válidos.');
    const lugar = limpiarNombre(opts.sesion.lugar ?? '').slice(0, 200) || null;
    sesion = { at, lugar, texto: describirSesion(at, lugar) };
  }

  // El último envío decide qué hacer: seguir con el pendiente, o no repetir uno que ya se resolvió.
  let ultimo;
  try {
    ultimo = await ultimoEnvioDeFila(rowId);
  } catch (e) {
    if (tablasFaltan(e)) return fallo('Faltan crear las tablas del NDA en la base de datos. No se mandó nada.');
    throw e;
  }
  const pendiente = !!ultimo && (ultimo.estado === 'enviado' || ultimo.estado === 'abierto');
  if (ultimo && !pendiente && !opts.nuevo) {
    return ultimo.estado === 'firmado'
      ? fallo(`Esta persona ya firmó el NDA el ${fechaHoraMx(new Date(ultimo.firmado_at!))}. Si quieres mandarle otro, usa «Mandar otro» en el detalle.`)
      : fallo(`Esta persona rechazó el NDA el ${fechaHoraMx(new Date(ultimo.rechazado_at!))}. Si quieres mandárselo de nuevo, usa «Mandar de nuevo» en el detalle.`);
  }

  // Se aparta el envío ANTES de mandarlo: dos clics casi juntos no pasan los dos (el segundo ve la fecha recién puesta).
  const apartado = await pool.query<{ reclamada: string }>(
    `update recruitment_rows set nda_sent_date = now()
      where id = $1 and (nda_sent_date is null or nda_sent_date < now() - interval '1 minute')
      returning nda_sent_date::text as reclamada`,
    [rowId],
  );
  if (apartado.rows.length === 0) {
    return { enviado: false, yaEnviado: true, mensaje: 'El NDA se acaba de enviar a esta persona. Si quieres mandarlo otra vez, espera un minuto.' };
  }
  const reclamada = apartado.rows[0].reclamada;
  const devolverFecha = () => pool.query(
    // Se devuelve la fecha anterior, salvo que alguien más ya la haya movido.
    `update recruitment_rows set nda_sent_date = $2::timestamptz where id = $1 and nda_sent_date::text = $3`,
    [rowId, fila.fecha_previa, reclamada],
  );

  let envio = pendiente ? ultimo! : null;
  const creado = !envio;
  try {
    envio ??= await crearEnvio({ rowId, projectCode: fila.project_code, boardId: fila.board_id, nombre, correo, por: opts.por, sesion });
  } catch (e) {
    console.error('[nda] no se pudo preparar el envío', { fila: rowId, error: e instanceof Error ? e.message : String(e) });
    await devolverFecha();
    return fallo('No se pudo preparar el NDA. Inténtalo de nuevo.');
  }
  const enlace = enlaceDe(envio.token);

  try {
    // Un reenvío sin sesión nueva conserva la que ya tenía el envío; con sesión nueva (la sesión se movió) manda la nueva y se guarda al salir el correo.
    const { asunto, html } = construirCorreoNda(nombre, enlace, sesion?.texto ?? envio.sesion_texto);
    await enviar({ desde: remitenteNda(), para: correo, asunto, html });
  } catch (e) {
    console.error('[nda] no se pudo enviar el NDA', { fila: rowId, error: e instanceof Error ? e.message : String(e) });
    if (creado) await borrarEnvioSinSalir(envio.id);
    await devolverFecha();
    return fallo(mensajeDeFalla(e));
  }

  // El correo ya salió: si anotarlo falla, la persona igual puede firmar (su liga existe); se avisa en el registro y no se le dice a quien apretó que falló.
  try {
    await registrarSalida(envio.id, { reenvio: !creado, nombre, correo, por: opts.por, sesion: creado ? null : sesion });
    await pool.query(`update recruitment_rows set nda_sent = true where id = $1`, [rowId]);
  } catch (e) {
    console.error('[nda] el correo salió pero no se pudo anotar', { fila: rowId, envio: envio.id, error: e instanceof Error ? e.message : String(e) });
  }
  return { enviado: true, mensaje: `NDA enviado a ${correo}`, correo, enlace };
}
