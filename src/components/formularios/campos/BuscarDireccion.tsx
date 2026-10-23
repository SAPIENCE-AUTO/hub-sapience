import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { detalleDireccion, sugerirDireccion } from 'zite-endpoints-sdk';
import type { CampoDireccion } from '@/lib/formularios/tipos';
import { BORDE, SUAVE, TINTA, inputClass } from './estilo';

interface Sugerencia { id: string; principal: string; secundario: string }
type Partes = Partial<Record<CampoDireccion, string>>;

/** Token de una búsqueda: las sugerencias y la dirección elegida se cobran como una sola sesión. */
const nuevaSesion = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/** Si el buscador de Google está disponible (llave y servicio prendido), sabido una vez por página. */
let disponibleGlobal: Promise<boolean> | null = null;

/**
 * «Busca tu dirección»: van escribiendo y salen sugerencias de Google; al
 * elegir una, regresan sus partes para llenar los campos. Si Google no está
 * disponible, `onNoDisponible` y la dirección se escribe a mano.
 */
export function BuscarDireccion({ codigo, onElegir, onNoDisponible }: {
  codigo: string;
  onElegir: (partes: Partes) => void;
  onNoDisponible: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const sesion = useRef(nuevaSesion());
  const ultima = useRef(0);
  /** El texto de la dirección elegida: no se vuelve a buscar. */
  const elegida = useRef('');

  // ¿Hay buscador? (sin texto no llama a Google)
  useEffect(() => {
    disponibleGlobal ??= (sugerirDireccion({ codigo, sesion: sesion.current, texto: '' }) as Promise<{ disponible: boolean }>)
      .then((r) => r.disponible).catch(() => false);
    void disponibleGlobal.then((si) => { if (!si) onNoDisponible(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = texto.trim();
    if (t.length < 4 || texto === elegida.current) { setSugerencias([]); return; }
    const n = ++ultima.current;
    const espera = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await sugerirDireccion({ codigo, sesion: sesion.current, texto: t }) as { disponible: boolean; sugerencias: Sugerencia[] };
        if (n !== ultima.current) return;
        if (!r.disponible) { onNoDisponible(); return; }
        setSugerencias(r.sugerencias);
        setAbierto(true);
      } catch {
        if (n === ultima.current) setSugerencias([]);
      } finally {
        if (n === ultima.current) setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(espera);
  }, [texto]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = async (s: Sugerencia) => {
    setAbierto(false);
    setEligiendo(true);
    elegida.current = [s.principal, s.secundario].filter(Boolean).join(', ');
    setTexto(elegida.current);
    try {
      const r = await detalleDireccion({ codigo, sesion: sesion.current, id: s.id }) as { disponible: boolean; direccion?: Partes };
      if (r.direccion) onElegir(r.direccion); else if (!r.disponible) onNoDisponible();
    } catch {
      onNoDisponible();
    } finally {
      setEligiendo(false);
      sesion.current = nuevaSesion();
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2" style={{ color: SUAVE }} />
        <input
          className={`${inputClass} pl-11`}
          value={texto}
          placeholder="Busca tu dirección: calle y número"
          autoComplete="off"
          role="combobox"
          aria-expanded={abierto && sugerencias.length > 0}
          aria-label="Busca tu dirección"
          onChange={(e) => setTexto(e.target.value)}
          onFocus={(e) => {
            if (sugerencias.length) setAbierto(true);
            // En el celular, que el cuadro suba: las sugerencias van abajo y el teclado tapa la mitad de la pantalla.
            const cuadro = e.currentTarget;
            setTimeout(() => cuadro.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
          }}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && sugerencias[0]) { e.preventDefault(); void elegir(sugerencias[0]); } }}
        />
        {(buscando || eligiendo) && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" style={{ color: SUAVE }} />}
      </div>
      {abierto && sugerencias.length > 0 && (
        <ul role="listbox" className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border-[1.5px] bg-white shadow-lg" style={{ borderColor: BORDE }}>
          {sugerencias.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button
                type="button"
                // mousedown antes del blur del cuadro, para que el clic no se pierda
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void elegir(s)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#F4F4F5]"
              >
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: SUAVE }} />
                <span className="min-w-0">
                  <span className="block text-[15px] leading-snug" style={{ color: TINTA }}>{s.principal}</span>
                  {s.secundario && <span className="block text-[13px] leading-snug" style={{ color: SUAVE }}>{s.secundario}</span>}
                </span>
              </button>
            </li>
          ))}
          <li className="px-4 py-1.5 text-right text-[11px]" style={{ color: SUAVE }}>Sugerencias de Google</li>
        </ul>
      )}
    </div>
  );
}
