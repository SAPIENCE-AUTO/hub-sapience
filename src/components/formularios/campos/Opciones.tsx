import { useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { seleccion, porOrdenar } from '@/lib/formularios/motor';
import { forma, type Opcion } from '@/lib/formularios/tipos';
import { alternar, inputClass, type CampoProps } from './estilo';

/** Opciones de una o de varias: el tipo de la pregunta lo dice (tipos.ts → TIPOS). */
const esVarias = (pv: CampoProps['pv']) => forma(pv.pregunta.tipo) === 'varias';

function Otra({ pv, resp, onChange }: CampoProps) {
  const marcadas = seleccion(resp[pv.clave]);
  if (!pv.opciones.some((o) => o.otra && marcadas.includes(o.id))) return null;
  const clave = `${pv.clave}#otra`;
  return (
    <input
      className={`${inputClass} mt-2`}
      placeholder="¿Cuál?"
      value={typeof resp[clave] === 'string' ? (resp[clave] as string) : ''}
      onChange={(e) => onChange(clave, e.target.value)}
    />
  );
}

function eleccionDe({ pv, resp, onChange }: CampoProps) {
  const marcadas = seleccion(resp[pv.clave]);
  const elegir = (o: Opcion) => {
    if (!esVarias(pv)) return onChange(pv.clave, o.id);
    onChange(pv.clave, alternar(pv.opciones, marcadas, o));
  };
  return { marcadas, elegir };
}

function Marca({ activa, redonda }: { activa: boolean; redonda: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center border-[1.5px] ${redonda ? 'rounded-full' : 'rounded-[5px]'} ${
        activa ? 'border-[#1F1F23] bg-[#1F1F23] text-white' : 'border-[#A1A1AA] bg-white'
      }`}
    >
      {activa && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

/** Opción única y múltiple en botones. */
export function Botones(props: CampoProps) {
  const { pv } = props;
  const { marcadas, elegir } = eleccionDe(props);
  return (
    <div className="space-y-2">
      {pv.opciones.map((o) => {
        const activa = marcadas.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => elegir(o)}
            className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left text-[15px] text-[#1F1F23] transition-colors ${
              activa ? 'border-[#1F1F23] bg-[#1F1F23]/[0.05] font-medium' : 'border-[#D9D9DE] bg-white'
            }`}
          >
            <Marca activa={activa} redonda={!esVarias(pv)} />
            {o.label}
          </button>
        );
      })}
      <Otra {...props} />
    </div>
  );
}

/** Selector con imágenes, de una o de varias. Una opción sin imagen («Ninguno») va como tarjeta de texto. */
export function Imagenes(props: CampoProps) {
  const { pv } = props;
  const { marcadas, elegir } = eleccionDe(props);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {pv.opciones.map((o) => {
          const activa = marcadas.includes(o.id);
          const borde = activa ? 'border-[#1F1F23] ring-1 ring-[#1F1F23]' : 'border-[#D9D9DE]';
          if (!o.imagen) {
            return (
              <button key={o.id} type="button" onClick={() => elegir(o)} className={`col-span-2 flex items-center gap-3 rounded-xl border-[1.5px] bg-white px-4 py-3 text-left text-[15px] text-[#1F1F23] ${borde} ${activa ? 'font-medium' : ''}`}>
                <Marca activa={activa} redonda={!esVarias(pv)} />
                {o.label}
              </button>
            );
          }
          return (
            <button key={o.id} type="button" aria-label={o.label} aria-pressed={activa} onClick={() => elegir(o)} className={`relative flex flex-col overflow-hidden rounded-xl border-[1.5px] bg-white text-left transition-colors ${borde}`}>
              <img src={o.imagen} alt="" className="aspect-square w-full bg-[#F4F4F5] object-cover" />
              <span className={`px-3 py-2.5 text-[14px] leading-snug text-[#1F1F23] ${activa ? 'font-semibold' : ''}`}>{o.label}</span>
              <span className="absolute right-2 top-2"><Marca activa={activa} redonda={!esVarias(pv)} /></span>
            </button>
          );
        })}
      </div>
      <Otra {...props} />
    </div>
  );
}

/** Lista desplegable: una opción de una lista larga, con el selector del celular. */
export function ListaUna(props: CampoProps) {
  const { pv, resp, onChange } = props;
  const valor = resp[pv.clave];
  return (
    <div>
      <div className="relative">
        <select
          className={`${inputClass} appearance-none pr-10 ${typeof valor === 'string' ? '' : 'text-[#8E8E96]'}`}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(pv.clave, e.target.value || undefined)}
        >
          <option value="" disabled>Elige una opción</option>
          {pv.opciones.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#62626B]" />
      </div>
      <Otra {...props} />
    </div>
  );
}

/** Selección múltiple en lista: buscador y casillas en una caja que se desplaza, con lo elegido arriba. */
export function ListaVarias(props: CampoProps) {
  const { pv } = props;
  const { marcadas, elegir } = eleccionDe(props);
  const [busqueda, setBusqueda] = useState('');
  const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const visibles = busqueda ? pv.opciones.filter((o) => normal(o.label).includes(normal(busqueda))) : pv.opciones;
  const elegidas = pv.opciones.filter((o) => marcadas.includes(o.id));

  return (
    <div className="space-y-2">
      {elegidas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {elegidas.map((o) => (
            <button key={o.id} type="button" onClick={() => elegir(o)} className="flex items-center gap-1 rounded-full bg-[#1F1F23] px-3 py-1 text-[13px] text-white">
              {o.label}<X className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border-[1.5px] border-[#D9D9DE] bg-white">
        {pv.opciones.length > 8 && (
          <div className="flex items-center gap-2 border-b border-[#E4E4E7] px-3">
            <Search className="h-4 w-4 flex-shrink-0 text-[#8E8E96]" />
            <input className="w-full py-3 text-[16px] text-[#1F1F23] outline-none" placeholder="Buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto">
          {visibles.map((o) => (
            <button key={o.id} type="button" onClick={() => elegir(o)} className="flex w-full items-center gap-3 border-b border-[#F0F0F2] px-4 py-3 text-left text-[15px] text-[#1F1F23] last:border-b-0">
              <Marca activa={marcadas.includes(o.id)} redonda={false} />
              {o.label}
            </button>
          ))}
          {visibles.length === 0 && <p className="px-4 py-3 text-[14px] text-[#8E8E96]">No hay opciones con «{busqueda}»</p>}
        </div>
      </div>
      <Otra {...props} />
    </div>
  );
}

/**
 * Ordenar: se tocan las opciones en orden de preferencia y cada una muestra su
 * lugar. Tocar una ya ordenada la quita. Nada se mueve bajo el dedo.
 */
export function Ordenar({ pv, resp, onChange }: CampoProps) {
  const orden = seleccion(resp[pv.clave]);
  const total = porOrdenar(pv);
  const tocar = (o: Opcion) => {
    if (orden.includes(o.id)) return onChange(pv.clave, orden.filter((x) => x !== o.id));
    if (orden.length < total) onChange(pv.clave, [...orden, o.id]);
  };
  return (
    <div className="space-y-2">
      {pv.opciones.map((o) => {
        const lugar = orden.indexOf(o.id) + 1;
        const bloqueada = !lugar && orden.length >= total;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => tocar(o)}
            className={`flex w-full items-center gap-3 rounded-xl border-[1.5px] px-4 py-3 text-left text-[15px] text-[#1F1F23] transition-colors ${
              lugar ? 'border-[#1F1F23] bg-[#1F1F23]/[0.05] font-medium' : 'border-[#D9D9DE] bg-white'
            } ${bloqueada ? 'opacity-50' : ''}`}
          >
            <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${lugar ? 'bg-[#1F1F23] text-white' : 'border-[1.5px] border-dashed border-[#A1A1AA] text-[#A1A1AA]'}`}>
              {lugar || ''}
            </span>
            {o.label}
          </button>
        );
      })}
      {orden.length > 0 && (
        <button type="button" onClick={() => onChange(pv.clave, undefined)} className="text-[13px] font-medium text-[#62626B] underline underline-offset-2">
          Volver a empezar
        </button>
      )}
    </div>
  );
}
