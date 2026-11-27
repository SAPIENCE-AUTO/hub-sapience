// Reglas de los avisos del chat (sonido, notificación del escritorio, globito de no leídos y número en el título de la pestaña), sin DOM ni red para poder probarlas
// solas. Lo que hacen el sonido y la notificación en sí está en chatNotifications.ts; aquí se decide CUÁNDO y CON QUÉ TEXTO.
//
// Lo que se corrigió (Sergio, 2026-11-27, «¿la manera en la que está programada la notificación es la correcta?»):
//  1. Un mensaje del canal que la persona tiene abierto solo se callaba por estar abierto, aunque la persona estuviera en otra pestaña o en otra aplicación: ni
//     sonido, ni notificación, ni número en el título. Ahora solo se calla si de verdad lo está viendo (ventana a la vista y con el foco).
//  2. La notificación de una conversación decía «Nombre en #<código largo de la conversación>» y siempre «Nuevo mensaje». Ahora el título es la persona (y el
//     grupo, si es de grupo) y el texto es el inicio del mensaje.
//  3. La campana «Silenciar» solo apagaba el sonido dentro del Hub: la notificación del escritorio seguía sonando con el sonido del sistema cuando se estaba en otra
//     ventana. Ahora, con la campana apagada, la notificación sale sin sonido.

/** Las conversaciones directas y de grupo tienen un UUID como id; los canales (general, proyectos) tienen un nombre o código. */
export const esCanalDeConversacion = (canal: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canal);

/** Lo que llega del servidor en cada mensaje nuevo (los campos de conversación son opcionales: un servidor viejo no los manda). */
export interface AvisoMensaje {
  channel: string;
  messageId?: string;
  senderName?: string;
  hasMention: boolean;
  sentAt?: string;
  contentPreview?: string;
  /** El hook lo marca cuando el mensaje es del canal que la persona tiene abierto en el chat. */
  isActiveChannel?: boolean;
  isConversation?: boolean;
  conversationType?: string | null;
  conversationName?: string | null;
}

export interface EntradaAviso {
  /** El mensaje es del canal que la persona tiene abierto en el chat. */
  canalAbierto: boolean;
  /** La ventana del Hub está a la vista y con el foco: la persona la está viendo. */
  mirando: boolean;
  /** La persona silenció este canal. */
  silenciado: boolean;
  /** Es una mención o una conversación directa o de grupo (lo que merece sonido y notificación). */
  urgente: boolean;
  /** La campana del chat está encendida. */
  sonidoActivo: boolean;
  /** El mensaje trae id: sin él no se puede evitar avisar dos veces del mismo. */
  conId: boolean;
}

export interface DecisionAviso {
  /** Pedirle a la pantalla del chat que traiga el mensaje ya. */
  avisarAChatPage: boolean;
  /** Sumarlo a los no leídos (contador, globito y mención). */
  sumarNoLeido: boolean;
  /** Contarlo solo para el título de la pestaña: llegó en el canal abierto mientras la persona no miraba. */
  contarMientrasFuera: boolean;
  sonar: boolean;
  notificar: boolean;
}

/**
 * Qué hacer con un mensaje nuevo.
 *  - Un canal silenciado nunca interrumpe (ni sonido, ni notificación, ni número).
 *  - Canal abierto y la persona mirando: solo se trae el mensaje, no se avisa de nada.
 *  - Canal abierto y la persona NO mirando: se trae el mensaje y se avisa igual que si fuera de otro canal (sonido y notificación si es urgente, y número en
 *    el título), pero sin tocar los no leídos: el mensaje ya está en la pantalla del chat y no queda pendiente de abrir ningún canal.
 *  - Canal que no está abierto: se suma a los no leídos y, si es urgente, suena y notifica. Que la ventana esté a la vista no cambia nada.
 *  - Sin sonido (campana apagada) no suena, pero la notificación sí sale (sin sonido, ver notificacionSilenciosa). Sin id del mensaje no suena ni notifica.
 */
export function decidirAviso(entrada: EntradaAviso): DecisionAviso {
  const avisa = !entrada.silenciado;
  const conAviso = avisa && entrada.urgente && entrada.conId;
  if (entrada.canalAbierto) {
    const fuera = avisa && !entrada.mirando;
    return {
      avisarAChatPage: true,
      sumarNoLeido: false,
      contarMientrasFuera: fuera,
      sonar: fuera && conAviso && entrada.sonidoActivo,
      notificar: fuera && conAviso,
    };
  }
  return {
    avisarAChatPage: false,
    sumarNoLeido: avisa,
    contarMientrasFuera: false,
    sonar: conAviso && entrada.sonidoActivo,
    notificar: conAviso,
  };
}

/** La notificación del escritorio sale sin sonido si la campana está apagada o si el sonido del Hub ya suena porque la persona está mirando la ventana. */
export const notificacionSilenciosa = (o: { sonidoActivo: boolean; mirando: boolean }): boolean => !o.sonidoActivo || o.mirando;

/**
 * El texto de la notificación del escritorio. Una conversación directa se muestra como la persona que escribe; una de grupo, como «persona en Grupo» (si el
 * servidor mandó el nombre); un canal, como «persona en #canal». Nunca se muestra el código largo de una conversación. El texto es el inicio del mensaje.
 */
export function construirNotificacion(aviso: AvisoMensaje): { titulo: string; cuerpo: string } {
  const remitente = (aviso.senderName ?? '').trim() || 'Alguien';
  const esConversacion = aviso.isConversation ?? esCanalDeConversacion(aviso.channel);
  const nombreDelGrupo = (aviso.conversationName ?? '').trim();
  const titulo = esConversacion
    ? (aviso.conversationType === 'Group' && nombreDelGrupo ? `${remitente} en ${nombreDelGrupo}` : remitente)
    : `${remitente} en #${aviso.channel}`;
  const resumen = (aviso.contentPreview ?? '').trim();
  const cuerpo = aviso.hasMention
    ? (resumen ? `Te mencionó: ${resumen}` : 'Te mencionó')
    : (resumen || 'Nuevo mensaje');
  return { titulo, cuerpo };
}

/** Todo lo que toca el mundo de afuera (pantalla, almacenamiento, sonido), para que `procesarAvisoDeChat` se pueda probar con piezas de mentira. */
export interface EntornoAvisos {
  silenciados: () => Set<string>;
  sonidoActivo: () => boolean;
  mirando: () => boolean;
  /** Devuelve true la PRIMERA vez que ve la clave (evita sonar o notificar dos veces del mismo mensaje). */
  primeraVez: (clave: string) => boolean;
  avisarAChatPage: (aviso: AvisoMensaje) => void;
  sumarNoLeido: (aviso: AvisoMensaje) => void;
  contarMientrasFuera: (conMencion: boolean) => void;
  sonar: () => void;
  notificar: (aviso: AvisoMensaje, opciones: { sonidoActivo: boolean }) => void;
}

/** Aplica `decidirAviso` a un mensaje nuevo. Devuelve lo decidido (para las pruebas). */
export function procesarAvisoDeChat(aviso: AvisoMensaje, entorno: EntornoAvisos): DecisionAviso {
  const sonidoActivo = entorno.sonidoActivo();
  const decision = decidirAviso({
    canalAbierto: !!aviso.isActiveChannel,
    mirando: entorno.mirando(),
    silenciado: entorno.silenciados().has(aviso.channel),
    urgente: aviso.hasMention || esCanalDeConversacion(aviso.channel),
    sonidoActivo,
    conId: !!aviso.messageId,
  });
  if (decision.avisarAChatPage) entorno.avisarAChatPage(aviso);
  if (decision.sumarNoLeido) entorno.sumarNoLeido(aviso);
  if (decision.contarMientrasFuera) entorno.contarMientrasFuera(aviso.hasMention);
  if (decision.sonar && aviso.messageId && entorno.primeraVez(aviso.messageId)) entorno.sonar();
  if (decision.notificar && aviso.messageId && entorno.primeraVez(`notif-${aviso.messageId}`)) entorno.notificar(aviso, { sonidoActivo });
  return decision;
}

// ── Abrir una conversación o un canal desde una notificación del escritorio ──
/** Lo que deja Layout.abrirConversacionDelChat en sessionStorage cuando se hace clic en una notificación. */
export interface PedidoAbrirChat { channel?: string; at?: number }

export type AccionPedido =
  | { tipo: 'nada' }                                      // no hay pedido
  | { tipo: 'descartar' }                                 // pedido viejo, o esa conversación ya es la que está abierta
  | { tipo: 'esperar' }                                   // una conversación que todavía no está en las listas (se están cargando)
  | { tipo: 'dm'; id: string; otro: string }              // chat directo; `otro` es el correo de la otra persona
  | { tipo: 'grupo'; id: string; nombre: string }
  | { tipo: 'canal'; canal: string };                     // «general» o un proyecto

/** Un pedido de abrir el chat que tiene más de 2 minutos ya no es lo que la persona quiere ver. */
export const VIGENCIA_PEDIDO_MS = 2 * 60 * 1000;

/**
 * Qué hacer con un pedido de abrir una conversación o un canal. Las conversaciones (UUID) se buscan en las listas ya cargadas; si todavía no están, se
 * espera (la pantalla vuelve a preguntar cuando llegan). Todo lo que no es UUID es un canal («general» o un proyecto) y se abre directo.
 */
export function resolverPedidoDeApertura(
  pedido: PedidoAbrirChat | null | undefined,
  o: { ahora: number; canalAbierto: string; miCorreo: string; dms: Array<{ id: string; members: string[] }>; grupos: Array<{ id: string; name: string }> },
): AccionPedido {
  const canal = pedido?.channel;
  if (!canal) return { tipo: 'nada' };
  if (pedido?.at && o.ahora - pedido.at > VIGENCIA_PEDIDO_MS) return { tipo: 'descartar' };
  if (canal === o.canalAbierto) return { tipo: 'descartar' };
  const dm = o.dms.find((c) => c.id === canal);
  if (dm) return { tipo: 'dm', id: canal, otro: dm.members.find((e) => e !== o.miCorreo) ?? '' };
  const grupo = o.grupos.find((c) => c.id === canal);
  if (grupo) return { tipo: 'grupo', id: canal, nombre: grupo.name };
  if (esCanalDeConversacion(canal)) return { tipo: 'esperar' };
  return { tipo: 'canal', canal };
}
