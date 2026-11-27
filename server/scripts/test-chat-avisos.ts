// Pruebas de las reglas de los avisos del chat (src/lib/chatAvisos.ts): cuándo suena, cuándo sale la notificación del escritorio, cuándo cuenta para el título de la
// pestaña, con qué texto sale, y cómo se aplican todas juntas a un mensaje nuevo (con piezas de mentira en lugar de la pantalla, el almacenamiento y el sonido).
// Datos inventados. uso: node server/node_modules/.bin/tsx server/scripts/test-chat-avisos.ts
import assert from 'node:assert/strict';
import {
  VIGENCIA_PEDIDO_MS, construirNotificacion, decidirAviso, esCanalDeConversacion, notificacionSilenciosa, procesarAvisoDeChat, resolverPedidoDeApertura,
  type AvisoMensaje, type DecisionAviso, type EntradaAviso, type EntornoAvisos,
} from '../../src/lib/chatAvisos';

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

const CONVERSACION = '3f2a9c10-5b7d-4e21-9a6c-0d1e2f3a4b5c';
const OTRA_CONVERSACION = '9b8c7d6e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

// ═══ ¿Es una conversación? ═══
await prueba('esCanalDeConversacion: un UUID es una conversación; «general» y los códigos de proyecto no', () => {
  assert.equal(esCanalDeConversacion(CONVERSACION), true);
  assert.equal(esCanalDeConversacion(CONVERSACION.toUpperCase()), true);
  for (const canal of ['general', 'PROYECTO-UNO', 'BRIDGE', '', '3f2a9c10-5b7d-4e21-9a6c', `${CONVERSACION}x`, ` ${CONVERSACION}`]) {
    assert.equal(esCanalDeConversacion(canal), false, JSON.stringify(canal));
  }
});

// ═══ Cuándo avisar: las 64 combinaciones contra una tabla escrita aparte ═══
const BOOLS = [false, true];
const combinaciones: EntradaAviso[] = [];
for (const canalAbierto of BOOLS) for (const mirando of BOOLS) for (const silenciado of BOOLS) for (const urgente of BOOLS) for (const sonidoActivo of BOOLS) for (const conId of BOOLS) {
  combinaciones.push({ canalAbierto, mirando, silenciado, urgente, sonidoActivo, conId });
}
/** La regla escrita de otra forma (en tabla, de arriba abajo) para no copiar la implementación. */
function esperado(e: EntradaAviso): DecisionAviso {
  if (e.silenciado) return { avisarAChatPage: e.canalAbierto, sumarNoLeido: false, contarMientrasFuera: false, sonar: false, notificar: false };
  if (e.canalAbierto && e.mirando) return { avisarAChatPage: true, sumarNoLeido: false, contarMientrasFuera: false, sonar: false, notificar: false };
  const alerta = e.urgente && e.conId;
  if (e.canalAbierto) return { avisarAChatPage: true, sumarNoLeido: false, contarMientrasFuera: true, sonar: alerta && e.sonidoActivo, notificar: alerta };
  return { avisarAChatPage: false, sumarNoLeido: true, contarMientrasFuera: false, sonar: alerta && e.sonidoActivo, notificar: alerta };
}

await prueba('decidirAviso: las 64 combinaciones dan lo que dice la tabla', () => {
  assert.equal(combinaciones.length, 64);
  for (const e of combinaciones) assert.deepEqual(decidirAviso(e), esperado(e), JSON.stringify(e));
});

const base: EntradaAviso = { canalAbierto: false, mirando: true, silenciado: false, urgente: true, sonidoActivo: true, conId: true };

await prueba('el caso de Sergio: el chat abierto en una conversación, la ventana en otra pestaña y llega un mensaje de ESA conversación → suena, notifica y cuenta en el título', () => {
  const d = decidirAviso({ ...base, canalAbierto: true, mirando: false });
  assert.deepEqual(d, { avisarAChatPage: true, sumarNoLeido: false, contarMientrasFuera: true, sonar: true, notificar: true });
});

await prueba('el mismo mensaje con la ventana a la vista (la persona lo está viendo): solo se trae el mensaje, no se avisa de nada', () => {
  assert.deepEqual(decidirAviso({ ...base, canalAbierto: true, mirando: true }), { avisarAChatPage: true, sumarNoLeido: false, contarMientrasFuera: false, sonar: false, notificar: false });
});

await prueba('un mensaje del canal abierto con la ventana fuera de la vista NUNCA se suma a los no leídos (ya está en la pantalla del chat)', () => {
  for (const e of combinaciones.filter((c) => c.canalAbierto)) assert.equal(decidirAviso(e).sumarNoLeido, false, JSON.stringify(e));
});

await prueba('un canal silenciado nunca suena, nunca notifica y nunca cuenta, esté abierto o no y la ventana a la vista o no', () => {
  for (const e of combinaciones.filter((c) => c.silenciado)) {
    const d = decidirAviso(e);
    assert.deepEqual([d.sonar, d.notificar, d.contarMientrasFuera, d.sumarNoLeido], [false, false, false, false], JSON.stringify(e));
  }
});

await prueba('un canal que NO está abierto: se suma a los no leídos, y que la ventana esté a la vista o no da igual', () => {
  const a = decidirAviso({ ...base, mirando: true });
  const b = decidirAviso({ ...base, mirando: false });
  assert.deepEqual(a, b);
  assert.deepEqual(a, { avisarAChatPage: false, sumarNoLeido: true, contarMientrasFuera: false, sonar: true, notificar: true });
});

await prueba('un mensaje que no es mención ni conversación (un canal de proyecto normal) no suena ni notifica, pero sí se suma a los no leídos', () => {
  assert.deepEqual(decidirAviso({ ...base, urgente: false }), { avisarAChatPage: false, sumarNoLeido: true, contarMientrasFuera: false, sonar: false, notificar: false });
  // y en el canal abierto con la ventana fuera de la vista: se cuenta para el título pero no suena
  assert.deepEqual(decidirAviso({ ...base, urgente: false, canalAbierto: true, mirando: false }), { avisarAChatPage: true, sumarNoLeido: false, contarMientrasFuera: true, sonar: false, notificar: false });
});

await prueba('con la campana apagada no suena, pero la notificación sí sale (sin sonido, ver notificacionSilenciosa)', () => {
  for (const e of combinaciones.filter((c) => !c.sonidoActivo)) assert.equal(decidirAviso(e).sonar, false, JSON.stringify(e));
  const d = decidirAviso({ ...base, sonidoActivo: false });
  assert.equal(d.sonar, false);
  assert.equal(d.notificar, true);
});

await prueba('sin id del mensaje no suena ni notifica (no se podría evitar avisar dos veces), pero igual se cuenta', () => {
  for (const e of combinaciones.filter((c) => !c.conId)) {
    const d = decidirAviso(e);
    assert.equal(d.sonar, false, JSON.stringify(e));
    assert.equal(d.notificar, false, JSON.stringify(e));
  }
  assert.equal(decidirAviso({ ...base, conId: false }).sumarNoLeido, true);
});

// ═══ ¿La notificación del escritorio sale con sonido? ═══
await prueba('notificacionSilenciosa: sale sin sonido si la campana está apagada o si el Hub ya suena porque la persona mira la ventana', () => {
  assert.equal(notificacionSilenciosa({ sonidoActivo: true, mirando: false }), false, 'campana encendida y ventana fuera de la vista: suena el aviso del sistema');
  assert.equal(notificacionSilenciosa({ sonidoActivo: true, mirando: true }), true, 'ya sonó el del Hub');
  assert.equal(notificacionSilenciosa({ sonidoActivo: false, mirando: false }), true, 'campana apagada: nunca suena (antes sonaba)');
  assert.equal(notificacionSilenciosa({ sonidoActivo: false, mirando: true }), true);
});

// ═══ El texto de la notificación ═══
const aviso = (extra: Partial<AvisoMensaje> = {}): AvisoMensaje => ({ channel: 'general', messageId: 'm1', senderName: 'Rosa Elena Vargas', hasMention: false, contentPreview: 'Ya subí el archivo', ...extra });

await prueba('construirNotificacion: un chat directo se muestra como la persona, sin el código largo de la conversación y con el inicio del mensaje', () => {
  const r = construirNotificacion(aviso({ channel: CONVERSACION, isConversation: true, conversationType: 'DM' }));
  assert.deepEqual(r, { titulo: 'Rosa Elena Vargas', cuerpo: 'Ya subí el archivo' });
  assert.ok(!r.titulo.includes(CONVERSACION) && !r.titulo.includes('#'));
});

await prueba('construirNotificacion: un servidor viejo (sin los campos de conversación) tampoco muestra el código: se reconoce por ser un UUID', () => {
  const r = construirNotificacion(aviso({ channel: CONVERSACION }));
  assert.equal(r.titulo, 'Rosa Elena Vargas');
  assert.ok(!r.titulo.includes(CONVERSACION));
});

await prueba('construirNotificacion: un grupo se muestra como «persona en Nombre del grupo»; sin el nombre del grupo, solo la persona', () => {
  assert.equal(construirNotificacion(aviso({ channel: CONVERSACION, isConversation: true, conversationType: 'Group', conversationName: 'Equipo Norte' })).titulo, 'Rosa Elena Vargas en Equipo Norte');
  assert.equal(construirNotificacion(aviso({ channel: CONVERSACION, isConversation: true, conversationType: 'Group', conversationName: '   ' })).titulo, 'Rosa Elena Vargas');
  assert.equal(construirNotificacion(aviso({ channel: CONVERSACION, isConversation: true, conversationType: 'Group', conversationName: null })).titulo, 'Rosa Elena Vargas');
  // un chat directo no usa el nombre aunque venga
  assert.equal(construirNotificacion(aviso({ channel: CONVERSACION, isConversation: true, conversationType: 'DM', conversationName: 'Equipo Norte' })).titulo, 'Rosa Elena Vargas');
});

await prueba('construirNotificacion: un canal se muestra como «persona en #canal»', () => {
  assert.equal(construirNotificacion(aviso({ channel: 'general' })).titulo, 'Rosa Elena Vargas en #general');
  assert.equal(construirNotificacion(aviso({ channel: 'PROYECTO-UNO', isConversation: false })).titulo, 'Rosa Elena Vargas en #PROYECTO-UNO');
});

await prueba('construirNotificacion: una mención lo dice y lleva el inicio del mensaje; sin texto, el aviso genérico', () => {
  assert.equal(construirNotificacion(aviso({ hasMention: true })).cuerpo, 'Te mencionó: Ya subí el archivo');
  assert.equal(construirNotificacion(aviso({ hasMention: true, contentPreview: '' })).cuerpo, 'Te mencionó');
  assert.equal(construirNotificacion(aviso({ hasMention: false, contentPreview: undefined })).cuerpo, 'Nuevo mensaje');
  assert.equal(construirNotificacion(aviso({ hasMention: false, contentPreview: '   ' })).cuerpo, 'Nuevo mensaje');
  assert.equal(construirNotificacion(aviso({ contentPreview: '📎 Archivo' })).cuerpo, '📎 Archivo');
});

await prueba('construirNotificacion: sin nombre de quien escribe sale «Alguien»', () => {
  assert.equal(construirNotificacion(aviso({ senderName: undefined, channel: CONVERSACION })).titulo, 'Alguien');
  assert.equal(construirNotificacion(aviso({ senderName: '  ', channel: 'general' })).titulo, 'Alguien en #general');
});

// ═══ Todo junto: un mensaje nuevo con piezas de mentira ═══
function entornoDeMentira(o: { silenciados?: string[]; sonido?: boolean; mirando?: boolean; vistos?: Set<string> } = {}) {
  const llamadas: string[] = [];
  const vistos = o.vistos ?? new Set<string>();
  const notificaciones: Array<{ aviso: AvisoMensaje; sonidoActivo: boolean }> = [];
  const fuera: boolean[] = [];
  const entorno: EntornoAvisos = {
    silenciados: () => new Set(o.silenciados ?? []),
    sonidoActivo: () => o.sonido ?? true,
    mirando: () => o.mirando ?? true,
    primeraVez: (clave) => { if (vistos.has(clave)) return false; vistos.add(clave); return true; },
    avisarAChatPage: () => { llamadas.push('chat'); },
    sumarNoLeido: () => { llamadas.push('no-leido'); },
    contarMientrasFuera: (conMencion) => { llamadas.push('fuera'); fuera.push(conMencion); },
    sonar: () => { llamadas.push('sonar'); },
    notificar: (a, op) => { llamadas.push('notificar'); notificaciones.push({ aviso: a, sonidoActivo: op.sonidoActivo }); },
  };
  return { entorno, llamadas, notificaciones, fuera };
}
const mensaje = (extra: Partial<AvisoMensaje> = {}): AvisoMensaje => ({ channel: CONVERSACION, messageId: 'm1', senderName: 'Rosa Elena Vargas', hasMention: false, contentPreview: 'hola', ...extra });

await prueba('procesarAvisoDeChat: una conversación que no está abierta suma a los no leídos, suena y notifica', () => {
  const { entorno, llamadas } = entornoDeMentira();
  procesarAvisoDeChat(mensaje(), entorno);
  assert.deepEqual(llamadas, ['no-leido', 'sonar', 'notificar']);
});

await prueba('procesarAvisoDeChat: el chat abierto con la ventana fuera de la vista: trae el mensaje, suena, notifica y cuenta en el título (sin tocar los no leídos)', () => {
  const { entorno, llamadas, fuera } = entornoDeMentira({ mirando: false });
  procesarAvisoDeChat(mensaje({ isActiveChannel: true, hasMention: true }), entorno);
  assert.deepEqual(llamadas, ['chat', 'fuera', 'sonar', 'notificar']);
  assert.deepEqual(fuera, [true], 'la mención se pasa al contador del título');
});

await prueba('procesarAvisoDeChat: el chat abierto con la ventana a la vista: solo trae el mensaje', () => {
  const { entorno, llamadas } = entornoDeMentira({ mirando: true });
  procesarAvisoDeChat(mensaje({ isActiveChannel: true }), entorno);
  assert.deepEqual(llamadas, ['chat']);
});

await prueba('procesarAvisoDeChat: un canal silenciado (aunque sea una mención) no hace nada', () => {
  const { entorno, llamadas } = entornoDeMentira({ silenciados: [CONVERSACION] });
  procesarAvisoDeChat(mensaje({ hasMention: true }), entorno);
  assert.deepEqual(llamadas, []);
  const abierto = entornoDeMentira({ silenciados: [CONVERSACION], mirando: false });
  procesarAvisoDeChat(mensaje({ isActiveChannel: true }), abierto.entorno);
  assert.deepEqual(abierto.llamadas, ['chat'], 'silenciado y abierto: solo se trae el mensaje');
});

await prueba('procesarAvisoDeChat: un canal de proyecto sin mención suma a los no leídos pero no suena ni notifica; con mención sí', () => {
  const a = entornoDeMentira();
  procesarAvisoDeChat(mensaje({ channel: 'PROYECTO-UNO' }), a.entorno);
  assert.deepEqual(a.llamadas, ['no-leido']);
  const b = entornoDeMentira();
  procesarAvisoDeChat(mensaje({ channel: 'PROYECTO-UNO', hasMention: true }), b.entorno);
  assert.deepEqual(b.llamadas, ['no-leido', 'sonar', 'notificar']);
});

await prueba('procesarAvisoDeChat: con la campana apagada no suena pero notifica, y la notificación se entera de que la campana está apagada', () => {
  const { entorno, llamadas, notificaciones } = entornoDeMentira({ sonido: false });
  procesarAvisoDeChat(mensaje(), entorno);
  assert.deepEqual(llamadas, ['no-leido', 'notificar']);
  assert.equal(notificaciones[0].sonidoActivo, false);
  const encendida = entornoDeMentira({ sonido: true });
  procesarAvisoDeChat(mensaje(), encendida.entorno);
  assert.equal(encendida.notificaciones[0].sonidoActivo, true);
});

await prueba('procesarAvisoDeChat: el mismo mensaje dos veces (un reintento del servidor) suena y notifica UNA sola vez', () => {
  const vistos = new Set<string>();
  const uno = entornoDeMentira({ vistos });
  procesarAvisoDeChat(mensaje(), uno.entorno);
  const dos = entornoDeMentira({ vistos });
  procesarAvisoDeChat(mensaje(), dos.entorno);
  assert.deepEqual(uno.llamadas, ['no-leido', 'sonar', 'notificar']);
  assert.ok(!dos.llamadas.includes('sonar') && !dos.llamadas.includes('notificar'), dos.llamadas.join(','));
  // otro mensaje distinto sí avisa
  const tres = entornoDeMentira({ vistos });
  procesarAvisoDeChat(mensaje({ messageId: 'm2' }), tres.entorno);
  assert.ok(tres.llamadas.includes('sonar') && tres.llamadas.includes('notificar'));
});

await prueba('procesarAvisoDeChat: el sonido y la notificación llevan cada uno su propia clave de «ya avisé» (sonar no gasta la clave de notificar)', () => {
  const vistos = new Set<string>();
  const { entorno } = entornoDeMentira({ vistos });
  procesarAvisoDeChat(mensaje({ messageId: 'abc' }), entorno);
  assert.deepEqual([...vistos].sort(), ['abc', 'notif-abc']);
});

await prueba('procesarAvisoDeChat: sin id del mensaje no suena ni notifica, pero se cuenta', () => {
  const { entorno, llamadas } = entornoDeMentira();
  procesarAvisoDeChat(mensaje({ messageId: undefined }), entorno);
  assert.deepEqual(llamadas, ['no-leido']);
});

await prueba('procesarAvisoDeChat: la notificación recibe el mensaje completo (para armar título y texto) y devuelve lo decidido', () => {
  const { entorno, notificaciones } = entornoDeMentira();
  const m = mensaje({ conversationType: 'Group', conversationName: 'Equipo Norte', isConversation: true });
  const decision = procesarAvisoDeChat(m, entorno);
  assert.equal(notificaciones[0].aviso, m);
  assert.equal(decision.notificar, true);
  assert.equal(construirNotificacion(notificaciones[0].aviso).titulo, 'Rosa Elena Vargas en Equipo Norte');
});

await prueba('procesarAvisoDeChat: una conversación distinta de la abierta es «otro canal» aunque sea una conversación', () => {
  // El hook marca isActiveChannel solo cuando el canal coincide con el abierto; aquí llega sin marca y la ventana a la vista.
  const { entorno, llamadas } = entornoDeMentira({ mirando: true });
  procesarAvisoDeChat(mensaje({ channel: OTRA_CONVERSACION }), entorno);
  assert.deepEqual(llamadas, ['no-leido', 'sonar', 'notificar']);
});

// ═══ Clic en la notificación: abrir esa conversación o canal ═══
const YO = 'usuario@ejemplo.test';
const ELLA = 'rosa.vargas@ejemplo.test';
const AHORA = 1_800_000_000_000;
const contexto = (extra: Partial<Parameters<typeof resolverPedidoDeApertura>[1]> = {}) => ({
  ahora: AHORA, canalAbierto: 'general', miCorreo: YO,
  dms: [{ id: CONVERSACION, members: [YO, ELLA] }],
  grupos: [{ id: OTRA_CONVERSACION, name: 'Equipo Norte' }],
  ...extra,
});

await prueba('resolverPedidoDeApertura: sin pedido (o sin canal) no hay nada que hacer', () => {
  for (const pedido of [null, undefined, {}, { at: AHORA }, { channel: '' }]) assert.deepEqual(resolverPedidoDeApertura(pedido as any, contexto()), { tipo: 'nada' }, JSON.stringify(pedido));
});

await prueba('resolverPedidoDeApertura: un chat directo conocido se abre con la OTRA persona (en cualquier orden de los miembros)', () => {
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA }, contexto()), { tipo: 'dm', id: CONVERSACION, otro: ELLA });
  const alReves = contexto({ dms: [{ id: CONVERSACION, members: [ELLA, YO] }] });
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA }, alReves), { tipo: 'dm', id: CONVERSACION, otro: ELLA });
});

await prueba('resolverPedidoDeApertura: un grupo conocido se abre con su nombre', () => {
  assert.deepEqual(resolverPedidoDeApertura({ channel: OTRA_CONVERSACION, at: AHORA }, contexto()), { tipo: 'grupo', id: OTRA_CONVERSACION, nombre: 'Equipo Norte' });
});

await prueba('resolverPedidoDeApertura: una conversación que todavía no está en las listas se ESPERA (no se abre como si fuera un canal)', () => {
  const desconocida = '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(resolverPedidoDeApertura({ channel: desconocida, at: AHORA }, contexto()), { tipo: 'esperar' });
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA }, contexto({ dms: [], grupos: [] })), { tipo: 'esperar' });
});

await prueba('resolverPedidoDeApertura: «general» y los proyectos se abren como canal', () => {
  assert.deepEqual(resolverPedidoDeApertura({ channel: 'PROYECTO-UNO', at: AHORA }, contexto()), { tipo: 'canal', canal: 'PROYECTO-UNO' });
  assert.deepEqual(resolverPedidoDeApertura({ channel: 'general', at: AHORA }, contexto({ canalAbierto: 'PROYECTO-UNO' })), { tipo: 'canal', canal: 'general' });
});

await prueba('resolverPedidoDeApertura: si esa conversación ya es la abierta, el pedido se descarta', () => {
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA }, contexto({ canalAbierto: CONVERSACION })), { tipo: 'descartar' });
  assert.deepEqual(resolverPedidoDeApertura({ channel: 'general', at: AHORA }, contexto({ canalAbierto: 'general' })), { tipo: 'descartar' });
});

await prueba('resolverPedidoDeApertura: un pedido de hace más de 2 minutos se descarta; justo 2 minutos todavía vale; sin hora vale', () => {
  assert.equal(VIGENCIA_PEDIDO_MS, 120_000);
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA - VIGENCIA_PEDIDO_MS - 1 }, contexto()), { tipo: 'descartar' });
  assert.equal(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA - VIGENCIA_PEDIDO_MS }, contexto()).tipo, 'dm');
  assert.equal(resolverPedidoDeApertura({ channel: CONVERSACION }, contexto()).tipo, 'dm');
  // un pedido viejo de una conversación que no existe también se descarta (no se queda esperando para siempre)
  assert.deepEqual(resolverPedidoDeApertura({ channel: '11111111-2222-4333-8444-555555555555', at: AHORA - VIGENCIA_PEDIDO_MS - 1 }, contexto()), { tipo: 'descartar' });
});

await prueba('resolverPedidoDeApertura: un chat directo sin la otra persona en la lista de miembros no truena (otro vacío)', () => {
  assert.deepEqual(resolverPedidoDeApertura({ channel: CONVERSACION, at: AHORA }, contexto({ dms: [{ id: CONVERSACION, members: [YO] }] })), { tipo: 'dm', id: CONVERSACION, otro: '' });
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
