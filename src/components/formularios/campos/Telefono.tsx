import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { LADAS, agruparTelefono, guardarTelefono, leerTelefono, limpiarTelefono, telefonoDe, type Telefono as Lada } from '@/lib/formularios/paises';
import { inputClass, type CampoProps } from './estilo';

/**
 * Celular con su lada a la vista (🇲🇽 +52) y el número en grupos mientras se
 * escribe («55 1234 5678»). La lada es la del país del filtro, pero la persona
 * puede elegir otra (pedido de Sergio, 2026-10-26). Con la del filtro se
 * guardan solo los dígitos, como siempre; con otra, «+57 3123456789». Si lo
 * pegan con la lada, se quita.
 */
export function Telefono({ pv, resp, onChange, pais }: CampoProps & { pais?: string }) {
  const guardado = leerTelefono(String(resp[pv.clave] ?? ''), pais);
  // La lada elegida antes de escribir el número (todavía no hay nada que guardar).
  const [elegida, setElegida] = useState<Lada | null>(null);
  const t = resp[pv.clave] ? guardado.t : (elegida ?? telefonoDe(pais));
  const digitos = resp[pv.clave] ? guardado.digitos : '';

  const cambiarLada = (lada: string) => {
    const nueva = LADAS.find((l) => l.telefono.lada === lada)?.telefono;
    if (!nueva) return;
    setElegida(nueva);
    if (digitos) onChange(pv.clave, guardarTelefono(limpiarTelefono(digitos, nueva), nueva, pais));
  };

  return (
    <div className="flex gap-2">
      <label className="relative flex flex-shrink-0 items-center gap-1 rounded-xl border-[1.5px] border-[#D9D9DE] bg-[#F4F4F5] px-3 text-[16px] text-[#1F1F23]">
        <span aria-hidden>{t.bandera}</span>{t.lada || 'Lada'}
        <ChevronDown className="h-4 w-4 text-[#71717A]" aria-hidden />
        <select
          aria-label="Lada del país"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={t.lada}
          onChange={(e) => cambiarLada(e.target.value)}
        >
          {!t.lada && <option value="">Lada</option>}
          {LADAS.map((l) => <option key={l.pais} value={l.telefono.lada}>{l.telefono.bandera} {l.nombre} {l.telefono.lada}</option>)}
        </select>
      </label>
      <input
        className={`${inputClass} tabular-nums`}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        aria-label={t.lada ? `Celular, sin el ${t.lada}` : 'Celular'}
        placeholder={t.ejemplo || undefined}
        value={agruparTelefono(digitos, t)}
        onChange={(e) => onChange(pv.clave, guardarTelefono(limpiarTelefono(e.target.value, t), t, pais))}
      />
    </div>
  );
}
