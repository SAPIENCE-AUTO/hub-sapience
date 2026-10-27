// Lógica pura de la pantalla de guías de tópicos (sin React ni red): topes que valida el servidor, cómo se aplica un roadmap que devuelve la IA, el texto para copiar y la
// descarga del Word. Los tipos y `realinearGuia` viven en types.ts, que comparten con el servidor.
import { estadoVacio, realinearGuia } from './types';
import type { BloqueGuia, BloqueRoadmap, EstadoGuia, ModoGuia, Pregunta, SeccionGuia } from './types';

export const DURACION_MIN = 15;
export const DURACION_MAX = 480;
export const MAX_BLOQUES = 20;
/** Lo más largo que acepta el servidor para el brief que se guarda con la guía. */
export const MAX_BRIEF = 60_000;

export const duracionValida = (n: number): boolean => Number.isInteger(n) && n >= DURACION_MIN && n <= DURACION_MAX;

const txt = (v: unknown, max: number): string => String(v ?? '').slice(0, max);
const entero = (v: unknown, min: number, max: number, defecto: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : defecto;
};

// ── Renglones ─────────────────────────────────────────────────────────────────

/**
 * Un cuadro de texto con un dato por renglón (objetivos) → lista acotada. No recorta ni quita renglones vacíos: así el cursor no brinca mientras se escribe;
 * lo vacío lo limpian la IA y el Word.
 */
export const renglones = (texto: string, max: number, largo: number): string[] => texto.split('\n').slice(0, max).map((l) => l.slice(0, largo));

/** Los perfiles de la muestra (uno por renglón) para la carátula: sin renglones vacíos. */
export const perfilesDe = (texto: string): string[] => texto.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 20).map((l) => l.slice(0, 500));

/** «Marca – Estudio» del proyecto, para prellenar; si el nombre ya trae a la marca no se repite. */
export function proyectoPrellenado(p: { client?: string | null; fullName?: string | null; projectCode?: string | null }): string {
  const cliente = (p.client ?? '').trim();
  const nombre = (p.fullName ?? '').trim();
  const codigo = (p.projectCode ?? '').trim();
  if (nombre && cliente && !nombre.toLowerCase().includes(cliente.toLowerCase())) return txt(`${cliente} – ${nombre}`, 300);
  return txt(nombre || cliente || codigo, 300);
}

/** Cambia la muestra en los dos lugares donde vive: el texto del paso Proyecto y la carátula del roadmap (si ya hay). */
export const conMuestra = (s: EstadoGuia, texto: string): EstadoGuia => ({
  ...s,
  muestraText: txt(texto, 4000),
  roadmap: s.roadmap ? { ...s.roadmap, muestra: perfilesDe(texto) } : null,
});

// ── Estado ────────────────────────────────────────────────────────────────────

const bloquesDe = (s: EstadoGuia): BloqueRoadmap[] => s.roadmap?.bloques ?? [];

/** `guia` siempre del mismo largo que los bloques del roadmap (null = sin escribir). */
export const guiaAlineada = (s: EstadoGuia): (BloqueGuia | null)[] => bloquesDe(s).map((_, i) => s.guia[i] ?? null);

/** Lo que guarda la base, leído con tolerancia: lo que falte se completa con lo de una guía vacía. */
export function leerEstado(crudo: unknown): EstadoGuia {
  const base = estadoVacio();
  const r = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Partial<EstadoGuia>;
  const roadmap = r.roadmap && Array.isArray(r.roadmap.bloques) ? { muestra: Array.isArray(r.roadmap.muestra) ? r.roadmap.muestra : [], bloques: r.roadmap.bloques } : null;
  const s: EstadoGuia = {
    ...base,
    ...r,
    roadmap,
    supuestos: Array.isArray(r.supuestos) ? r.supuestos : [],
    guia: Array.isArray(r.guia) ? r.guia : [],
    duracion: entero(r.duracion, DURACION_MIN, DURACION_MAX, base.duracion),
  };
  return { ...s, guia: guiaAlineada(s) };
}

export function acotarBloque(g: BloqueGuia | null | undefined): BloqueGuia | null {
  if (!g) return null;
  return {
    moderador: txt(g.moderador, 3000),
    secciones: (g.secciones ?? []).slice(0, 20).map((s): SeccionGuia => ({
      subtema: txt(s.subtema, 300),
      ...(typeof s.intro === 'string' ? { intro: txt(s.intro, 2000) } : {}),
      preguntas: (s.preguntas ?? []).slice(0, 80).map((q): Pregunta => (typeof q === 'string' ? txt(q, 2000) : { texto: txt(q.texto, 2000), sub: (q.sub ?? []).slice(0, 30).map((x) => txt(x, 500)) })),
      notas: (s.notas ?? []).slice(0, 20).map((n) => txt(n, 2000)),
    })),
  };
}

/**
 * El estado con todos los topes que valida el servidor (largos, cuántos, números enteros), para que un texto de más no haga fallar el guardado ni una llamada a la IA con un
 * error técnico. No cambia lo que se ve en pantalla: solo lo que se manda.
 */
export function acotarEstado(s: EstadoGuia): EstadoGuia {
  const bloques = bloquesDe(s).slice(0, MAX_BLOQUES).map((b): BloqueRoadmap => ({
    nombre: txt(b.nombre, 200),
    minutos: entero(b.minutos, 0, 600, 0),
    objetivos: (b.objetivos ?? []).slice(0, 15).map((o) => txt(o, 500)),
  }));
  return {
    ...s,
    proyecto: txt(s.proyecto, 300),
    duracion: entero(s.duracion, DURACION_MIN, DURACION_MAX, 120),
    muestraText: txt(s.muestraText, 4000),
    estimulos: txt(s.estimulos, 4000),
    notas: txt(s.notas, 4000),
    tema: txt(s.tema, 4000),
    briefText: txt(s.briefText, MAX_BRIEF),
    roadmapText: txt(s.roadmapText, MAX_BRIEF),
    roadmap: s.roadmap ? { muestra: (s.roadmap.muestra ?? []).slice(0, 20).map((m) => txt(m, 500)), bloques } : null,
    supuestos: (s.supuestos ?? []).slice(0, 20).map((x) => txt(x, 1000)),
    guia: bloques.map((_, i) => acotarBloque(s.guia[i])),
  };
}

// ── Roadmap ───────────────────────────────────────────────────────────────────

export const BLOQUE_WARM_UP: BloqueRoadmap = {
  nombre: 'Warm up',
  minutos: 5,
  objetivos: ['Entrar en calor', 'Conocer un poco a los participantes', 'Establecer el tono de la conversación'],
};

/** «Los armo yo»: el warm up y un bloque en blanco con el resto de los minutos. */
export const roadmapManual = (s: EstadoGuia): EstadoGuia => ({
  ...s,
  roadmap: { muestra: perfilesDe(s.muestraText), bloques: [{ ...BLOQUE_WARM_UP, objetivos: [...BLOQUE_WARM_UP.objetivos] }, { nombre: '', minutos: Math.max(5, s.duracion - 5), objetivos: [] }] },
  guia: [null, null],
  supuestos: [],
});

/** Lo que devuelven los endpoints que leen, proponen o ajustan el roadmap. */
export interface RespuestaRoadmap {
  roadmap: { muestra?: string[]; bloques: BloqueRoadmap[] };
  supuestos: string[];
  proyecto?: string;
  duracion?: number;
}

/**
 * Pone en la guía el roadmap que devolvió la IA. Lo ya escrito se conserva solo en los bloques que quedaron iguales. El proyecto solo se llena si estaba vacío; la duración
 * solo cambia cuando se leyó un roadmap (la define él) o se pidió un ajuste (que pudo cambiarla): al proponer desde el tema o el brief es la que la persona escribió.
 */
export function aplicarRoadmapIA(s: EstadoGuia, res: RespuestaRoadmap, accion: 'proponer' | 'ajustar'): EstadoGuia {
  const bloques = (res.roadmap.bloques ?? []).slice(0, MAX_BLOQUES);
  const muestraIA = (res.roadmap.muestra ?? []).filter((m) => m.trim());
  const cambiaDuracion = (accion === 'ajustar' || s.modo === 'roadmap') && typeof res.duracion === 'number' && duracionValida(res.duracion);
  return {
    ...s,
    proyecto: s.proyecto.trim() ? s.proyecto : txt(res.proyecto ?? '', 300),
    duracion: cambiaDuracion ? (res.duracion as number) : s.duracion,
    muestraText: muestraIA.length ? txt(muestraIA.join('\n'), 4000) : s.muestraText,
    roadmap: { muestra: muestraIA.length ? muestraIA : perfilesDe(s.muestraText), bloques },
    supuestos: res.supuestos ?? [],
    guia: realinearGuia(s, bloques),
  };
}

/** Todos los bloques con nombre y al menos uno: lo mínimo para escribir la guía. */
export const roadmapListo = (s: EstadoGuia): boolean => bloquesDe(s).length > 0 && bloquesDe(s).every((b) => b.nombre.trim() !== '');

/** Minutos que faltan (positivo) o sobran (negativo) para llegar a la duración. */
export const minutosFaltan = (s: EstadoGuia): number => s.duracion - bloquesDe(s).reduce((a, b) => a + (b.minutos || 0), 0);

// ── Copiar y descargar ────────────────────────────────────────────────────────

/** La guía en texto plano, para pegar donde sea. */
export function guiaTexto(titulo: string, s: EstadoGuia): string {
  const lineas: string[] = [titulo, `${s.tipo} · ${s.duracion} min.`, ''];
  if (s.tema.trim()) lineas.push(`Tema: ${s.tema.trim()}`, '');
  const muestra = (s.roadmap?.muestra?.length ? s.roadmap.muestra : perfilesDe(s.muestraText)).filter((m) => m.trim());
  if (muestra.length) lineas.push('Muestra:', ...muestra.map((m) => `- ${m}`), '');
  bloquesDe(s).forEach((b, i) => {
    lineas.push(`${i + 1}. ${b.nombre} (${b.minutos} min.)`);
    const g = s.guia[i];
    if (!g) { lineas.push('(Bloque por escribir)', ''); return; }
    if (g.moderador) lineas.push(`Moderador: ${g.moderador}`);
    for (const sec of g.secciones) {
      if (sec.subtema) lineas.push('', sec.subtema);
      if (sec.intro) lineas.push(sec.intro);
      for (const q of sec.preguntas) {
        lineas.push(`• ${typeof q === 'string' ? q : q.texto}`);
        if (typeof q !== 'string') for (const sub of q.sub) lineas.push(`   – ${sub}`);
      }
      for (const n of sec.notas) lineas.push(`Nota: ${n}`);
    }
    lineas.push('');
  });
  lineas.push('Cierre y agradecimientos.');
  return lineas.join('\n').replace(/\*\*/g, '');
}

export const TIPO_WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** El Word que manda el servidor (base64) como archivo. */
export function base64ABlob(base64: string, tipo: string = TIPO_WORD): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: tipo });
}

/** Baja un archivo ya armado en el navegador. */
export function descargarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Cómo se llama el punto de partida en pantalla. */
export const NOMBRE_MODO: Record<ModoGuia, string> = {
  roadmap: 'Tengo el roadmap',
  brief: 'Tengo el brief',
  tema: 'Solo tengo el tema',
};
