import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarEnTextos } from '@/lib/minutas/busquedaTranscripcion';

/**
 * El estado de «buscar en la transcripción»: lo escrito, las coincidencias, cuál es la actual y cómo moverse entre ellas.
 * `contenedorRef` va en el elemento con scroll que contiene el texto; la coincidencia actual lleva `data-coincidencia={número}`
 * y la pantalla se desplaza hasta ella al cambiar de coincidencia.
 */
export function useBusquedaTranscripcion(textos: string[]) {
  const [consulta, setConsulta] = useState('');
  const [actual, setActual] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const resultado = useMemo(() => buscarEnTextos(textos, consulta), [textos, consulta]);
  const total = resultado.total;
  const buscando = consulta.trim().length > 0;

  // Otra transcripción: se vuelve a la primera coincidencia.
  useEffect(() => { setActual(0); }, [textos]);

  useEffect(() => {
    if (!buscando || total === 0) return;
    contenedorRef.current?.querySelector<HTMLElement>(`[data-coincidencia="${actual}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [actual, buscando, total, consulta]);

  const mover = (paso: 1 | -1) => setActual(i => (total ? (i + paso + total) % total : 0));
  return {
    consulta, resultado, total, buscando, contenedorRef,
    // Al cambiar lo escrito se vuelve a la primera coincidencia, en el mismo dibujo (si no, se desplazaría un instante a una de la búsqueda anterior).
    setConsulta: (texto: string) => { setConsulta(texto); setActual(0); },
    actual: total ? Math.min(actual, total - 1) : 0,
    siguiente: () => mover(1),
    anterior: () => mover(-1),
    limpiar: () => { setConsulta(''); setActual(0); },
  };
}
