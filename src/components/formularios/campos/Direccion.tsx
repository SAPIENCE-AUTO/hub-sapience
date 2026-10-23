import { ChevronDown } from 'lucide-react';
import { PAISES, nombreCampoDireccion } from '@/lib/formularios/paises';
import type { CampoDireccion } from '@/lib/formularios/tipos';
import { etiquetaClass, inputClass, type CampoProps } from './estilo';

const AUTOCOMPLETAR: Record<CampoDireccion, string> = {
  calle: 'address-line1', numero: 'address-line2', colonia: 'address-level3', ciudad: 'address-level2', estado: 'address-level1', cp: 'postal-code',
};

/** Dirección por campos (calle, número, colonia, ciudad, estado y código postal), con los nombres y estados del país. */
export function Direccion({ pv, resp, onChange, pais }: CampoProps & { pais?: string }) {
  const d = (resp[pv.clave] as Record<string, string> | undefined) ?? {};
  const estados = pais ? PAISES[pais]?.estados : undefined;
  const poner = (campo: CampoDireccion, texto: string) => onChange(pv.clave, { ...d, [campo]: texto });

  const campo = (c: CampoDireccion, extra?: { numerico?: boolean }) => (
    <label className="block">
      <span className={etiquetaClass}>{nombreCampoDireccion(pais, c)}</span>
      <input
        className={inputClass}
        value={d[c] ?? ''}
        autoComplete={AUTOCOMPLETAR[c]}
        inputMode={extra?.numerico ? 'numeric' : undefined}
        onChange={(e) => poner(c, e.target.value)}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      {campo('calle')}
      <div className="grid grid-cols-2 gap-3">
        {campo('numero')}
        {campo('cp', { numerico: true })}
      </div>
      {campo('colonia')}
      {campo('ciudad')}
      {estados ? (
        <label className="block">
          <span className={etiquetaClass}>{nombreCampoDireccion(pais, 'estado')}</span>
          <div className="relative">
            <select
              className={`${inputClass} appearance-none pr-10 ${d.estado ? '' : 'text-[#8E8E96]'}`}
              value={d.estado ?? ''}
              autoComplete={AUTOCOMPLETAR.estado}
              onChange={(e) => poner('estado', e.target.value)}
            >
              <option value="" disabled>Elige</option>
              {estados.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#62626B]" />
          </div>
        </label>
      ) : campo('estado')}
    </div>
  );
}
