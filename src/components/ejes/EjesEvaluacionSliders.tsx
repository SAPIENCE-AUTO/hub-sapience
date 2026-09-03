import { useEffect, useRef, useState } from 'react';

export interface EjesIdea {
  id: string;
  titulo: string;
  descripcion?: string;
  imagenUrl?: string;
}

interface EjesEvaluacionSlidersProps {
  idea: EjesIdea;
  progresoActual: number;
  progresoTotal: number;
  ejeXLabel: string;
  ejeXMin: number;
  ejeXMax: number;
  ejeYLabel: string;
  ejeYMin: number;
  ejeYMax: number;
  cuadranteAltoAltoLabel?: string;
  cuadranteBajoAltoLabel?: string;
  cuadranteBajoBajoLabel?: string;
  cuadranteAltoBajoLabel?: string;
  onConfirmar: (valorX: number, valorY: number, msDecision: number) => void;
}

/**
 * Una idea a la vez — el facilitador activa las ideas 1 a 1 (ver
 * setEjesIdeaEstado.ts), así que este componente ya no recibe el arreglo
 * completo ni maneja su propio índice/"siguiente": solo evalúa la idea que
 * le pasa el padre y llama `onConfirmar`; es `EjesPage.tsx` quien decide
 * cuándo mostrar la siguiente (cuando el facilitador la active). Decisión
 * ya confirmada con el usuario: 2 sliders, no un mapa tocable. El cuadrado
 * de preview de abajo es puramente visual (no interactivo).
 */
export default function EjesEvaluacionSliders({
  idea, progresoActual, progresoTotal, ejeXLabel, ejeXMin, ejeXMax, ejeYLabel, ejeYMin, ejeYMax,
  cuadranteAltoAltoLabel, cuadranteBajoAltoLabel, cuadranteBajoBajoLabel, cuadranteAltoBajoLabel,
  onConfirmar,
}: EjesEvaluacionSlidersProps) {
  const midX = (ejeXMin + ejeXMax) / 2;
  const midY = (ejeYMin + ejeYMax) / 2;
  const [valorX, setValorX] = useState(midX);
  const [valorY, setValorY] = useState(midY);
  const shownAtRef = useRef(Date.now());

  useEffect(() => {
    setValorX(midX);
    setValorY(midY);
    shownAtRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea.id]);

  const handleConfirmar = () => {
    onConfirmar(valorX, valorY, Date.now() - shownAtRef.current);
  };

  // Posición del punto en el cuadrado de preview (0% = abajo-izquierda, 100% = arriba-derecha)
  const pctX = ((valorX - ejeXMin) / (ejeXMax - ejeXMin || 1)) * 100;
  const pctY = 100 - ((valorY - ejeYMin) / (ejeYMax - ejeYMin || 1)) * 100;

  return (
    <div className="flex h-full flex-col overscroll-none px-5 pb-6 pt-3">
      <div className="flex-shrink-0">
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-[#3FA9C4] transition-[width]"
            style={{ width: `${(progresoActual / Math.max(1, progresoTotal)) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
          Idea {progresoActual} / {progresoTotal}
        </p>
      </div>

      <div className="mt-4 flex-shrink-0 overflow-hidden rounded-[20px] bg-white shadow-lg">
        {idea.imagenUrl ? (
          <div className="relative flex h-32 w-full items-center justify-center overflow-hidden bg-[#eef1f2]">
            <img src={idea.imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" draggable={false} />
            <img src={idea.imagenUrl} alt={idea.titulo} className="relative max-h-full max-w-full object-contain p-2" draggable={false} />
          </div>
        ) : null}
        <div className="px-4 py-3">
          <h2 className="text-[19px] font-bold leading-tight text-[#0F3D4D]">{idea.titulo}</h2>
          {idea.descripcion && <p className="mt-1 text-[13.5px] text-[#6b7280]">{idea.descripcion}</p>}
        </div>
      </div>

      <div className="mt-5 flex-shrink-0 space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-white">
            <span>{ejeXLabel}</span>
            <span className="text-[#3FA9C4]">{Math.round(valorX)}</span>
          </div>
          <input
            type="range" min={ejeXMin} max={ejeXMax} value={valorX}
            onChange={(e) => setValorX(Number(e.target.value))}
            className="w-full accent-[#3FA9C4]"
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-white">
            <span>{ejeYLabel}</span>
            <span className="text-[#D4A017]">{Math.round(valorY)}</span>
          </div>
          <input
            type="range" min={ejeYMin} max={ejeYMax} value={valorY}
            onChange={(e) => setValorY(Number(e.target.value))}
            className="w-full accent-[#D4A017]"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-1 items-center justify-center">
        <div className="relative aspect-square w-full max-w-[220px] rounded-xl bg-white/5">
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/15" />
          {cuadranteBajoAltoLabel && <span className="absolute left-1.5 top-1.5 text-[9px] font-medium text-white/35">{cuadranteBajoAltoLabel}</span>}
          {cuadranteAltoAltoLabel && <span className="absolute right-1.5 top-1.5 text-right text-[9px] font-medium text-white/35">{cuadranteAltoAltoLabel}</span>}
          {cuadranteBajoBajoLabel && <span className="absolute bottom-1.5 left-1.5 text-[9px] font-medium text-white/35">{cuadranteBajoBajoLabel}</span>}
          {cuadranteAltoBajoLabel && <span className="absolute bottom-1.5 right-1.5 text-right text-[9px] font-medium text-white/35">{cuadranteAltoBajoLabel}</span>}
          <div
            className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${pctX}%`, top: `${pctY}%`, backgroundColor: '#027495' }}
          />
        </div>
      </div>

      <button
        onClick={handleConfirmar}
        className="mt-5 flex-shrink-0 rounded-full bg-[#027495] py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#025F7A]"
      >
        Confirmar
      </button>
    </div>
  );
}
