import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { EXITO, GRIS, TEAL } from '@/lib/toolColors';
import type { Generador } from '@/lib/formularios/generador';

/**
 * El camino de un filtro en un solo indicador: de los insumos a reclutar
 * (pedido de Sergio, 2026-10-24, en vez de «Borrador › Prueba › En vivo» y
 * «Insumos › Estructura › Preguntas» por separado). Los filtros que no salen
 * de la IA empiezan en Preguntas.
 */
export type PasoFiltro = 'insumos' | 'estructura' | 'preguntas' | 'probar' | 'reclutar';

export const NOMBRE_PASO: Record<PasoFiltro, string> = {
  insumos: 'Insumos', estructura: 'Estructura', preguntas: 'Preguntas', probar: 'Probar', reclutar: 'Reclutar',
};

export const pasosDe = (conIA: boolean): PasoFiltro[] =>
  (conIA ? ['insumos', 'estructura', 'preguntas', 'probar', 'reclutar'] : ['preguntas', 'probar', 'reclutar']);

/** En qué paso va: lo dice el estado y, antes de probar, la etapa del generador. */
export function pasoActual(estado: string, etapa?: Generador['etapa']): PasoFiltro {
  if (estado === 'en_vivo' || estado === 'cerrado') return 'reclutar';
  if (estado === 'prueba') return 'probar';
  if (etapa === 'insumos') return 'insumos';
  if (etapa === 'estructura') return 'estructura';
  return 'preguntas';
}

export function Recorrido({ pasos, actual, puedeIr, onIr }: {
  pasos: PasoFiltro[];
  actual: PasoFiltro;
  /** A qué pasos se puede ir con un clic (los hechos y el actual, salvo lo que no se puede reabrir). */
  puedeIr: (p: PasoFiltro) => boolean;
  onIr: (p: PasoFiltro) => void;
}) {
  const i = pasos.indexOf(actual);
  return (
    <ol className="flex items-center gap-2 overflow-x-auto text-[12.5px]" aria-label="Pasos del filtro">
      {pasos.map((p, j) => {
        const hecho = j < i;
        const aqui = j === i;
        const clic = puedeIr(p);
        return (
          <Fragment key={p}>
            {j > 0 && <li aria-hidden className="h-px min-w-4 flex-1" style={{ backgroundColor: j <= i ? EXITO : '#D9D9DE' }} />}
            <li>
              <button
                type="button"
                disabled={!clic}
                onClick={() => onIr(p)}
                aria-current={aqui ? 'step' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pr-1 ${clic ? 'hover:underline' : 'cursor-default'} ${aqui ? 'font-semibold' : ''}`}
                style={{ color: hecho ? EXITO : aqui ? TEAL : GRIS }}
              >
                <span
                  className="flex h-[19px] w-[19px] flex-shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold"
                  style={hecho ? { backgroundColor: EXITO, color: '#fff' } : aqui ? { backgroundColor: TEAL, color: '#fff' } : { border: '1px solid #C9CDD3' }}
                >
                  {hecho ? <Check className="h-3 w-3" strokeWidth={3} /> : j + 1}
                </span>
                {NOMBRE_PASO[p]}
              </button>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
