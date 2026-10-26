import { useEffect, useState } from 'react';
import { firmarFotosFormulario } from 'zite-endpoints-sdk';
import { esFotoDeFiltro, rutaDeFoto } from '@/lib/formularios/fotoTablero';

// Los enlaces temporales de las fotos de los filtros duran 10 min; se reusan 9.
const enlaces = new Map<string, { url: string; vence: number }>();

async function enlaceDe(ruta: string): Promise<string> {
  const ya = enlaces.get(ruta);
  if (ya && ya.vence > Date.now()) return ya.url;
  const r = await firmarFotosFormulario({ rutas: [ruta] }) as { urls: Record<string, string> };
  const url = r.urls?.[ruta];
  if (!url) throw new Error('No se pudo abrir la foto');
  enlaces.set(ruta, { url, vence: Date.now() + 9 * 60_000 });
  return url;
}

/**
 * La URL con la que se ve un archivo de una celda del tablero: la misma, o
 * —si es una foto de un filtro («hubfoto:…», carpeta privada)— un enlace
 * temporal que se pide al abrirla. Fuera del Hub (un enlace compartido) no
 * se puede pedir y queda `error`.
 */
export function useUrlParaVer(url: string, activo: boolean): { url: string | null; error: boolean } {
  const directa = !esFotoDeFiltro(url);
  const [estado, setEstado] = useState<{ url: string | null; error: boolean }>({ url: null, error: false });
  useEffect(() => {
    if (directa || !activo) return;
    let vigente = true;
    setEstado({ url: null, error: false });
    enlaceDe(rutaDeFoto(url))
      .then((u) => { if (vigente) setEstado({ url: u, error: false }); })
      .catch(() => { if (vigente) setEstado({ url: null, error: true }); });
    return () => { vigente = false; };
  }, [url, activo, directa]);
  return directa ? { url, error: false } : estado;
}
