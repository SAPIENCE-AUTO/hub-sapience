import type {
  Condicion, Definicion, FotoSubida, Opcion, Pregunta, Respuestas, Resultado, Seccion, Valor,
} from './tipos';

/**
 * Motor de Tools → Formularios. Funciones puras: las usa la página pública
 * (qué pantallas mostrar, validar, detectar un descarte a tiempo) y el
 * servidor (calificar con la definición completa, sin confiar en el navegador).
 */

export interface PreguntaVisible {
  pregunta: Pregunta;
  clave: string;
  texto: string;
  ayuda?: string;
  opciones: Opcion[];
}

export interface Pantalla {
  id: string;
  seccion: Seccion;
  instancia?: Opcion;
  titulo?: string;
  intro?: string;
  preguntas: PreguntaVisible[];
}

interface Ubicacion { pregunta: Pregunta; seccion: Seccion }

function indice(def: Definicion): Map<string, Ubicacion> {
  const mapa = new Map<string, Ubicacion>();
  for (const seccion of def.secciones) for (const pregunta of seccion.preguntas) mapa.set(pregunta.id, { pregunta, seccion });
  return mapa;
}

const reemplazar = (texto: string | undefined, instancia?: Opcion) =>
  texto && instancia ? texto.split('{opcion}').join(instancia.corto ?? instancia.label) : texto;

export function seleccion(valor: Valor | undefined): string[] {
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string');
  return typeof valor === 'string' && valor ? [valor] : [];
}

function claveDe(ubic: Ubicacion | undefined, id: string, instancia?: string) {
  return ubic?.seccion.repetirPor && instancia ? `${id}@${instancia}` : id;
}

// ── orden aleatorio estable (misma persona, mismo orden al recargar) ─────────
function hash(texto: string) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function barajar<T>(lista: T[], semilla: string): T[] {
  let s = hash(semilla) || 1;
  const azar = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [copia[i], copia[j]] = [copia[j], copia[i]]; }
  return copia;
}

function ordenar(opciones: Opcion[], aleatorio: boolean | undefined, semilla: string): Opcion[] {
  if (!aleatorio) return opciones;
  const moviles = opciones.filter((o) => !o.fija);
  const fijas = opciones.filter((o) => o.fija);
  return [...barajar(moviles, semilla), ...fijas];
}

// ── opciones y condiciones ───────────────────────────────────────────────────
interface Contexto {
  def: Definicion;
  idx: Map<string, Ubicacion>;
  resp: Respuestas;
  instancia?: string;
  descartes?: Set<string>;
  nseNivel?: string;
}

function opcionesBase(ctx: Contexto, pregunta: Pregunta): Opcion[] {
  if (!pregunta.opcionesDe) return pregunta.opciones ?? [];
  const origen = ctx.idx.get(pregunta.opcionesDe);
  if (!origen) return pregunta.opcionesExtra ?? [];
  const marcadas = new Set(seleccion(ctx.resp[claveDe(origen, origen.pregunta.id, ctx.instancia)]));
  const deOrigen = opcionesBase(ctx, origen.pregunta).filter((o) => marcadas.has(o.id) && !o.exclusiva);
  return [...deOrigen, ...(pregunta.opcionesExtra ?? [])];
}

function instanciasDe(ctx: Contexto, seccion: Seccion): Opcion[] {
  const origen = seccion.repetirPor ? ctx.idx.get(seccion.repetirPor) : undefined;
  if (!origen) return [];
  const marcadas = new Set(seleccion(ctx.resp[origen.pregunta.id]));
  return opcionesBase({ ...ctx, instancia: undefined }, origen.pregunta)
    .filter((o) => marcadas.has(o.id) && !o.exclusiva && (!seccion.repetirSolo || seccion.repetirSolo.includes(o.id)));
}

export function cumple(c: Condicion, ctx: Contexto): boolean {
  if ('todas' in c) return c.todas.every((x) => cumple(x, ctx));
  if ('alguna' in c) return c.alguna.some((x) => cumple(x, ctx));
  if ('no' in c) return !cumple(c.no, ctx);
  if ('instanciaEs' in c) return !!ctx.instancia && c.instanciaEs.includes(ctx.instancia);
  if ('nse' in c) return !!ctx.nseNivel && c.nse.includes(ctx.nseNivel);
  if ('numero' in c) {
    const v = ctx.resp[c.numero];
    return typeof v === 'number' && v >= c.entre[0] && v <= c.entre[1];
  }
  if ('bloque' in c) {
    const seccion = ctx.def.secciones.find((s) => s.id === c.bloque);
    if (!seccion || (seccion.mostrarSi && !cumple(seccion.mostrarSi, { ...ctx, instancia: undefined }))) return false;
    const existe = instanciasDe(ctx, seccion).some((o) => o.id === c.opcion);
    return existe && !ctx.descartes?.has(`${c.bloque}@${c.opcion}`);
  }
  const ubic = ctx.idx.get(c.pregunta);
  const marcadas = seleccion(ctx.resp[claveDe(ubic, c.pregunta, c.instancia ?? ctx.instancia)]);
  if ('incluye' in c) return c.incluye.some((x) => marcadas.includes(x));
  if ('noIncluye' in c) return !c.noIncluye.some((x) => marcadas.includes(x));
  return c.incluyeTodas.every((x) => marcadas.includes(x));
}

// ── pantallas ────────────────────────────────────────────────────────────────
/** Pantallas visibles con las respuestas actuales. Una pantalla = una sección (o una repetición de ella). */
export function pantallas(def: Definicion, resp: Respuestas, semilla = ''): Pantalla[] {
  const idx = indice(def);
  const base: Contexto = { def, idx, resp };
  const out: Pantalla[] = [];
  for (const seccion of def.secciones) {
    if (seccion.mostrarSi && !cumple(seccion.mostrarSi, base)) continue;
    const instancias: (Opcion | undefined)[] = seccion.repetirPor ? instanciasDe(base, seccion) : [undefined];
    for (const instancia of instancias) {
      const ctx = { ...base, instancia: instancia?.id };
      const preguntas = seccion.preguntas
        .filter((p) => !p.mostrarSi || cumple(p.mostrarSi, ctx))
        .map((p): PreguntaVisible => {
          const clave = claveDe({ pregunta: p, seccion }, p.id, instancia?.id);
          const opciones = opcionesBase(ctx, p).map((o) => ({ ...o, label: reemplazar(o.label, instancia)! }));
          return {
            pregunta: p, clave,
            texto: reemplazar(p.texto, instancia)!,
            ayuda: reemplazar(p.ayuda, instancia),
            opciones: ordenar(opciones, p.aleatorio, `${semilla}:${clave}`),
          };
        });
      if (preguntas.length === 0) continue;
      out.push({
        id: instancia ? `${seccion.id}@${instancia.id}` : seccion.id,
        seccion, instancia,
        titulo: reemplazar(seccion.titulo, instancia),
        intro: reemplazar(seccion.intro, instancia),
        preguntas,
      });
    }
  }
  return out;
}

// ── validación ───────────────────────────────────────────────────────────────
function vacio(v: Valor | undefined) {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function validar(pv: PreguntaVisible, resp: Respuestas): string | undefined {
  const p = pv.pregunta;
  const v = resp[pv.clave];
  if (p.tipo === 'matriz') {
    const fila = (p.filas ?? []).find((f) => !(v as Record<string, string> | undefined)?.[f.id]);
    return fila && !p.opcional ? 'Contesta todas las filas' : undefined;
  }
  if (vacio(v)) return p.opcional ? undefined : p.tipo === 'foto' ? 'Sube la foto' : 'Contesta esta pregunta';
  if (p.tipo === 'numero') {
    if (typeof v !== 'number' || Number.isNaN(v)) return 'Escribe un número';
    if ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) return `Escribe un número entre ${p.min} y ${p.max}`;
  }
  if (p.tipo === 'telefono' && String(v).replace(/\D/g, '').length !== 10) return 'Escribe un celular de 10 dígitos';
  if (p.tipo === 'correo' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) return 'Escribe un correo válido';
  if (p.patron && !new RegExp(p.patron).test(String(v))) return p.patronMensaje ?? 'Revisa lo que escribiste';
  const marcadas = seleccion(v);
  if (p.maxOpciones && marcadas.length > p.maxOpciones) return `Marca máximo ${p.maxOpciones}`;
  const otra = pv.opciones.find((o) => o.otra && marcadas.includes(o.id));
  if (otra && !String(resp[`${pv.clave}#otra`] ?? '').trim()) return 'Escribe cuál';
  return undefined;
}

export function validarPantalla(pantalla: Pantalla, resp: Respuestas): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const pv of pantalla.preguntas) {
    const e = validar(pv, resp);
    if (e) errores[pv.clave] = e;
  }
  return errores;
}

// ── calificación ─────────────────────────────────────────────────────────────
function opcionesMarcadas(pv: PreguntaVisible, resp: Respuestas): Opcion[] {
  const marcadas = seleccion(resp[pv.clave]);
  return pv.opciones.filter((o) => marcadas.includes(o.id));
}

/** Primer motivo que termina el formulario, en el orden en que se contestó. */
export function terminacion(def: Definicion, resp: Respuestas, lista = pantallas(def, resp)): Resultado['terminado'] {
  const idx = indice(def);
  for (const pantalla of lista) {
    for (const pv of pantalla.preguntas) {
      const v = resp[pv.clave];
      if (vacio(v)) continue;
      const p = pv.pregunta;
      const opcion = opcionesMarcadas(pv, resp).find((o) => o.termina);
      if (opcion) return { motivo: opcion.termina!, clave: pv.clave };
      if (p.terminaFuera && typeof v === 'number' && (v < p.terminaFuera.min || v > p.terminaFuera.max)) {
        return { motivo: p.terminaFuera.motivo, clave: pv.clave };
      }
      if (p.tipo === 'matriz') {
        const filas = v as Record<string, string>;
        const regla = (p.reglasMatriz ?? []).find((r) => r.termina && r.columnas.includes(filas[r.fila]));
        if (regla) return { motivo: regla.termina!, clave: pv.clave };
      }
      if (p.terminaSi && cumple(p.terminaSi.si, { def, idx, resp, instancia: pantalla.instancia?.id })) {
        return { motivo: p.terminaSi.motivo, clave: pv.clave };
      }
    }
  }
  return undefined;
}

export function evaluar(def: Definicion, resp: Respuestas): Resultado {
  const idx = indice(def);
  const lista = pantallas(def, resp);
  const terminado = terminacion(def, resp, lista);

  const descartes: Resultado['descartes'] = [];
  const grupos = new Set<string>();
  for (const pantalla of lista) {
    for (const pv of pantalla.preguntas) {
      for (const o of opcionesMarcadas(pv, resp)) {
        o.excluyeGrupos?.forEach((g) => grupos.add(g));
        if (o.descarta && pantalla.instancia && !descartes.some((d) => d.seccion === pantalla.seccion.id && d.opcion === pantalla.instancia!.id)) {
          descartes.push({ seccion: pantalla.seccion.id, opcion: pantalla.instancia.id, motivo: o.descarta });
        }
      }
      if (pv.pregunta.tipo === 'matriz' && resp[pv.clave]) {
        const filas = resp[pv.clave] as Record<string, string>;
        (pv.pregunta.reglasMatriz ?? [])
          .filter((r) => r.columnas.includes(filas[r.fila]))
          .forEach((r) => r.excluyeGrupos?.forEach((g) => grupos.add(g)));
      }
    }
  }

  let nse: Resultado['nse'];
  if (def.nse) {
    const ids = Object.keys(def.nse.puntos);
    if (ids.every((id) => typeof resp[id] === 'string')) {
      const puntos = ids.reduce((suma, id) => suma + (def.nse!.puntos[id][resp[id] as string] ?? 0), 0);
      const nivel = def.nse.cortes.find((c) => puntos >= c.desde)?.nivel ?? '?';
      nse = { puntos, nivel };
    }
  }

  const ctx: Contexto = { def, idx, resp, descartes: new Set(descartes.map((d) => `${d.seccion}@${d.opcion}`)), nseNivel: nse?.nivel };
  const frentes = terminado ? [] : (def.frentes ?? [])
    .filter((f) => !grupos.has(f.grupo) && cumple(f.califica, ctx))
    .map((f) => f.id);

  const alertas = (def.alertas ?? []).filter((a) =>
    (a.contar && seleccion(resp[a.contar.pregunta]).length > a.contar.masDe) || (a.si && cumple(a.si, ctx)),
  ).map((a) => a.texto);

  const incompleto = !terminado && lista.some((p) => Object.keys(validarPantalla(p, resp)).length > 0);

  return {
    califica: !terminado && !incompleto && frentes.length > 0,
    terminado, descartes, gruposExcluidos: [...grupos], nse, frentes, alertas, incompleto,
  };
}

/** Por qué no califica, en palabras del panel y del Excel. */
export function explicarResultado(res: Resultado): string | undefined {
  if (res.terminado) return res.terminado.motivo;
  if (res.incompleto) return 'Incompleta';
  if (res.frentes.length > 0) return undefined;
  const motivos = [
    ...res.descartes.map((d) => d.motivo),
    ...res.gruposExcluidos.map((g) => `Fuera de ${g} (rechazo de marca o no se encarga)`),
  ];
  return motivos.join(' · ') || 'No entra a ningún frente (edad, NSE o formato)';
}

// ── lo que puede ver el navegador del participante ───────────────────────────
/**
 * Quita lo interno: frentes, NSE, alertas, notas y los motivos de descarte
 * (quedan como «1» para que la página sepa cortar a tiempo sin decir por qué).
 */
export function definicionPublica(def: Definicion): Definicion {
  const limpiarOpcion = (o: Opcion): Opcion => ({
    id: o.id, label: o.label, corto: o.corto, otra: o.otra, exclusiva: o.exclusiva, fija: o.fija,
    termina: o.termina ? '1' : undefined, descarta: o.descarta ? '1' : undefined,
  });
  return {
    version: def.version, tituloPublico: def.tituloPublico, bienvenida: def.bienvenida,
    despedida: def.despedida, noCalifica: def.noCalifica,
    secciones: def.secciones.map((s) => ({
      ...s,
      preguntas: s.preguntas.map((p) => ({
        ...p,
        nota: undefined,
        opciones: p.opciones?.map(limpiarOpcion),
        opcionesExtra: p.opcionesExtra?.map(limpiarOpcion),
        reglasMatriz: p.reglasMatriz?.filter((r) => r.termina).map((r) => ({ fila: r.fila, columnas: r.columnas, termina: '1' })),
        terminaFuera: p.terminaFuera ? { ...p.terminaFuera, motivo: '1' } : undefined,
        terminaSi: p.terminaSi ? { ...p.terminaSi, motivo: '1' } : undefined,
      })),
    })),
  };
}

// ── para leer una respuesta en el panel ──────────────────────────────────────
export interface Linea { texto: string; valor: string; fotos?: FotoSubida[] }

export function describir(def: Definicion, resp: Respuestas): { titulo: string; lineas: Linea[] }[] {
  return pantallas(def, resp).map((pantalla) => ({
    titulo: pantalla.titulo ?? pantalla.seccion.id,
    lineas: pantalla.preguntas.filter((pv) => !vacio(resp[pv.clave])).map((pv): Linea => {
      const v = resp[pv.clave];
      const p = pv.pregunta;
      if (p.tipo === 'foto') return { texto: pv.texto, valor: '', fotos: v as FotoSubida[] };
      if (p.tipo === 'matriz') {
        const filas = v as Record<string, string>;
        const valor = (p.filas ?? []).map((f) => `${f.label}: ${pv.opciones.find((o) => o.id === filas[f.id])?.label ?? '—'}`).join(' · ');
        return { texto: pv.texto, valor };
      }
      if (p.tipo === 'unica' || p.tipo === 'multiple') {
        const otra = resp[`${pv.clave}#otra`];
        const valor = opcionesMarcadas(pv, resp).map((o) => (o.otra && otra ? `${o.label}: ${otra}` : o.label)).join(', ');
        return { texto: pv.texto, valor };
      }
      return { texto: pv.texto, valor: String(v) };
    }),
  }));
}

/** Texto de la opción elegida (para columnas del panel como género). */
export function etiqueta(def: Definicion, preguntaId: string | undefined, resp: Respuestas): string | undefined {
  if (!preguntaId) return undefined;
  const v = resp[preguntaId];
  const p = indice(def).get(preguntaId)?.pregunta;
  if (v === undefined || !p) return undefined;
  if (typeof v === 'string' && p.opciones) return p.opciones.find((o) => o.id === v)?.label ?? v;
  return String(v);
}
