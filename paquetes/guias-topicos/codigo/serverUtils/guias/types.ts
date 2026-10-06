// Tipos de la guía de tópicos. Los comparten el servidor (src/serverUtils/guias) y el front.

export type TipoSesion = 'Sesión de grupo' | 'Mini grupo' | 'Tríada' | 'Entrevista a profundidad';
export const TIPOS_SESION: TipoSesion[] = ['Sesión de grupo', 'Mini grupo', 'Tríada', 'Entrevista a profundidad'];

/** De dónde se parte: un roadmap que ya existe, un brief, o solo el tema. */
export type ModoGuia = 'roadmap' | 'brief' | 'tema';

export interface BloqueRoadmap { nombre: string; minutos: number; objetivos: string[] }
export interface Roadmap {
  /** Un perfil por renglón; va en la carátula. */
  muestra: string[];
  bloques: BloqueRoadmap[];
}

export type Pregunta = string | { texto: string; sub: string[] };
export interface SeccionGuia { subtema: string; intro?: string; preguntas: Pregunta[]; notas: string[] }
/** Lo escrito de un bloque. El título y los minutos salen del roadmap. */
export interface BloqueGuia { moderador: string; secciones: SeccionGuia[] }

/** Todo lo de una guía; se guarda entero en guias_topicos.estado (jsonb). */
export interface EstadoGuia {
  modo: ModoGuia;
  paso: 'proyecto' | 'roadmap' | 'guia';
  proyecto: string;
  tipo: TipoSesion;
  duracion: number;
  muestraText: string;
  estimulos: string;
  notas: string;
  /** Lo que se quiere entender (modo «tema»). */
  tema: string;
  /** Extracto del brief (modo «brief»); se manda como contexto al escribir los bloques. */
  briefText: string;
  roadmap: Roadmap | null;
  /** Decisiones que Claude tomó sin que el brief/tema las resolviera; se muestran para revisarlas. */
  supuestos: string[];
  /** Mismo largo que roadmap.bloques; null = bloque sin escribir. */
  guia: (BloqueGuia | null)[];
}

export const estadoVacio = (): EstadoGuia => ({
  modo: 'tema', paso: 'proyecto', proyecto: '', tipo: 'Sesión de grupo', duracion: 120, muestraText: '', estimulos: '', notas: '',
  tema: '', briefText: '', roadmap: null, supuestos: [], guia: [],
});

export const minutosRoadmap = (bloques: BloqueRoadmap[]) => bloques.reduce((a, b) => a + (b.minutos || 0), 0);

/**
 * Con un roadmap nuevo (propuesto o ajustado), lo ya escrito se conserva solo en los bloques que
 * quedaron igual (mismo nombre, minutos y objetivos). Para usarlo en el front al aplicar el roadmap.
 */
export function realinearGuia(anterior: EstadoGuia, nuevos: BloqueRoadmap[]): (BloqueGuia | null)[] {
  const igual = (a: BloqueRoadmap, b: BloqueRoadmap) =>
    a.nombre.trim() === b.nombre.trim() && a.minutos === b.minutos && a.objetivos.join('\n') === b.objetivos.join('\n');
  const viejos = anterior.roadmap?.bloques ?? [];
  return nuevos.map((b) => {
    const j = viejos.findIndex((v) => igual(v, b));
    return j >= 0 ? anterior.guia[j] ?? null : null;
  });
}
