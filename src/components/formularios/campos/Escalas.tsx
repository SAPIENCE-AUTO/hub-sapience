import { Star } from 'lucide-react';
import { rango } from '@/lib/formularios/motor';
import type { CampoProps } from './estilo';

function Extremos({ pv }: Pick<CampoProps, 'pv'>) {
  const e = pv.pregunta.etiquetas;
  if (!e?.min && !e?.max) return null;
  return (
    <div className="mt-1.5 flex justify-between gap-4 text-[12px] text-[#62626B]">
      <span>{e.min}</span>
      <span className="text-right">{e.max}</span>
    </div>
  );
}

/** Escala de opinión: un botón por número, en una fila. */
export function Escala({ pv, resp, onChange }: CampoProps) {
  const { min, max } = rango(pv.pregunta);
  const valor = resp[pv.clave];
  const numeros = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div>
      <div className="flex gap-1">
        {numeros.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(pv.clave, n)}
            className={`h-11 min-w-0 flex-1 rounded-lg border-[1.5px] text-[14px] font-medium transition-colors ${
              valor === n ? 'border-[#1F1F23] bg-[#1F1F23] text-white' : 'border-[#D9D9DE] bg-white text-[#1F1F23]'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <Extremos pv={pv} />
    </div>
  );
}

export function Estrellas({ pv, resp, onChange }: CampoProps) {
  const { max } = rango(pv.pregunta);
  const valor = typeof resp[pv.clave] === 'number' ? (resp[pv.clave] as number) : 0;
  return (
    <div>
      <div className="flex gap-1.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" onClick={() => onChange(pv.clave, n)} aria-label={`${n} de ${max}`} className="p-1">
            <Star className="h-9 w-9" strokeWidth={1.5} color="#1F1F23" fill={n <= valor ? '#1F1F23' : 'transparent'} />
          </button>
        ))}
      </div>
      <p className="mt-1 text-[13px] text-[#62626B]">{valor ? `${valor} de ${max}` : 'Toca una estrella'}</p>
      <Extremos pv={pv} />
    </div>
  );
}

/**
 * Deslizador. Hasta que la persona lo toca no hay respuesta (el círculo
 * arranca en medio, apagado): así no se cuenta un valor que nadie eligió.
 */
export function Deslizador({ pv, resp, onChange }: CampoProps) {
  const { min, max, paso } = rango(pv.pregunta);
  const valor = typeof resp[pv.clave] === 'number' ? (resp[pv.clave] as number) : undefined;
  const medio = min + Math.round((max - min) / 2 / paso) * paso;
  const elegir = (texto: string) => onChange(pv.clave, Number(texto));
  return (
    <div>
      <p className="mb-2 text-[22px] font-semibold text-[#1F1F23]">{valor ?? '—'}</p>
      <input
        type="range" min={min} max={max} step={paso} value={valor ?? medio}
        onChange={(e) => elegir(e.target.value)}
        onPointerUp={(e) => elegir((e.target as HTMLInputElement).value)}
        className={`h-2 w-full cursor-pointer accent-[#1F1F23] ${valor === undefined ? 'opacity-40' : ''}`}
      />
      <div className="mt-1 flex justify-between text-[12px] text-[#62626B]">
        <span>{pv.pregunta.etiquetas?.min ?? min}</span>
        <span>{pv.pregunta.etiquetas?.max ?? max}</span>
      </div>
    </div>
  );
}
