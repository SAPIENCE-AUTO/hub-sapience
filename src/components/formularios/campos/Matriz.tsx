import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { seleccion } from '@/lib/formularios/motor';
import { forma } from '@/lib/formularios/tipos';
import { ERROR, SUAVE, TINTA, alternar, type CampoProps } from './estilo';

/**
 * Matriz como tabla: los renglones a la izquierda, las columnas arriba y un
 * círculo (una por renglón) o un cuadro (varias) en cada cruce; se toca la
 * celda completa. Si las columnas no caben en el celular, la tabla se desliza
 * de lado con los renglones fijos y lo avisa. Con `faltan`, los renglones sin
 * contestar se marcan en rojo.
 */
export function Matriz({ pv, resp, onChange, faltan }: CampoProps & { faltan?: boolean }) {
  const varias = forma(pv.pregunta.tipo) === 'matriz_varias';
  const filas = (resp[pv.clave] as Record<string, string | string[]> | undefined) ?? {};
  const caja = useRef<HTMLDivElement>(null);
  const [desliza, setDesliza] = useState({ hay: false, alFinal: false });

  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setDesliza({ hay: el.scrollWidth > el.clientWidth + 2, alFinal: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    el.addEventListener('scroll', medir, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', medir); };
  }, [pv.opciones.length]);

  // Columnas angostas si las etiquetas son cortas; más anchas si alguna es larga.
  const largas = pv.opciones.some((o) => o.label.length > 14);
  const anchoColumna = largas ? 'min-w-[84px]' : 'min-w-[54px]';

  return (
    <div>
      {desliza.hay && <p className="mb-1.5 text-[12px]" style={{ color: SUAVE }}>Desliza para ver más opciones →</p>}
      <div className="relative overflow-hidden rounded-xl border-[1.5px] border-[#D9D9DE] bg-white">
        <div ref={caja} className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-[1] bg-white" />
                {pv.opciones.map((o) => (
                  <th key={o.id} scope="col" className={`${anchoColumna} px-1.5 pb-2 pt-3 align-bottom text-[11.5px] font-medium leading-tight`} style={{ color: SUAVE }}>
                    {o.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(pv.pregunta.filas ?? []).map((f, i) => {
                const marcadas = seleccion(filas[f.id]);
                const fondo = i % 2 === 0 ? 'bg-[#F7F7F8]' : 'bg-white';
                const falta = faltan && marcadas.length === 0;
                return (
                  <tr key={f.id}>
                    <th
                      scope="row"
                      className={`sticky left-0 z-[1] w-[36%] min-w-[96px] max-w-[170px] py-2.5 pl-3 pr-2 text-left align-middle text-[14px] font-medium leading-snug ${fondo} ${desliza.hay ? 'shadow-[1px_0_0_#E4E4E7]' : ''}`}
                      style={{ color: falta ? ERROR : TINTA }}
                    >
                      {f.label}
                    </th>
                    {pv.opciones.map((o) => {
                      const activa = marcadas.includes(o.id);
                      return (
                        <td key={o.id} className={`p-0 text-center align-middle ${fondo}`}>
                          <button
                            type="button"
                            role={varias ? 'checkbox' : 'radio'}
                            aria-checked={activa}
                            aria-label={`${f.label}: ${o.label}`}
                            onClick={() => onChange(pv.clave, { ...filas, [f.id]: varias ? alternar(pv.opciones, marcadas, o) : o.id })}
                            className="flex h-12 w-full items-center justify-center"
                          >
                            {varias ? (
                              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[6px] border-[1.5px] transition-colors ${activa ? 'border-[#1F1F23] bg-[#1F1F23]' : 'border-[#A1A1AA] bg-white'}`}>
                                {activa && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                              </span>
                            ) : (
                              <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] transition-colors ${activa ? 'border-[#1F1F23]' : 'border-[#A1A1AA] bg-white'}`}>
                                {activa && <span className="h-3 w-3 rounded-full bg-[#1F1F23]" />}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Sombra a la derecha mientras queda tabla por ver. */}
        {desliza.hay && !desliza.alFinal && <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />}
      </div>
    </div>
  );
}
