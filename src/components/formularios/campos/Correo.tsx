import { sugerirCorreo } from '@/lib/formularios/correo';
import { inputClass, type CampoProps } from './estilo';

/** Correo con la sugerencia si el dominio parece mal escrito («¿Quisiste decir ana@gmail.com?»). */
export function Correo({ pv, resp, onChange }: CampoProps) {
  const valor = typeof resp[pv.clave] === 'string' ? (resp[pv.clave] as string) : '';
  const sugerencia = sugerirCorreo(valor);
  return (
    <div className="space-y-1.5">
      <input
        className={inputClass}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        value={valor}
        onChange={(e) => onChange(pv.clave, e.target.value.trim() ? e.target.value : undefined)}
      />
      {sugerencia && (
        <button type="button" onClick={() => onChange(pv.clave, sugerencia)} className="text-left text-[13px] text-[#62626B]">
          ¿Quisiste decir <span className="font-semibold text-[#1F1F23] underline underline-offset-2">{sugerencia}</span>?
        </button>
      )}
    </div>
  );
}
