import { seleccion } from '@/lib/formularios/motor';
import { forma } from '@/lib/formularios/tipos';
import { alternar, type CampoProps } from './estilo';

/** Matriz: una tarjeta por fila. De una respuesta por fila o de varias, según el tipo. */
export function Matriz({ pv, resp, onChange }: CampoProps) {
  const varias = forma(pv.pregunta.tipo) === 'matriz_varias';
  const filas = (resp[pv.clave] as Record<string, string | string[]> | undefined) ?? {};
  return (
    <div className="space-y-3">
      {(pv.pregunta.filas ?? []).map((f) => {
        const marcadas = seleccion(filas[f.id]);
        return (
          <div key={f.id} className="rounded-xl border border-[#D9D9DE] bg-white p-3">
            <p className="mb-2 text-[14px] font-medium text-[#1F1F23]">{f.label}</p>
            <div className="flex flex-wrap gap-2">
              {pv.opciones.map((o) => {
                const activa = marcadas.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onChange(pv.clave, { ...filas, [f.id]: varias ? alternar(pv.opciones, marcadas, o) : o.id })}
                    className={`rounded-full border-[1.5px] px-3 py-1.5 text-[13px] transition-colors ${
                      activa ? 'border-[#1F1F23] bg-[#1F1F23] text-white' : 'border-[#D9D9DE] text-[#1F1F23]'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
