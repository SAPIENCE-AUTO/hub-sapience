import { useEffect } from 'react';
import { Check } from 'lucide-react';
import { porOrdenar, type PreguntaVisible } from '@/lib/formularios/motor';
import { forma, type FotoSubida, type Respuestas, type Valor, maxFotosDe } from '@/lib/formularios/tipos';
import { ERROR, inputClass, type CampoProps } from './campos/estilo';
import { Botones, Imagenes, ListaUna, ListaVarias, Ordenar } from './campos/Opciones';
import { Matriz } from './campos/Matriz';
import { Deslizador, Escala, Estrellas } from './campos/Escalas';
import { Direccion } from './campos/Direccion';
import { Telefono } from './campos/Telefono';
import { Correo } from './campos/Correo';
import { Foto } from './campos/Foto';
import { EnlaceAviso } from './AvisoPrivacidad';
import { TextoConFormato } from './TextoConFormato';

interface Props {
  pv: PreguntaVisible;
  resp: Respuestas;
  error?: string;
  codigo: string;
  pais?: string;
  /** Vista Celular del editor: las fotos se ven pero no se suben. */
  simular?: boolean;
  onChange: (clave: string, valor: Valor | undefined) => void;
}

/** Lo que se lee bajo la pregunta cuando ayuda a contestarla («Puedes marcar varias»). */
function indicacion(pv: PreguntaVisible): string | undefined {
  const p = pv.pregunta;
  if (forma(p.tipo) === 'varias') return p.maxOpciones ? `Marca hasta ${p.maxOpciones}` : 'Puedes marcar varias';
  // Si la ayuda ya lo dice («Puedes marcar varios lugares»), no se repite.
  if (forma(p.tipo) === 'matriz_varias') return /vari[oa]s/i.test(pv.ayuda ?? '') ? undefined : 'Puedes marcar varias en cada renglón';
  if (p.tipo === 'foto') { const n = maxFotosDe(p); return n > 1 ? `Puedes subir hasta ${n} fotos` : undefined; }
  if (p.tipo === 'ordenar') {
    const n = porOrdenar(pv);
    return n === pv.opciones.length ? 'Toca las opciones en orden, empezando por la que más' : `Toca tus ${n} primeras en orden, empezando por la que más`;
  }
  return undefined;
}

/** Una pregunta de la página pública /f/:codigo, pensada para el celular. */
export function CampoPregunta({ pv, resp, error, codigo, pais, simular, onChange }: Props) {
  const { pregunta: p, clave } = pv;
  const valor = resp[clave];
  const campo: CampoProps = { pv, resp, onChange };

  // Pantalla de texto o imagen: no se contesta.
  if (p.tipo === 'contenido') {
    return (
      <div className="space-y-3">
        {p.imagen && <img src={p.imagen} alt="" className="w-full rounded-xl border border-[#E4E4E7] bg-white" />}
        {pv.texto && <p className="whitespace-pre-line text-[16px] leading-relaxed text-[#1F1F23]"><TextoConFormato texto={pv.texto} /></p>}
        {pv.ayuda && <p className="text-[13px] text-[#62626B]"><TextoConFormato texto={pv.ayuda} /></p>}
      </div>
    );
  }

  if (p.tipo === 'casilla' || p.tipo === 'interruptor') {
    return (
      <div className="space-y-2">
        {p.imagen && <img src={p.imagen} alt="" className="w-full rounded-xl border border-[#E4E4E7]" />}
        {p.tipo === 'casilla'
          ? <Casilla texto={pv.texto} ayuda={pv.ayuda} activa={valor === 'si'} onChange={(si) => onChange(clave, si ? 'si' : undefined)} />
          : <Interruptor texto={pv.texto} ayuda={pv.ayuda} valor={valor} onChange={(v) => onChange(clave, v)} />}
        {error && <p className="text-[13px] font-medium" style={{ color: ERROR }}>{error}</p>}
      </div>
    );
  }

  const nota = indicacion(pv);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[16px] font-semibold leading-snug text-[#1F1F23]"><TextoConFormato texto={pv.texto} enNegrita /></p>
        {pv.ayuda && <p className="mt-1 text-[13px] text-[#62626B]"><TextoConFormato texto={pv.ayuda} /></p>}
        {p.enlaceAviso && <EnlaceAviso className="mt-2" />}
        {nota && <p className="mt-1 text-[12px] text-[#62626B]">{nota}</p>}
      </div>
      {p.imagen && <img src={p.imagen} alt="" className="w-full rounded-xl border border-[#E4E4E7] bg-white" />}

      {p.tipo === 'texto' && (
        <input
          className={inputClass}
          inputMode={p.patron?.includes('\\d') ? 'numeric' : undefined}
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(clave, e.target.value)}
          autoComplete="off"
        />
      )}
      {p.tipo === 'telefono' && <Telefono {...campo} pais={pais} />}
      {p.tipo === 'correo' && <Correo {...campo} />}
      {p.tipo === 'texto_largo' && (
        <textarea className={`${inputClass} min-h-[96px]`} value={typeof valor === 'string' ? valor : ''} onChange={(e) => onChange(clave, e.target.value)} />
      )}
      {p.tipo === 'numero' && (
        <input
          className={`${inputClass} max-w-[140px]`}
          inputMode="numeric"
          value={typeof valor === 'number' ? String(valor) : ''}
          onChange={(e) => {
            const limpio = e.target.value.replace(/\D/g, '');
            onChange(clave, limpio === '' ? undefined : Number(limpio));
          }}
        />
      )}
      {p.tipo === 'direccion' && <Direccion {...campo} pais={pais} codigo={codigo} />}

      {(p.tipo === 'unica' || p.tipo === 'multiple') && <Botones {...campo} />}
      {(p.tipo === 'imagen_unica' || p.tipo === 'imagen_multiple') && <Imagenes {...campo} />}
      {p.tipo === 'lista' && <ListaUna {...campo} />}
      {p.tipo === 'lista_multiple' && <ListaVarias {...campo} />}
      {(p.tipo === 'matriz' || p.tipo === 'matriz_multiple') && <Matriz {...campo} faltan={!!error} />}
      {p.tipo === 'ordenar' && <Ordenar {...campo} />}

      {p.tipo === 'escala' && <Escala {...campo} />}
      {p.tipo === 'estrellas' && <Estrellas {...campo} />}
      {p.tipo === 'deslizador' && <Deslizador {...campo} />}

      {p.tipo === 'foto' && <Foto valor={(valor as FotoSubida[] | undefined) ?? []} max={maxFotosDe(p)} codigo={codigo} simular={simular} onChange={(v) => onChange(clave, v)} />}

      {error && <p className="text-[13px] font-medium" style={{ color: ERROR }}>{error}</p>}
    </div>
  );
}

/** Casilla única («Acepto el aviso de privacidad»): el texto de la pregunta va junto a la casilla. */
function Casilla({ texto, ayuda, activa, onChange }: { texto: string; ayuda?: string; activa: boolean; onChange: (si: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!activa)}
      className={`flex w-full items-start gap-3 rounded-xl border-[1.5px] px-4 py-3.5 text-left transition-colors ${activa ? 'border-[#1F1F23] bg-[#1F1F23]/[0.05]' : 'border-[#D9D9DE] bg-white'}`}
    >
      <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] border-[1.5px] ${activa ? 'border-[#1F1F23] bg-[#1F1F23] text-white' : 'border-[#A1A1AA] bg-white'}`}>
        {activa && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span>
        <span className="block text-[15px] font-medium leading-snug text-[#1F1F23]"><TextoConFormato texto={texto} /></span>
        {ayuda && <span className="mt-1 block text-[13px] text-[#62626B]"><TextoConFormato texto={ayuda} /></span>}
      </span>
    </button>
  );
}

/** Interruptor sí/no. Arranca en «No» y así se guarda si no se toca: un interruptor siempre tiene respuesta. */
function Interruptor({ texto, ayuda, valor, onChange }: { texto: string; ayuda?: string; valor: Valor | undefined; onChange: (v: 'si' | 'no') => void }) {
  const si = valor === 'si';
  useEffect(() => { if (valor === undefined) onChange('no'); }, [valor, onChange]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={si}
      onClick={() => onChange(si ? 'no' : 'si')}
      className="flex w-full items-center justify-between gap-4 rounded-xl border-[1.5px] border-[#D9D9DE] bg-white px-4 py-3.5 text-left"
    >
      <span>
        <span className="block text-[15px] font-semibold leading-snug text-[#1F1F23]"><TextoConFormato texto={texto} enNegrita /></span>
        {ayuda && <span className="mt-1 block text-[13px] text-[#62626B]"><TextoConFormato texto={ayuda} /></span>}
      </span>
      <span className="flex flex-shrink-0 items-center gap-2">
        <span className="w-5 text-right text-[13px] font-medium text-[#62626B]">{si ? 'Sí' : 'No'}</span>
        <span className={`relative h-7 w-12 rounded-full transition-colors ${si ? 'bg-[#1F1F23]' : 'bg-[#D4D4D8]'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${si ? 'left-[22px]' : 'left-0.5'}`} />
        </span>
      </span>
    </button>
  );
}
