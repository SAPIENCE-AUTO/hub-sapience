import { explicarResultado, seleccion, textoRespuesta } from './motor';
import { NOMBRES_NSE } from './nse';
import { nombreCampoDireccion } from './paises';
import {
  CAMPOS_DIRECCION, esMatriz, forma,
  type Condicion, type Definicion, type FotoSubida, type Opcion, type Pregunta, type Respuestas, type Resultado,
} from './tipos';

/**
 * Convierte las respuestas de un formulario en una tabla: una fila por
 * persona, una columna por pregunta. Las columnas salen del screener guardado,
 * así cada formulario tiene las suyas sin configurar nada. Un bloque repetido
 * (un formato, un tipo de limpiador) da una columna por pregunta y por opción,
 * solo para las opciones que alguien contestó. Lo usa el Excel del panel.
 *
 * Con `completas` salen todas las columnas que el screener puede llegar a
 * tener, aunque nadie haya contestado: así se arma un tablero de Reclutamiento
 * desde que se vincula, igual que un formulario de Fillout.
 *
 * Una matriz da una columna por fila y una dirección una por campo (calle,
 * colonia, código postal…); las escalas son columnas de número; un texto o
 * imagen sin pregunta no da columna.
 */

export interface FilaRespuesta {
  createdAt: string;
  esPrueba: boolean;
  respuestas: Respuestas;
  resultado: Resultado;
  duracionSeg?: number;
}

export type Celda = string | number | undefined;

export interface Columna {
  /** Estable entre descargas: con ella se ubica la columna del tablero de Reclutamiento. */
  clave: string;
  titulo: string;
  /** Tipo de columna del tablero de Reclutamiento. */
  tipo: 'Texto' | 'Número';
  /** Encabezado de grupo encima de la columna (la sección del screener). */
  seccion: string;
  valor: (f: FilaRespuesta) => Celda;
}

function buscar(def: Definicion, id: string): Pregunta | undefined {
  for (const s of def.secciones) for (const p of s.preguntas) if (p.id === id) return p;
  return undefined;
}

/** Las opciones de una pregunta, también las que salen de otra (`opcionesDe`) más sus extras. */
export function opcionesDe(def: Definicion, p: Pregunta): Opcion[] {
  if (!p.opcionesDe) return p.opciones ?? [];
  const origen = buscar(def, p.opcionesDe);
  return [...(origen ? opcionesDe(def, origen) : []), ...(p.opcionesExtra ?? [])];
}

/** ¿La pregunta puede aparecer en esta repetición? Solo descarta lo que depende de la opción («solo especializado»). */
function puedeAparecer(c: Condicion | undefined, instancia?: string): boolean {
  if (!c) return true;
  if ('instanciaEs' in c) return !!instancia && c.instanciaEs.includes(instancia);
  if ('todas' in c) return c.todas.every((x) => puedeAparecer(x, instancia));
  if ('alguna' in c) return c.alguna.some((x) => puedeAparecer(x, instancia));
  return true;
}

const conOpcion = (texto: string, o?: Opcion) => (o ? texto.split('{opcion}').join(o.corto ?? o.label) : texto);

/** El encabezado de la columna de una pregunta: su nombre corto o, si no tiene, su texto. */
export const nombreDePregunta = (p: Pregunta): string => p.nombre?.trim() || NOMBRES_NSE[p.id] || p.texto;

/** Preguntas que dan columna y no tienen nombre corto (el NSE trae el suyo). */
export const sinNombreCorto = (def: Definicion): Pregunta[] =>
  def.secciones.flatMap((s) => s.preguntas).filter((p) => forma(p.tipo) !== 'ninguna' && !p.nombre?.trim() && !NOMBRES_NSE[p.id]);

function celda(def: Definicion, p: Pregunta, clave: string, resp: Respuestas): Celda {
  const v = resp[clave];
  if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return undefined;
  if (p.tipo === 'foto') {
    const n = (v as FotoSubida[]).length;
    return `${n} foto${n === 1 ? '' : 's'}`;
  }
  if (forma(p.tipo) === 'numero') return typeof v === 'number' ? v : Number(v);
  return textoRespuesta(p, opcionesDe(def, p), clave, resp);
}

/**
 * `comoAntes`: los títulos como se llamaban las columnas antes de los nombres
 * cortos (el texto de cada pregunta, y «Frente» en vez de «Perfil»), para
 * reconocerlas al renombrarlas en el tablero.
 */
export function columnas(def: Definicion, filas: FilaRespuesta[], { completas = false, comoAntes = false }: { completas?: boolean; comoAntes?: boolean } = {}): Columna[] {
  const nombreFrente = (id: string) => def.frentes?.find((f) => f.id === id)?.nombre ?? id;
  const fijas: Columna[] = [
    { clave: 'nombre', tipo: 'Texto', seccion: 'Persona', titulo: 'Nombre', valor: (f) => (def.claves?.nombre ? celda(def, buscar(def, def.claves.nombre)!, def.claves.nombre, f.respuestas) : undefined) },
    { clave: 'celular', tipo: 'Texto', seccion: 'Persona', titulo: 'Celular', valor: (f) => (def.claves?.telefono ? celda(def, buscar(def, def.claves.telefono)!, def.claves.telefono, f.respuestas) : undefined) },
    {
      clave: 'resultado', tipo: 'Texto', seccion: 'Resultado', titulo: 'Resultado',
      valor: (f) => (f.resultado.califica ? 'Califica' : f.resultado.incompleto ? 'Incompleta' : 'No califica'),
    },
    { clave: 'frente', tipo: 'Texto', seccion: 'Resultado', titulo: comoAntes ? 'Frente' : 'Perfil', valor: (f) => f.resultado.frentes.map(nombreFrente).join(', ') || undefined },
    { clave: 'motivo', tipo: 'Texto', seccion: 'Resultado', titulo: 'Por qué no califica', valor: (f) => explicarResultado(f.resultado) },
    { clave: 'nse', tipo: 'Texto', seccion: 'Resultado', titulo: 'NSE', valor: (f) => f.resultado.nse?.nivel },
    { clave: 'nse_puntos', tipo: 'Número', seccion: 'Resultado', titulo: 'Puntos NSE', valor: (f) => f.resultado.nse?.puntos },
    { clave: 'alertas', tipo: 'Texto', seccion: 'Resultado', titulo: 'Alertas', valor: (f) => f.resultado.alertas.join(' · ') || undefined },
    { clave: 'fecha', tipo: 'Texto', seccion: 'Resultado', titulo: 'Fecha', valor: (f) => new Date(f.createdAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }) },
    { clave: 'minutos', tipo: 'Número', seccion: 'Resultado', titulo: 'Minutos', valor: (f) => (f.duracionSeg !== undefined ? Math.round(f.duracionSeg / 60) : undefined) },
    { clave: 'tipo', tipo: 'Texto', seccion: 'Resultado', titulo: 'Tipo', valor: (f) => (f.esPrueba ? 'Prueba' : 'Real') },
  ];
  const yaFijas = new Set([def.claves?.nombre, def.claves?.telefono].filter(Boolean));

  const deSecciones: Columna[] = [];
  for (const s of def.secciones) {
    const instancias: (Opcion | undefined)[] = [undefined];
    if (s.repetirPor) {
      const origen = buscar(def, s.repetirPor);
      const contestadas = new Set(filas.flatMap((f) => seleccion(f.respuestas[s.repetirPor!])));
      instancias.splice(0, 1, ...(origen ? opcionesDe(def, origen) : [])
        .filter((o) => !o.exclusiva && (completas || contestadas.has(o.id)) && (!s.repetirSolo || s.repetirSolo.includes(o.id))));
    }
    for (const inst of instancias) {
      const seccion = conOpcion(s.titulo ?? s.id, inst);
      for (const p of s.preguntas) {
        if (yaFijas.has(p.id) || !puedeAparecer(p.mostrarSi, inst?.id)) continue;
        const clave = inst ? `${p.id}@${inst.id}` : p.id;
        const titulo = conOpcion(comoAntes ? p.texto : nombreDePregunta(p), inst);
        if (forma(p.tipo) === 'ninguna') continue;
        if (esMatriz(p.tipo)) {
          for (const fila of p.filas ?? []) {
            deSecciones.push({
              clave: `${clave}.${fila.id}`, tipo: 'Texto', seccion, titulo: `${titulo} · ${fila.label}`,
              valor: (f) => {
                const elegidas = seleccion((f.respuestas[clave] as Record<string, string | string[]> | undefined)?.[fila.id]);
                return (p.opciones ?? []).filter((o) => elegidas.includes(o.id)).map((o) => o.label).join(', ') || undefined;
              },
            });
          }
        } else if (p.tipo === 'direccion') {
          for (const campo of CAMPOS_DIRECCION) {
            deSecciones.push({
              clave: `${clave}.${campo}`, tipo: 'Texto', seccion, titulo: `${titulo} · ${nombreCampoDireccion(def.pais, campo)}`,
              valor: (f) => (f.respuestas[clave] as Record<string, string> | undefined)?.[campo]?.trim() || undefined,
            });
          }
        } else {
          deSecciones.push({ clave, tipo: forma(p.tipo) === 'numero' ? 'Número' : 'Texto', seccion, titulo, valor: (f) => celda(def, p, clave, f.respuestas) });
        }
      }
    }
  }

  // Sin `completas`, fuera las columnas que nadie contestó (preguntas de un formato que no salió).
  return [...fijas, ...(completas ? deSecciones : deSecciones.filter((c) => filas.some((f) => c.valor(f) !== undefined)))];
}

// ── las columnas en un tablero de Reclutamiento ──────────────────────────────
// Las de resultado llevan «Filtro ·» para no confundirse con columnas del equipo; las de un bloque
// repetido, el nombre del bloque («Tu aerosol · Dónde compra»), porque la pregunta se repite.
export function nombreColumnaTablero(c: Columna): string {
  if (c.seccion === 'Resultado') return `Filtro · ${c.titulo}`;
  return c.clave.includes('@') ? `${c.seccion} · ${c.titulo}` : c.titulo;
}

/** Un nombre que no se repita en el tablero: «Edad», si ya hay una, «Edad (2)». */
export function nombreLibre(base: string, usados: Set<string>): string {
  let nombre = base;
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) nombre = `${base} (${n})`;
  return nombre;
}

/**
 * Columnas del tablero que hay que renombrar porque su pregunta ahora se llama
 * distinto (le pusieron nombre corto o lo corrigieron). Solo las que dejó así
 * el Hub: si el equipo renombró una desde el tablero, se respeta. `puestos`
 * son los nombres que el Hub les dio la última vez; las que se crearon antes
 * de guardarlos se reconocen porque se llaman como su pregunta (`antes`), con
 * o sin «(2)».
 */
export function columnasPorRenombrar(o: {
  vivas: { id: string; nombre: string }[];
  mapa: Record<string, string>;
  puestos: Record<string, string>;
  cols: Columna[];
  antes: Columna[];
}): { id: string; clave: string; nombre: string }[] {
  const porId = new Map(o.vivas.map((c) => [c.id, c.nombre]));
  const usados = new Set(o.vivas.map((c) => c.nombre.toLowerCase()));
  const antes = new Map(o.antes.map((c) => [c.clave, nombreColumnaTablero(c)]));
  const sinNumero = (n: string) => n.replace(/ \(\d+\)$/, '');
  const out: { id: string; clave: string; nombre: string }[] = [];
  for (const c of o.cols) {
    const id = o.mapa[c.clave];
    const actual = id ? porId.get(id) : undefined;
    if (actual === undefined) continue;
    const delHub = o.puestos[c.clave] !== undefined
      ? actual === o.puestos[c.clave]
      : sinNumero(actual).toLowerCase() === (antes.get(c.clave) ?? '').toLowerCase();
    const base = nombreColumnaTablero(c);
    if (!delHub || sinNumero(actual) === base) continue;
    usados.delete(actual.toLowerCase());
    const nombre = nombreLibre(base, usados);
    usados.add(nombre.toLowerCase());
    if (nombre !== actual) out.push({ id, clave: c.clave, nombre });
  }
  return out;
}
