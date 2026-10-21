import { explicarResultado, seleccion } from './motor';
import type { Definicion, FotoSubida, Opcion, Pregunta, Respuestas, Resultado } from './tipos';

/**
 * Convierte las respuestas de un formulario en una tabla: una fila por
 * persona, una columna por pregunta. Las columnas salen del screener guardado,
 * así cada formulario tiene las suyas sin configurar nada. Un bloque repetido
 * (un formato, un tipo de limpiador) da una columna por pregunta y por opción,
 * solo para las opciones que alguien contestó. Lo usa el Excel del panel.
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

function opcionesDe(def: Definicion, p: Pregunta): Opcion[] {
  if (!p.opcionesDe) return p.opciones ?? [];
  const origen = buscar(def, p.opcionesDe);
  return [...(origen ? opcionesDe(def, origen) : []), ...(p.opcionesExtra ?? [])];
}

const conOpcion = (texto: string, o?: Opcion) => (o ? texto.split('{opcion}').join(o.corto ?? o.label) : texto);

function celda(def: Definicion, p: Pregunta, clave: string, resp: Respuestas): Celda {
  const v = resp[clave];
  if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return undefined;
  if (p.tipo === 'foto') {
    const n = (v as FotoSubida[]).length;
    return `${n} foto${n === 1 ? '' : 's'}`;
  }
  if (p.tipo === 'numero') return typeof v === 'number' ? v : Number(v);
  if (p.tipo === 'unica' || p.tipo === 'multiple') {
    const opciones = opcionesDe(def, p);
    const otra = resp[`${clave}#otra`];
    return seleccion(v)
      .map((id) => {
        const o = opciones.find((x) => x.id === id);
        if (!o) return id;
        return o.otra && otra ? `${o.label}: ${otra}` : o.label;
      })
      .join(', ');
  }
  return String(v);
}

export function columnas(def: Definicion, filas: FilaRespuesta[]): Columna[] {
  const nombreFrente = (id: string) => def.frentes?.find((f) => f.id === id)?.nombre ?? id;
  const fijas: Columna[] = [
    { clave: 'nombre', tipo: 'Texto', seccion: 'Persona', titulo: 'Nombre', valor: (f) => (def.claves?.nombre ? celda(def, buscar(def, def.claves.nombre)!, def.claves.nombre, f.respuestas) : undefined) },
    { clave: 'celular', tipo: 'Texto', seccion: 'Persona', titulo: 'Celular', valor: (f) => (def.claves?.telefono ? celda(def, buscar(def, def.claves.telefono)!, def.claves.telefono, f.respuestas) : undefined) },
    {
      clave: 'resultado', tipo: 'Texto', seccion: 'Resultado', titulo: 'Resultado',
      valor: (f) => (f.resultado.califica ? 'Califica' : f.resultado.incompleto ? 'Incompleta' : 'No califica'),
    },
    { clave: 'frente', tipo: 'Texto', seccion: 'Resultado', titulo: 'Frente', valor: (f) => f.resultado.frentes.map(nombreFrente).join(', ') || undefined },
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
        .filter((o) => !o.exclusiva && contestadas.has(o.id) && (!s.repetirSolo || s.repetirSolo.includes(o.id))));
    }
    for (const inst of instancias) {
      const seccion = conOpcion(s.titulo ?? s.id, inst);
      for (const p of s.preguntas) {
        if (yaFijas.has(p.id)) continue;
        const clave = inst ? `${p.id}@${inst.id}` : p.id;
        const titulo = conOpcion(p.texto, inst);
        if (p.tipo === 'matriz') {
          for (const fila of p.filas ?? []) {
            deSecciones.push({
              clave: `${clave}.${fila.id}`, tipo: 'Texto', seccion, titulo: `${titulo} · ${fila.label}`,
              valor: (f) => {
                const elegida = (f.respuestas[clave] as Record<string, string> | undefined)?.[fila.id];
                return p.opciones?.find((o) => o.id === elegida)?.label;
              },
            });
          }
        } else {
          deSecciones.push({ clave, tipo: p.tipo === 'numero' ? 'Número' : 'Texto', seccion, titulo, valor: (f) => celda(def, p, clave, f.respuestas) });
        }
      }
    }
  }

  // Fuera las columnas que nadie contestó (preguntas que solo aparecen para un formato que no salió).
  return [...fijas, ...deSecciones.filter((c) => filas.some((f) => c.valor(f) !== undefined))];
}
