import { useCallback, useEffect, useRef, useState } from 'react';
import { generateGuiaBloque } from 'zite-endpoints-sdk';
import { acotarBloque, acotarEstado } from '@/lib/guias/texto';
import type { BloqueGuia, EstadoGuia } from '@/lib/guias/types';

export type EstadoBloque = 'cola' | 'escribiendo' | { error: string };
export type EstadosBloques = Record<number, EstadoBloque>;
type Actualizar = (fn: (s: EstadoGuia) => EstadoGuia) => void;
type Llamada = Promise<{ bloque: BloqueGuia }> & { cancelar: () => void };

/**
 * La escritura de la guía con IA, de dos bloques en dos. Cada bloque aparece en cuanto está listo; si uno falla se queda con su error (y «Reintentar») sin detener a los
 * demás; «Detener» corta lo que esté en curso y no arranca lo que sigue. Vive en el editor y no en el paso, para no perderse al moverse entre pasos.
 */
export function useEscribirGuia(leerEstado: () => EstadoGuia | null, actualizar: Actualizar) {
  const [estados, setEstados] = useState<EstadosBloques>({});
  const enCurso = useRef(new Set<Llamada>());
  const detenido = useRef(false);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    const llamadas = enCurso.current;
    return () => {
      vivo.current = false;
      detenido.current = true;
      for (const l of llamadas) l.cancelar();
    };
  }, []);

  const poner = useCallback((i: number, v: EstadoBloque | null) => {
    if (!vivo.current) return;
    setEstados((m) => {
      const n = { ...m };
      if (v === null) delete n[i]; else n[i] = v;
      return n;
    });
  }, []);

  /** Escribe un bloque; con `previo` y `comentario`, lo rehace con ese cambio. */
  const escribirUno = useCallback(async (i: number, previo?: BloqueGuia | null, comentario?: string) => {
    const st = leerEstado();
    if (!st?.roadmap?.bloques[i]) { poner(i, null); return; }
    poner(i, 'escribiendo');
    // El servidor pide al menos una sección en el bloque anterior: uno vacío se reescribe desde cero.
    const anterior = previo && previo.secciones.length > 0 ? acotarBloque(previo) : null;
    const llamada = generateGuiaBloque({ estado: acotarEstado(st), indice: i, ...(anterior ? { previo: anterior, comentario: comentario ?? '' } : {}) }) as Llamada;
    enCurso.current.add(llamada);
    try {
      const r = await llamada;
      const bloque = acotarBloque(r.bloque);
      actualizar((s) => ({ ...s, guia: (s.roadmap?.bloques ?? []).map((_, j) => (j === i ? bloque : s.guia[j] ?? null)) }));
      poner(i, null);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'DETENIDO') poner(i, null);
      else poner(i, { error: err.message || 'No se pudo escribir este bloque.' });
    } finally {
      enCurso.current.delete(llamada);
    }
  }, [leerEstado, actualizar, poner]);

  /** Varios bloques, de dos en dos. */
  const escribirVarios = useCallback(async (indices: number[]) => {
    detenido.current = false;
    const cola = [...indices];
    for (const i of cola) poner(i, 'cola');
    const trabajador = async () => {
      while (cola.length > 0 && !detenido.current) await escribirUno(cola.shift() as number);
    };
    await Promise.all([trabajador(), trabajador()]);
    for (const i of cola) poner(i, null);
  }, [escribirUno, poner]);

  const rehacer = useCallback((i: number, previo: BloqueGuia | null, comentario: string) => {
    detenido.current = false;
    return escribirUno(i, previo, comentario);
  }, [escribirUno]);

  const escribirSolo = useCallback((i: number) => {
    detenido.current = false;
    return escribirUno(i);
  }, [escribirUno]);

  const detener = useCallback(() => {
    detenido.current = true;
    for (const l of enCurso.current) l.cancelar();
  }, []);

  /** Quita el aviso de error de un bloque (la guía no se toca). */
  const descartar = useCallback((i: number) => poner(i, null), [poner]);

  const escribiendo = Object.values(estados).some((v) => v === 'escribiendo' || v === 'cola');
  return { estados, escribiendo, escribirVarios, escribirSolo, rehacer, detener, descartar };
}

export type EscritorGuia = ReturnType<typeof useEscribirGuia>;
