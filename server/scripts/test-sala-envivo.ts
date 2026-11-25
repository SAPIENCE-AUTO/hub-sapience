// Pruebas del video en vivo de la sala de observación (src/lib/observacion/envivo.ts) con un reproductor de mentira, un `document` de mentira y un reloj de mentira: que al volver
// a la pestaña se salte al borde en vivo y se reproduzca, que una pausa a propósito se respete (y que darle play vaya al vivo), que la vigilancia salte cuando el atraso pasa del
// límite sin brincar sin parar, que la ventana flotante solo se ofrezca donde el navegador la permite y se abra y se cierre con el mismo botón, y que con la ventana abierta
// el video siga al día aunque se esconda la pestaña. Sin navegador ni red.
// uso: node server/node_modules/.bin/tsx server/scripts/test-sala-envivo.ts
import assert from 'node:assert/strict';
import {
  ATRASO_MAXIMO_SEG, ESPERA_ENTRE_SALTOS_MS, CADA_CUANTO_VIGILAR_MS,
  alternarVentanaFlotante, atrasoEnSegundos, bordeEnVivo, crearControlEnVivo, irAlVivo, puedeVentanaFlotante, reanudar, videoDe,
  type DocumentoEnVivo, type RangosDeTiempo, type ReproductorEnVivo, type Temporizador,
} from '../../src/lib/observacion/envivo';

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

// Una promesa rechazada que nadie atrapa tumbaría el servidor de la sala: se vigila en toda la corrida.
let promesasSueltas = 0;
process.on('unhandledRejection', () => { promesasSueltas++; });

// ── Mentiras ────────────────────────────────────────────────────────────────

class ReproductorFalso implements ReproductorEnVivo {
  private tiempo: number;
  paused: boolean;
  borde: number | undefined;
  liveEdgeStart: number | undefined;
  seekable: RangosDeTiempo | null | undefined;
  saltos: number[] = [];
  playPedidos = 0;
  playRechazado = false;
  playTruena = false;

  constructor(o: { tiempo: number; borde?: number; paused?: boolean; sinSeekable?: boolean; inicioZonaVivo?: number }) {
    this.tiempo = o.tiempo;
    this.paused = o.paused ?? false;
    this.borde = o.borde;
    // Como en Mux: `liveEdgeStart` es el INICIO de la zona de en vivo, unos 18 segundos antes del final de `seekable`.
    this.liveEdgeStart = o.inicioZonaVivo ?? (o.borde === undefined ? undefined : o.borde - 18);
    this.seekable = o.sinSeekable ? undefined : { length: o.borde === undefined ? 0 : 1, end: () => this.borde as number };
  }
  get currentTime() { return this.tiempo; }
  set currentTime(v: number) { this.saltos.push(v); this.tiempo = v; }
  play() {
    this.playPedidos++;
    if (this.playTruena) throw new Error('NotAllowedError');
    if (this.playRechazado) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
}

class DocumentoFalso implements DocumentoEnVivo {
  hidden = false;
  pictureInPictureElement: unknown = null;
  pictureInPictureEnabled = true;
  escuchas = new Map<string, Set<() => void>>();
  salidasDeVentana = 0;
  addEventListener(tipo: string, f: () => void) { (this.escuchas.get(tipo) ?? this.escuchas.set(tipo, new Set()).get(tipo)!).add(f); }
  removeEventListener(tipo: string, f: () => void) { this.escuchas.get(tipo)?.delete(f); }
  emitir(tipo: string) { [...(this.escuchas.get(tipo) ?? [])].forEach((f) => f()); }
  esconder() { this.hidden = true; this.emitir('visibilitychange'); }
  mostrar() { this.hidden = false; this.emitir('visibilitychange'); }
  async exitPictureInPicture() { this.salidasDeVentana++; this.pictureInPictureElement = null; }
  escuchasDe(tipo: string) { return this.escuchas.get(tipo)?.size ?? 0; }
}

/** Reloj de mentira: `avanzar(ms)` corre los intervalos que tocan y mueve la hora. */
class RelojFalso implements Temporizador {
  hora = 1_000_000;
  private activos = new Map<number, { f: () => void; ms: number; resto: number }>();
  private siguiente = 1;
  setInterval(f: () => void, ms: number) { const id = this.siguiente++; this.activos.set(id, { f, ms, resto: ms }); return id; }
  clearInterval(id: unknown) { this.activos.delete(id as number); }
  ahora = () => this.hora;
  avanzar(ms: number) {
    let falta = ms;
    while (falta > 0) {
      const paso = Math.min(falta, ...[...this.activos.values()].map((a) => a.resto));
      this.hora += paso; falta -= paso;
      for (const a of this.activos.values()) { a.resto -= paso; if (a.resto <= 0) { a.resto = a.ms; a.f(); } }
    }
  }
  get intervalosActivos() { return this.activos.size; }
}

function armar(rep: ReproductorFalso | null, doc = new DocumentoFalso()) {
  const reloj = new RelojFalso();
  const control = crearControlEnVivo({ obtenerReproductor: () => rep, documento: doc, temporizador: reloj, ahora: reloj.ahora });
  control.iniciar();
  return { control, doc, reloj, rep };
}

// ── El borde en vivo y el atraso ────────────────────────────────────────────

await prueba('el borde en vivo es el FINAL de seekable, no liveEdgeStart (que es el inicio de la zona de en vivo)', () => {
  const rep = new ReproductorFalso({ tiempo: 900, borde: 1000 });
  assert.equal(rep.liveEdgeStart, 982);
  assert.equal(bordeEnVivo(rep), 1000);
});

await prueba('sin seekable (o vacío) se usa liveEdgeStart; sin ninguno de los dos, nada; los valores que no son número se ignoran', () => {
  assert.equal(bordeEnVivo(new ReproductorFalso({ tiempo: 900, borde: 1000, sinSeekable: true })), 982);
  assert.equal(bordeEnVivo({ seekable: { length: 0, end: () => 5 }, liveEdgeStart: 77 }), 77);
  assert.equal(bordeEnVivo({}), undefined);
  assert.equal(bordeEnVivo({ seekable: { length: 1, end: () => Number.POSITIVE_INFINITY }, liveEdgeStart: Number.NaN }), undefined);
  assert.equal(bordeEnVivo({ seekable: { length: 1, end: () => Number.NaN }, liveEdgeStart: 40 }), 40);
});

await prueba('el atraso es el borde menos la posición; sin borde o con el reloj en cero todavía no hay nada que medir', () => {
  assert.equal(atrasoEnSegundos(new ReproductorFalso({ tiempo: 940, borde: 1000 })), 60);
  assert.equal(atrasoEnSegundos(new ReproductorFalso({ tiempo: 0, borde: 1000 })), undefined);
  assert.equal(atrasoEnSegundos(new ReproductorFalso({ tiempo: 940 })), undefined);
});

await prueba('irAlVivo salta solo si va más atrasado que el mínimo (2 s) y no inventa un destino', () => {
  const lejos = new ReproductorFalso({ tiempo: 940, borde: 1000 });
  assert.equal(irAlVivo(lejos), true);
  assert.deepEqual(lejos.saltos, [1000]);
  const casi = new ReproductorFalso({ tiempo: 998.5, borde: 1000 });
  assert.equal(irAlVivo(casi), false);
  assert.deepEqual(casi.saltos, []);
  const sinBorde = new ReproductorFalso({ tiempo: 940 });
  assert.equal(irAlVivo(sinBorde), false);
  assert.deepEqual(sinBorde.saltos, []);
});

await prueba('reanudar no deja promesas sueltas ni truena si el navegador rechaza el play', async () => {
  const antes = promesasSueltas;
  const a = new ReproductorFalso({ tiempo: 940, borde: 1000 }); a.playRechazado = true;
  const b = new ReproductorFalso({ tiempo: 940, borde: 1000 }); b.playTruena = true;
  reanudar(a); reanudar(b);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(a.playPedidos, 1);
  assert.equal(b.playPedidos, 1);
  assert.equal(promesasSueltas, antes);
});

// ── (a) Esconder la pestaña y volver ────────────────────────────────────────

await prueba('(a) al volver a la pestaña con el video detenido y atrasado: salta al borde en vivo y reproduce', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc } = armar(rep);
  doc.esconder();
  assert.deepEqual(rep.saltos, [], 'escondida no hace nada');
  assert.equal(rep.playPedidos, 0);
  doc.mostrar();
  assert.deepEqual(rep.saltos, [1000]);
  assert.equal(rep.playPedidos, 1);
  assert.equal(rep.paused, false);
});

await prueba('(a) mientras la pestaña sigue escondida no se mueve nada aunque haya eventos', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc } = armar(rep);
  doc.hidden = true;
  doc.emitir('visibilitychange'); doc.emitir('visibilitychange');
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 0);
});

await prueba('(a) si al volver ya iba al día no lo mueve (evita un saltito inútil), pero se asegura de que reproduzca', () => {
  const rep = new ReproductorFalso({ tiempo: 999, borde: 1000, paused: false });
  const { doc } = armar(rep);
  doc.esconder(); doc.mostrar();
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 1);
});

await prueba('(a) una pausa del navegador (no a propósito, sin ventana flotante) NO cuenta como pausa del observador: al volver se reanuda', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc, control } = armar(rep);
  control.alPausarseElVideo();
  assert.equal(control.pausadoAProposito, false);
  doc.esconder(); doc.mostrar();
  assert.deepEqual(rep.saltos, [1000]);
  assert.equal(rep.playPedidos, 1);
});

// ── (b) Pausa a propósito ───────────────────────────────────────────────────

await prueba('(b) si el observador pausó a propósito, esconder y volver NO lo reanuda ni lo mueve', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc, control } = armar(rep);
  control.pausarAProposito();
  assert.equal(control.pausadoAProposito, true);
  doc.esconder(); doc.mostrar();
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 0);
  assert.equal(rep.paused, true);
});

await prueba('(b) darle play después de pausar a propósito va al borde en vivo, reproduce y deja de contar como pausa', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc, control } = armar(rep);
  control.pausarAProposito();
  control.reproducirAlVivo();
  assert.deepEqual(rep.saltos, [1000]);
  assert.equal(rep.playPedidos, 1);
  assert.equal(control.pausadoAProposito, false);
  // y a partir de ahí la recuperación al volver a la pestaña vuelve a funcionar
  rep.paused = true; rep.currentTime = 1010; rep.borde = 1300;
  doc.esconder(); doc.mostrar();
  assert.equal(rep.saltos[rep.saltos.length - 1], 1300);
  assert.equal(rep.playPedidos, 2);
});

await prueba('(b) play justo después de pausar un instante (menos de 2 s atrás) reproduce sin mover el video', () => {
  const rep = new ReproductorFalso({ tiempo: 998, borde: 1000, paused: true });
  const { control } = armar(rep);
  control.pausarAProposito();
  control.reproducirAlVivo();
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 1);
});

// ── (c) La vigilancia del atraso ────────────────────────────────────────────

await prueba('(c) con la pestaña visible, cada 5 s: atraso dentro del límite no se toca; pasado el límite salta al vivo', () => {
  const rep = new ReproductorFalso({ tiempo: 990, borde: 1000 });
  const { reloj } = armar(rep);
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.deepEqual(rep.saltos, [], '10 s de atraso es lo normal');
  rep.currentTime = 1000 - (ATRASO_MAXIMO_SEG + 1);
  rep.saltos.length = 0;
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.deepEqual(rep.saltos, [1000]);
});

await prueba('(c) justo en el límite (25 s) todavía no salta: solo cuando lo pasa', () => {
  const rep = new ReproductorFalso({ tiempo: 1000 - ATRASO_MAXIMO_SEG, borde: 1000 });
  const { reloj } = armar(rep);
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.deepEqual(rep.saltos, []);
});

await prueba('(c) si el borde en vivo no se deja alcanzar, no brinca cada 5 s: espera 15 s entre saltos', () => {
  const rep = new ReproductorFalso({ tiempo: 500, borde: 1000 });
  const { reloj } = armar(rep);
  // El video no avanza después del salto (simula una red que sigue sin dar): el atraso persiste.
  const dejarAtrasado = () => { rep.currentTime = 500; rep.saltos.length = 0; };
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.equal(rep.saltos.length, 1, 'primer salto');
  dejarAtrasado();
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.equal(rep.saltos.length, 0, 'a los 5 s no repite');
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.equal(rep.saltos.length, 0, 'a los 10 s no repite');
  reloj.avanzar(ESPERA_ENTRE_SALTOS_MS - 2 * CADA_CUANTO_VIGILAR_MS);
  assert.equal(rep.saltos.length, 1, 'a los 15 s sí');
});

await prueba('(c) si el observador pausó a propósito, la vigilancia no lo mueve aunque el atraso sea enorme', () => {
  const rep = new ReproductorFalso({ tiempo: 100, borde: 1000, paused: true });
  const { reloj, control } = armar(rep);
  control.pausarAProposito();
  reloj.avanzar(60_000);
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 0);
});

await prueba('(c) con la pestaña escondida y sin ventana flotante la vigilancia no hace nada (se arregla al volver)', () => {
  const rep = new ReproductorFalso({ tiempo: 100, borde: 1000, paused: true });
  const { reloj, doc } = armar(rep);
  doc.hidden = true;
  reloj.avanzar(60_000);
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 0);
});

await prueba('(c) si el navegador lo pausó solo y va muy atrasado, la vigilancia lo lleva al vivo y lo reproduce', () => {
  const rep = new ReproductorFalso({ tiempo: 100, borde: 1000, paused: true });
  const { reloj } = armar(rep);
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.deepEqual(rep.saltos, [1000]);
  assert.equal(rep.playPedidos, 1);
});

await prueba('(c) al arrancar, con el reloj del video todavía en cero, la vigilancia no lo trata como atraso', () => {
  const rep = new ReproductorFalso({ tiempo: 0, borde: 5000 });
  const { reloj } = armar(rep);
  reloj.avanzar(30_000);
  assert.deepEqual(rep.saltos, []);
});

// ── (d) Ventana flotante ────────────────────────────────────────────────────

class VideoFalso {
  disablePictureInPicture = false;
  pedidos = 0;
  negar = false;
  /** Como en el navegador con `<mux-player>`: el video está dentro de un shadow DOM, así que `document.pictureInPictureElement` devuelve el ANFITRIÓN, no el video. */
  anfitrion = { etiqueta: 'MUX-PLAYER' };
  constructor(private doc: DocumentoFalso) {}
  async requestPictureInPicture() {
    this.pedidos++;
    if (this.negar) throw Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' });
    this.doc.pictureInPictureElement = this.anfitrion;
    return {};
  }
}

await prueba('(d) el botón solo se ofrece donde el navegador permite la ventana flotante', () => {
  const doc = new DocumentoFalso();
  const video = new VideoFalso(doc);
  assert.equal(puedeVentanaFlotante(doc, video), true);
  doc.pictureInPictureEnabled = false;
  assert.equal(puedeVentanaFlotante(doc, video), false);
  assert.equal(puedeVentanaFlotante({}, video), false, 'sin la propiedad (Firefox) tampoco');
  doc.pictureInPictureEnabled = true;
  video.disablePictureInPicture = true;
  assert.equal(puedeVentanaFlotante(doc, video), false, 'si el video la desactiva');
  assert.equal(puedeVentanaFlotante(doc), true);
});

await prueba('(d) el mismo botón abre la ventana flotante y la cierra', async () => {
  const doc = new DocumentoFalso();
  const video = new VideoFalso(doc);
  assert.equal(await alternarVentanaFlotante(doc, video), true, 'queda abierta aunque el documento devuelva el anfitrión y no el video');
  assert.equal(video.pedidos, 1);
  assert.equal(doc.pictureInPictureElement, video.anfitrion);
  assert.equal(await alternarVentanaFlotante(doc, video), false);
  assert.equal(doc.salidasDeVentana, 1);
  assert.equal(doc.pictureInPictureElement, null);
});

await prueba('(d) si el navegador niega la ventana (sin gesto, sin datos), no truena y el estado queda como estaba', async () => {
  const doc = new DocumentoFalso();
  const video = new VideoFalso(doc);
  video.negar = true;
  assert.equal(await alternarVentanaFlotante(doc, video), false);
  assert.equal(doc.pictureInPictureElement, null);
});

await prueba('(d) con la ventana abierta y la pestaña escondida el video sigue al día: no se pausa y la vigilancia sigue actuando', () => {
  const rep = new ReproductorFalso({ tiempo: 100, borde: 1000, paused: false });
  const { doc, reloj } = armar(rep);
  const video = new VideoFalso(doc);
  doc.pictureInPictureElement = video;
  doc.hidden = true; // la pestaña queda escondida, la ventanita sigue visible
  reloj.avanzar(CADA_CUANTO_VIGILAR_MS);
  assert.deepEqual(rep.saltos, [1000], 'la vigilancia corre porque el video se está viendo en la ventana flotante');
  assert.equal(rep.paused, false);
  // al volver a la pestaña, con la ventana todavía abierta, sigue funcionando el salto al vivo
  rep.currentTime = 1010; rep.borde = 1200; rep.saltos.length = 0;
  doc.mostrar();
  assert.deepEqual(rep.saltos, [1200]);
});

await prueba('(d) pausar desde los controles de la ventana flotante cuenta como pausa a propósito; darle play ahí va al vivo', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const { doc, control } = armar(rep);
  doc.pictureInPictureElement = new VideoFalso(doc);
  control.alPausarseElVideo();
  assert.equal(control.pausadoAProposito, true);
  doc.esconder(); doc.mostrar();
  assert.deepEqual(rep.saltos, [], 'volver a la pestaña no la reanuda');
  control.alReproducirseElVideo();
  assert.deepEqual(rep.saltos, [1000]);
  assert.equal(rep.playPedidos, 1);
  assert.equal(control.pausadoAProposito, false);
});

await prueba('(d) un play que no viene de una pausa a propósito no mueve nada', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000 });
  const { doc, control } = armar(rep);
  doc.pictureInPictureElement = new VideoFalso(doc);
  control.alReproducirseElVideo();
  assert.deepEqual(rep.saltos, []);
  assert.equal(rep.playPedidos, 0);
});

await prueba('el video interno del reproductor se encuentra por media.nativeEl o por el shadowRoot, y solo si sabe abrir la ventana flotante', () => {
  const doc = new DocumentoFalso();
  const video = new VideoFalso(doc);
  assert.equal(videoDe({ media: { nativeEl: video } }), video as any);
  assert.equal(videoDe({ shadowRoot: { querySelector: (s: string) => (s === 'video' ? video : null) } }), video as any);
  assert.equal(videoDe({ media: { nativeEl: {} } }), undefined);
  assert.equal(videoDe({ media: null }), undefined);
  assert.equal(videoDe(null), undefined);
});

// ── Ciclo de vida y casos raros ─────────────────────────────────────────────

await prueba('iniciar dos veces no duplica la escucha; detener quita la escucha y el intervalo', () => {
  const rep = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const doc = new DocumentoFalso();
  const reloj = new RelojFalso();
  const control = crearControlEnVivo({ obtenerReproductor: () => rep, documento: doc, temporizador: reloj, ahora: reloj.ahora });
  control.iniciar(); control.iniciar();
  assert.equal(doc.escuchasDe('visibilitychange'), 1);
  assert.equal(reloj.intervalosActivos, 1);
  doc.esconder(); doc.mostrar();
  assert.equal(rep.playPedidos, 1, 'un solo play, no dos');
  control.detener();
  assert.equal(doc.escuchasDe('visibilitychange'), 0);
  assert.equal(reloj.intervalosActivos, 0);
  rep.paused = true; rep.currentTime = 500; rep.saltos.length = 0; rep.playPedidos = 0;
  doc.esconder(); doc.mostrar(); reloj.avanzar(60_000);
  assert.equal(rep.playPedidos, 0);
  assert.deepEqual(rep.saltos, []);
});

await prueba('sin reproductor (todavía no existe o ya se quitó) nada truena', () => {
  const { doc, reloj, control } = armar(null);
  doc.esconder(); doc.mostrar();
  reloj.avanzar(60_000);
  control.pausarAProposito(); control.reproducirAlVivo(); control.alPausarseElVideo(); control.alReproducirseElVideo();
  assert.equal(control.pausadoAProposito, false);
});

await prueba('el reproductor que se pide es el de ahora, no el de cuando se creó el control', () => {
  const viejo = new ReproductorFalso({ tiempo: 700, borde: 1000, paused: true });
  const nuevo = new ReproductorFalso({ tiempo: 300, borde: 2000, paused: true });
  let actual = viejo;
  const doc = new DocumentoFalso();
  const control = crearControlEnVivo({ obtenerReproductor: () => actual, documento: doc });
  control.iniciar();
  actual = nuevo;
  doc.esconder(); doc.mostrar();
  control.detener();
  assert.deepEqual(viejo.saltos, []);
  assert.deepEqual(nuevo.saltos, [2000]);
});

await prueba('el control sin reloj ni hora propios usa los del sistema y se puede detener sin dejar el proceso colgado', () => {
  const doc = new DocumentoFalso();
  const control = crearControlEnVivo({ obtenerReproductor: () => null, documento: doc });
  control.iniciar();
  control.detener();
  assert.equal(doc.escuchasDe('visibilitychange'), 0);
});

console.log(fallas ? `\n${fallas} de ${n} pruebas fallaron` : `\nlas ${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);
