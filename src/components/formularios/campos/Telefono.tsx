import { agruparTelefono, limpiarTelefono, telefonoDe } from '@/lib/formularios/paises';
import { inputClass, type CampoProps } from './estilo';

/**
 * Celular con la lada del país del filtro a la vista (🇲🇽 +52) y el número en
 * grupos mientras se escribe («55 1234 5678»). Se guardan solo los dígitos,
 * sin la lada; si lo pegan con ella, se quita.
 */
export function Telefono({ pv, resp, onChange, pais }: CampoProps & { pais?: string }) {
  const t = telefonoDe(pais);
  const digitos = limpiarTelefono(String(resp[pv.clave] ?? ''), t);
  return (
    <div className="flex gap-2">
      {t.lada && (
        <span className="flex flex-shrink-0 items-center gap-1.5 rounded-xl border-[1.5px] border-[#D9D9DE] bg-[#F4F4F5] px-3 text-[16px] text-[#1F1F23]">
          <span aria-hidden>{t.bandera}</span>{t.lada}
        </span>
      )}
      <input
        className={`${inputClass} tabular-nums`}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        aria-label={t.lada ? `Celular, sin el ${t.lada}` : 'Celular'}
        placeholder={t.ejemplo || undefined}
        value={agruparTelefono(digitos, t)}
        onChange={(e) => onChange(pv.clave, limpiarTelefono(e.target.value, t) || undefined)}
      />
    </div>
  );
}
