import { useEffect, useState } from 'react';

const leer = (): boolean => typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

/** ¿La pantalla está en modo oscuro? Las gráficas lo necesitan para escoger colores que se vean. */
export function useOscuro(): boolean {
  const [oscuro, setOscuro] = useState(leer);
  useEffect(() => {
    const ob = new MutationObserver(() => setOscuro(leer()));
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => ob.disconnect();
  }, []);
  return oscuro;
}
