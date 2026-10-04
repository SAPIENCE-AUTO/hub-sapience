import { useEffect, useRef, useState } from 'react';

// Corre un endpoint streaming (Claude tarda minutos) y expone los pasos que va
// reportando + el tiempo transcurrido. Los latidos (mismo paso repetido) no se
// duplican en la lista.
export function useLlamadaLarga() {
  const [pasos, setPasos] = useState<string[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const t0 = useRef(0);

  useEffect(() => {
    if (!corriendo) return;
    const id = setInterval(() => setSegundos(Math.round((Date.now() - t0.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [corriendo]);

  async function correr<T = any>(llamada: Promise<T> & AsyncIterable<any>): Promise<T> {
    t0.current = Date.now(); setSegundos(0); setPasos([]); setCorriendo(true);
    try {
      for await (const chunk of llamada) {
        const paso = chunk?.paso as string | undefined;
        if (paso) setPasos(prev => (prev[prev.length - 1] === paso ? prev : [...prev, paso]));
      }
      return await llamada;
    } finally {
      setCorriendo(false);
    }
  }
  return { pasos, corriendo, segundos, correr };
}
