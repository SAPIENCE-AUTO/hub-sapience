import { condicionEnPalabras, citar, ubicar } from './palabras';
import { forma, type Condicion, type Definicion, type Seccion } from './tipos';

/**
 * El mapa del flujo de un screener: un bloque por sección, en orden, con lo
 * que hay que ver de un vistazo (si se repite, si aparece solo si aplica,
 * dónde puede terminar alguien, qué toca frentes o da alerta). Lo dibuja la
 * vista Flujo del editor y su versión chica junto al Documento.
 */

export interface BloqueFlujo {
  id: string;
  titulo: string;
  preguntas: number;
  /** Solo texto o imagen: una pantalla de instrucciones o de concepto. */
  soloContenido: boolean;
  /** «Se repite por cada opción que marcó en «…»». */
  repite?: string;
  /** La pregunta por la que se repite, por su nombre corto si lo tiene («Formatos que compró»). */
  repiteDe?: string;
  /** Cuándo aparece, en palabras. */
  condicion?: string;
  /** Preguntas de la sección que aparecen solo si aplica. */
  condicionales: number;
  /** Motivos por los que alguien puede terminar aquí. */
  termina: string[];
  /** Motivos por los que se descarta este bloque (no el filtro). */
  descarta: string[];
  /** Frentes que dependen de lo que se contesta aquí. */
  frentes: string[];
  /** Frentes de los que se puede quedar fuera aquí (rechazo de marca, no se encarga). */
  excluye: string[];
  alertas: string[];
  nse: boolean;
}

/** Ids de pregunta y de sección que usa una condición. */
function referencias(c: Condicion, preguntas: Set<string>, secciones: Set<string>) {
  if ('todas' in c) return c.todas.forEach((x) => referencias(x, preguntas, secciones));
  if ('alguna' in c) return c.alguna.forEach((x) => referencias(x, preguntas, secciones));
  if ('no' in c) return referencias(c.no, preguntas, secciones);
  if ('bloque' in c) { secciones.add(c.bloque); return; }
  if ('numero' in c) { preguntas.add(c.numero); return; }
  if ('pregunta' in c) preguntas.add(c.pregunta);
}

const distintos = (lista: string[]) => [...new Set(lista)];

export function mapaFlujo(def: Definicion): BloqueFlujo[] {
  const usaSeccion = (s: Seccion, c: Condicion) => {
    const preguntas = new Set<string>();
    const secciones = new Set<string>();
    referencias(c, preguntas, secciones);
    return secciones.has(s.id) || s.preguntas.some((p) => preguntas.has(p.id));
  };
  const frentesPorGrupo = (grupo: string) => (def.frentes ?? []).filter((f) => f.grupo === grupo).map((f) => f.nombre);

  return def.secciones.map((s): BloqueFlujo => {
    const termina: string[] = [];
    const descarta: string[] = [];
    const excluye: string[] = [];
    for (const p of s.preguntas) {
      for (const o of [...(p.opciones ?? []), ...(p.opcionesExtra ?? [])]) {
        if (o.termina) termina.push(o.termina);
        if (o.descarta) descarta.push(o.descarta);
        o.excluyeGrupos?.forEach((g) => excluye.push(...frentesPorGrupo(g)));
      }
      if (p.terminaFuera) termina.push(p.terminaFuera.motivo);
      if (p.terminaSi) termina.push(p.terminaSi.motivo);
      for (const r of p.reglasMatriz ?? []) {
        if (r.termina) termina.push(r.termina);
        r.excluyeGrupos?.forEach((g) => excluye.push(...frentesPorGrupo(g)));
      }
    }
    const alertas = (def.alertas ?? [])
      .filter((a) => (a.contar && s.preguntas.some((p) => p.id === a.contar!.pregunta)) || (a.si && usaSeccion(s, a.si)))
      .map((a) => a.texto);
    return {
      id: s.id,
      titulo: s.titulo ?? s.id,
      preguntas: s.preguntas.filter((p) => forma(p.tipo) !== 'ninguna').length,
      soloContenido: s.preguntas.every((p) => p.tipo === 'contenido'),
      repite: s.repetirPor ? `Se repite por cada opción que marcó en ${citar(def, s.repetirPor, 48)}` : undefined,
      repiteDe: s.repetirPor ? (ubicar(def, s.repetirPor)?.pregunta.nombre?.trim() || citar(def, s.repetirPor, 32)) : undefined,
      condicion: s.mostrarSi ? `Solo si ${condicionEnPalabras(s.mostrarSi, def)}` : undefined,
      condicionales: s.preguntas.filter((p) => p.mostrarSi).length,
      termina: distintos(termina),
      descarta: distintos(descarta),
      frentes: (def.frentes ?? []).filter((f) => usaSeccion(s, f.califica)).map((f) => f.nombre),
      excluye: distintos(excluye),
      alertas,
      nse: !!def.nse && s.preguntas.some((p) => def.nse!.puntos[p.id]),
    };
  });
}

// ── el flujo como diagrama ───────────────────────────────────────────────────
/**
 * Una fila del diagrama: un paso por el que pasan todos, o ramas lado a lado.
 * Una rama empieza en una sección que solo aparece si aplica (o que se
 * repite) y sigue con las que dependen de ella (se repiten por una de sus
 * preguntas o aparecen según lo que se contestó ahí). Las secciones
 * condicionales seguidas que no dependen entre sí son ramas distintas; la
 * primera sección para todos las junta otra vez.
 */
export type FilaFlujo =
  | { tipo: 'paso'; bloque: BloqueFlujo }
  | { tipo: 'ramas'; ramas: BloqueFlujo[][] };

const esCondicional = (s: Seccion) => !!s.mostrarSi || !!s.repetirPor;

/** Si la sección depende de lo que se contesta en alguna de estas (se repite por, o aparece según). */
function dependeDe(s: Seccion, rama: Seccion[]): boolean {
  const preguntas = new Set<string>();
  const secciones = new Set<string>();
  if (s.mostrarSi) referencias(s.mostrarSi, preguntas, secciones);
  if (s.repetirPor) preguntas.add(s.repetirPor);
  return rama.some((r) => secciones.has(r.id) || r.preguntas.some((p) => preguntas.has(p.id)));
}

export function filasFlujo(def: Definicion): FilaFlujo[] {
  const bloques = new Map(mapaFlujo(def).map((b) => [b.id, b]));
  const filas: FilaFlujo[] = [];
  for (let i = 0; i < def.secciones.length;) {
    const s = def.secciones[i];
    if (!esCondicional(s)) { filas.push({ tipo: 'paso', bloque: bloques.get(s.id)! }); i++; continue; }
    const ramas: Seccion[][] = [];
    for (; i < def.secciones.length && esCondicional(def.secciones[i]); i++) {
      const x = def.secciones[i];
      const rama = ramas.find((r) => dependeDe(x, r));
      if (rama) rama.push(x); else ramas.push([x]);
    }
    filas.push({ tipo: 'ramas', ramas: ramas.map((r) => r.map((x) => bloques.get(x.id)!)) });
  }
  return filas;
}

/** Sección donde vive una pregunta (para llevar del mapa o de un problema a su lugar en el documento). */
export const seccionDe = (def: Definicion, preguntaId: string) => ubicar(def, preguntaId)?.seccion.id;
