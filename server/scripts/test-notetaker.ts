// Pruebas del Notetaker: que AssemblyAI siempre tenga a dónde avisar, qué minutas están atoradas y qué hacer con
// cada una, y el guardado del resultado (con AssemblyAI y Recall de mentira). Todos los datos son inventados.
// uso: node server/node_modules/.bin/tsx server/scripts/test-notetaker.ts
import assert from 'node:assert/strict';
import { urlDeAvisoDeAssembly, type AssemblyTranscript } from '../../src/serverUtils/assemblyAiClient';
import {
  accionDeRescate, reservaIntento, ENFRIAMIENTO_POR_MINUTA_MS, ESPERA_ANTES_DE_RESCATAR_MS, type MinutaParaRevisar,
} from '../../src/serverUtils/transcriptionRecovery';
import { guardarTranscripcionDeAssembly, type DependenciasDeGuardado } from '../../src/serverUtils/guardarTranscripcion';
import type { RecallSpeakerTimelineSegment } from '../../src/serverUtils/recallClient';

let n = 0;
let fallas = 0;
async function prueba(nombre: string, fn: () => void | Promise<void>) {
  n++;
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallas++;
    console.log(`FALLA ${nombre}: ${(e as Error).message.split('\n')[0]}`);
  }
}

// ── a dónde avisa AssemblyAI ─────────────────────────────────────────────────
await prueba('la variable explícita manda, sin espacios', () => {
  assert.equal(
    urlDeAvisoDeAssembly({ ZITE_ASSEMBLYAI_WEBHOOK_URL: '  https://api.ejemplo.test/api/assemblyaiWebhook ', RENDER_EXTERNAL_URL: 'https://otro.test' }),
    'https://api.ejemplo.test/api/assemblyaiWebhook',
  );
});
await prueba('sin la variable, usa la dirección pública del propio servicio en Render', () => {
  assert.equal(urlDeAvisoDeAssembly({ RENDER_EXTERNAL_URL: 'https://mi-api.ejemplo.test' }), 'https://mi-api.ejemplo.test/api/assemblyaiWebhook');
  assert.equal(urlDeAvisoDeAssembly({ RENDER_EXTERNAL_URL: 'https://mi-api.ejemplo.test/' }), 'https://mi-api.ejemplo.test/api/assemblyaiWebhook');
});
await prueba('variable vacía o con solo espacios cuenta como no puesta', () => {
  assert.equal(urlDeAvisoDeAssembly({ ZITE_ASSEMBLYAI_WEBHOOK_URL: '', RENDER_EXTERNAL_URL: 'https://mi-api.ejemplo.test' }), 'https://mi-api.ejemplo.test/api/assemblyaiWebhook');
  assert.equal(urlDeAvisoDeAssembly({ ZITE_ASSEMBLYAI_WEBHOOK_URL: '   ' }), undefined);
});
await prueba('si Render solo da el nombre del servidor, se arma con https', () => {
  assert.equal(urlDeAvisoDeAssembly({ RENDER_EXTERNAL_HOSTNAME: 'mi-api.ejemplo.test' }), 'https://mi-api.ejemplo.test/api/assemblyaiWebhook');
});
await prueba('en local (sin ninguna) no se manda aviso: AssemblyAI no alcanza a localhost', () => {
  assert.equal(urlDeAvisoDeAssembly({}), undefined);
  assert.equal(urlDeAvisoDeAssembly({ PORT: '8787' }), undefined);
});

// ── qué hacer con cada minuta ────────────────────────────────────────────────
const AHORA = Date.parse('2026-10-12T18:00:00Z');
const haceMin = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const minuta = (extra: MinutaParaRevisar): MinutaParaRevisar => ({ updatedAt: haceMin(10), status: 'ready', ...extra });
const VIDEO = { muxPlaybackId: 'pb1', muxAssetId: 'as1' };

await prueba('con texto ya no hace falta nada', () => {
  assert.equal(accionDeRescate(minuta({ ...VIDEO, assemblyTranscriptId: 't1', transcript: 'hola' }), AHORA), null);
});
await prueba('video listo y la transcripción nunca arrancó: iniciar (pasada la espera, o de inmediato si ya falló)', () => {
  assert.equal(accionDeRescate(minuta({ ...VIDEO }), AHORA), 'iniciar');
  assert.equal(accionDeRescate(minuta({ ...VIDEO, updatedAt: haceMin(1), status: 'processing' }), AHORA), null);
  assert.equal(accionDeRescate(minuta({ ...VIDEO, updatedAt: haceMin(0), status: 'transcription_error' }), AHORA), 'iniciar');
});
await prueba('ya se mandó a AssemblyAI pero el texto no llegó: recoger (pasada la espera)', () => {
  assert.equal(accionDeRescate(minuta({ ...VIDEO, assemblyTranscriptId: 't1' }), AHORA), 'recoger');
  // todavía puede llegar el aviso normal
  assert.equal(accionDeRescate(minuta({ ...VIDEO, assemblyTranscriptId: 't1', updatedAt: haceMin(1) }), AHORA), null);
});
await prueba('recoger no depende de que haya video en Mux (la subida de AssemblyAI puede ir aparte)', () => {
  assert.equal(accionDeRescate(minuta({ assemblyTranscriptId: 't1' }), AHORA), 'recoger');
});
await prueba('si AssemblyAI ya dijo que falló, no se le sigue preguntando', () => {
  assert.equal(accionDeRescate(minuta({ ...VIDEO, assemblyTranscriptId: 't1', status: 'transcription_error' }), AHORA), null);
});
await prueba('sin video ni transcripción (el bot nunca grabó) no hay nada que rescatar', () => {
  assert.equal(accionDeRescate(minuta({ status: 'done' }), AHORA), null);
  assert.equal(accionDeRescate(minuta({ muxPlaybackId: 'pb1' }), AHORA), null); // falta el asset
});
await prueba('la espera es estricta: justo en el límite todavía no, un segundo después sí', () => {
  const enElLimite = new Date(AHORA - ESPERA_ANTES_DE_RESCATAR_MS).toISOString();
  const pasado = new Date(AHORA - ESPERA_ANTES_DE_RESCATAR_MS - 1000).toISOString();
  assert.equal(accionDeRescate(minuta({ assemblyTranscriptId: 't1', updatedAt: enElLimite }), AHORA), null);
  assert.equal(accionDeRescate(minuta({ assemblyTranscriptId: 't1', updatedAt: pasado }), AHORA), 'recoger');
});
await prueba('sin fecha de cambio no se adivina: nada', () => {
  assert.equal(accionDeRescate({ ...VIDEO, assemblyTranscriptId: 't1', status: 'ready' }, AHORA), null);
});

// ── no repetir la consulta a cada rato ───────────────────────────────────────
await prueba('una minuta se intenta una vez por minuto, aunque varias personas tengan la pantalla abierta', () => {
  const t0 = 1_000_000;
  assert.equal(reservaIntento('prueba-min-a', t0), true);
  assert.equal(reservaIntento('prueba-min-a', t0 + 5_000), false);
  assert.equal(reservaIntento('prueba-min-a', t0 + ENFRIAMIENTO_POR_MINUTA_MS - 1), false);
  assert.equal(reservaIntento('prueba-min-a', t0 + ENFRIAMIENTO_POR_MINUTA_MS), true);
});
await prueba('cada minuta lleva su propia cuenta', () => {
  const t0 = 2_000_000;
  assert.equal(reservaIntento('prueba-min-b', t0), true);
  assert.equal(reservaIntento('prueba-min-c', t0 + 1), true);
  assert.equal(reservaIntento('prueba-min-b', t0 + 2), false);
});

// ── guardar el resultado ─────────────────────────────────────────────────────
const TURNOS = [
  { speaker: 'A', text: 'Hola a todos', start: 0, end: 2000 },
  { speaker: 'B', text: 'Buenos días', start: 2500, end: 4000 },
];
const PALABRAS = [
  { text: 'Hola', start: 0, end: 500 }, { text: 'a', start: 500, end: 700 }, { text: 'todos', start: 700, end: 2000 },
  { text: 'Buenos', start: 2500, end: 3200 }, { text: 'días', start: 3200, end: 4000 },
];
const LINEA_DE_TIEMPO: RecallSpeakerTimelineSegment[] = [
  { participant: { name: 'Persona Uno' }, start_timestamp: { relative: 0 }, end_timestamp: { relative: 2.2 } },
  { participant: { name: 'Persona Dos' }, start_timestamp: { relative: 2.4 }, end_timestamp: { relative: 4.2 } },
];

function conFalsos(
  respuesta: Partial<AssemblyTranscript>,
  extra: { lineaDeTiempo?: DependenciasDeGuardado['lineaDeTiempo'] } = {},
) {
  const guardados: Array<{ id: string; campos: Record<string, unknown> }> = [];
  const llamadas = { transcripcion: [] as string[], lineaDeTiempo: [] as string[] };
  const deps: DependenciasDeGuardado = {
    obtenerTranscripcion: async id => { llamadas.transcripcion.push(id); return { status: 'completed', ...respuesta } as AssemblyTranscript; },
    lineaDeTiempo: extra.lineaDeTiempo ?? (async botId => { llamadas.lineaDeTiempo.push(botId); return LINEA_DE_TIEMPO; }),
    guardar: async (id, campos) => { guardados.push({ id, campos }); },
  };
  return { deps, guardados, llamadas };
}

await prueba('transcripción terminada de una junta con bot: guarda texto, turnos con el nombre real y palabras', async () => {
  const f = conFalsos({ utterances: TURNOS, words: PALABRAS });
  const r = await guardarTranscripcionDeAssembly({ id: 'min1', recallBotId: 'bot1' }, 'tr1', f.deps);
  assert.equal(r, 'guardada');
  assert.deepEqual(f.llamadas.transcripcion, ['tr1']);
  assert.deepEqual(f.llamadas.lineaDeTiempo, ['bot1']);
  assert.equal(f.guardados.length, 1);
  assert.equal(f.guardados[0].id, 'min1');
  assert.equal(f.guardados[0].campos.transcript, '[Persona Uno] Hola a todos\n\n[Persona Dos] Buenos días');
  const datos = f.guardados[0].campos.transcriptData as { utterances: typeof TURNOS; words: typeof PALABRAS };
  assert.deepEqual(datos.utterances.map(u => u.speaker), ['Persona Uno', 'Persona Dos']);
  assert.deepEqual(datos.words, PALABRAS);
});
await prueba('minuta subida a mano (sin bot): guarda con las etiquetas de AssemblyAI y no consulta a Recall', async () => {
  const f = conFalsos({ utterances: TURNOS, words: PALABRAS });
  assert.equal(await guardarTranscripcionDeAssembly({ id: 'min2' }, 'tr2', f.deps), 'guardada');
  assert.deepEqual(f.llamadas.lineaDeTiempo, []);
  assert.equal(f.guardados[0].campos.transcript, '[Speaker A] Hola a todos\n\n[Speaker B] Buenos días');
});
await prueba('si Recall falla, el texto se guarda igual con las etiquetas genéricas', async () => {
  const f = conFalsos({ utterances: TURNOS, words: PALABRAS }, { lineaDeTiempo: async () => { throw new Error('Recall no responde'); } });
  assert.equal(await guardarTranscripcionDeAssembly({ id: 'min3', recallBotId: 'bot3' }, 'tr3', f.deps), 'guardada');
  assert.equal(f.guardados.length, 1);
  assert.equal(f.guardados[0].campos.transcript, '[Speaker A] Hola a todos\n\n[Speaker B] Buenos días');
});
await prueba('AssemblyAI todavía trabajando: no guarda nada', async () => {
  for (const status of ['queued', 'processing']) {
    const f = conFalsos({ status });
    assert.equal(await guardarTranscripcionDeAssembly({ id: 'min4', recallBotId: 'bot4' }, 'tr4', f.deps), 'pendiente');
    assert.equal(f.guardados.length, 0);
    assert.deepEqual(f.llamadas.lineaDeTiempo, []);
  }
});
await prueba('AssemblyAI no pudo transcribir: la minuta queda marcada con el error y sin texto', async () => {
  const f = conFalsos({ status: 'error' });
  assert.equal(await guardarTranscripcionDeAssembly({ id: 'min5' }, 'tr5', f.deps), 'error');
  assert.deepEqual(f.guardados, [{ id: 'min5', campos: { status: 'transcription_error' } }]);
});
await prueba('sin turnos (solo texto corrido) guarda ese texto; sin palabras guarda la lista vacía', async () => {
  const f = conFalsos({ text: 'Texto corrido de la junta' });
  assert.equal(await guardarTranscripcionDeAssembly({ id: 'min6' }, 'tr6', f.deps), 'guardada');
  assert.equal(f.guardados[0].campos.transcript, 'Texto corrido de la junta');
  assert.deepEqual(f.guardados[0].campos.transcriptData, { utterances: [], words: [] });
});
await prueba('si AssemblyAI no contesta, el error sube (el barrido lo registra y lo vuelve a intentar después)', async () => {
  const deps: DependenciasDeGuardado = {
    obtenerTranscripcion: async () => { throw new Error('AssemblyAI caído'); },
    lineaDeTiempo: async () => undefined,
    guardar: async () => { assert.fail('no debió guardar'); },
  };
  await assert.rejects(() => guardarTranscripcionDeAssembly({ id: 'min7' }, 'tr7', deps), /AssemblyAI caído/);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
