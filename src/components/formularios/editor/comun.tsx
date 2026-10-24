import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { ALERTA, EXITO, INFO, NEUTRAL, PELIGRO, TEAL } from '@/lib/toolColors';
import type { LineaLogica } from '@/lib/formularios/palabras';
import type { Definicion } from '@/lib/formularios/tipos';
import type { Editor } from './useEditorFiltro';
import { TextoEditable } from './TextoEditable';

/** A dónde va una imagen que se arrastra o se pega: una opción o la pregunta (arriba de ella, o el contenido). */
export type Destino = { tipo: 'opcion'; pregunta: string; opcion: string } | { tipo: 'pregunta'; pregunta: string };
export const claveDestino = (d: Destino) => (d.tipo === 'opcion' ? `o:${d.pregunta}:${d.opcion}` : `p:${d.pregunta}`);

/** `confirmar`: pedir confirmación aunque no se use en otra parte (una sección se lleva todas sus preguntas). */
export interface Quitar { que: string; usos: string[]; hacer: () => void; confirmar?: boolean }

export interface ContextoDoc {
  def: Definicion;
  aplicar: Editor['aplicar'];
  /** Destinos con una imagen subiéndose. */
  subiendo: Set<string>;
  ponerImagen: (destino: Destino, archivo: File) => void;
  /** La imagen de un enlace de internet: el Hub la descarga y guarda su copia, como si se hubiera subido. */
  ponerImagenDeEnlace: (destino: Destino, url: string) => void;
  /** Dónde está el cursor: ahí cae una imagen pegada. */
  apuntar: (destino: Destino | null) => void;
  /** Id de lo recién agregado: su texto se abre en edición. */
  nuevo: string | null;
  setNuevo: (id: string | null) => void;
  /** Pide confirmación antes de quitar algo que se usa en otra parte. */
  quitar: (q: Quitar) => void;
  /** Fase 3: pedir cambios a la IA (botón IA en cada pregunta, Comentar en cada sección). */
  ia?: { formularioId: string; contarUso: () => void };
  /** La pregunta elegida: solo ella muestra sus herramientas (IA, menú, agregar y mover opciones). */
  elegida: string | null;
  elegir: (id: string | null) => void;
  /** Número de cada pregunta (las de contenido no cuentan), como en el Word. */
  numeros: Record<string, number>;
}

export const Contexto = createContext<ContextoDoc | null>(null);
export const useDoc = () => {
  const c = useContext(Contexto);
  if (!c) throw new Error('useDoc fuera del editor');
  return c;
};

export const COLOR_LOGICA: Record<LineaLogica['tipo'], string> = {
  aparece: TEAL, termina: PELIGRO, descarta: ALERTA, excluye: INFO, opciones: TEAL, nse: NEUTRAL, otro: NEUTRAL,
};

/** Líneas de lógica en palabras bajo una pregunta, opción o sección. El motivo de un descarte se corrige ahí mismo. */
export function Logica({ lineas, onMotivo, className = '' }: {
  lineas: LineaLogica[];
  onMotivo?: (campo: NonNullable<LineaLogica['campo']>, motivo: string) => void;
  className?: string;
}) {
  if (lineas.length === 0) return null;
  return (
    <div className={`space-y-0.5 ${className}`}>
      {lineas.map((l, i) => (
        <p key={i} className="flex gap-1.5 text-[12.5px] leading-snug" style={{ color: COLOR_LOGICA[l.tipo] }}>
          <span aria-hidden className="select-none">↳</span>
          <span className="min-w-0">
            {l.campo && l.prefijo && onMotivo ? (
              <>
                {l.prefijo}
                <TextoEditable valor={l.motivo ?? ''} linea obligatorio etiqueta="Motivo" onGuardar={(v) => onMotivo(l.campo!, v)} />
                {/[.!?…]$/.test(l.motivo ?? '') ? '' : '.'}
              </>
            ) : l.texto}
          </span>
        </p>
      ))}
    </div>
  );
}

const ETIQUETA: Partial<Record<LineaLogica['tipo'], string>> = { termina: 'No califica', descarta: 'No cuenta', excluye: 'Fuera de perfil' };

/** La lógica de una opción en etiquetas chicas (el detalle, al pasar el mouse); la línea completa sale al elegir la pregunta. */
export function EtiquetasLogica({ lineas }: { lineas: LineaLogica[] }) {
  const etiquetas = lineas.map((l) => ({
    l,
    texto: l.tipo === 'termina' && l.corta ? 'No califica · corta'
      : ETIQUETA[l.tipo] ?? (/se quitan las demás/.test(l.texto) ? 'Exclusiva' : /escribir cuál/.test(l.texto) ? 'Pide cuál' : undefined),
  })).filter((x): x is { l: LineaLogica; texto: string } => !!x.texto);
  if (!etiquetas.length) return null;
  return (
    <span className="ml-auto flex flex-shrink-0 flex-wrap justify-end gap-1 pl-2">
      {etiquetas.map(({ l, texto }, i) => (
        <span key={i} title={l.texto} className="whitespace-nowrap rounded-full border px-1.5 py-px text-[10.5px] font-medium" style={{ color: COLOR_LOGICA[l.tipo], borderColor: `${COLOR_LOGICA[l.tipo]}55`, backgroundColor: `${COLOR_LOGICA[l.tipo]}0d` }}>
          {texto}
        </span>
      ))}
    </span>
  );
}

/** Pill sólido chico con puntito blanco (moodboard del Hub). */
/** «Sección» de los perfiles en el documento, para llegar a ella desde el flujo (ningún id de sección lleva «:»). */
export const SECCION_PERFILES = ':perfiles';

export function Pill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: color }}>
      <span className="h-1 w-1 rounded-full bg-white/85" />
      {children}
    </span>
  );
}

export const COLOR_FRENTE = EXITO;

/** Botón de icono chico para las herramientas de una pregunta u opción. */
export function BotonIcono({ titulo, onClick, disabled, children, peligro }: {
  titulo: string; onClick: () => void; disabled?: boolean; children: ReactNode; peligro?: boolean;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30 ${peligro ? 'hover:text-[#D32222]' : 'hover:text-[#0F3D4D]'}`}
    >
      {children}
    </button>
  );
}

/**
 * Lo que un menú abre (un cuadro de texto, un ajuste) se hace cuando el menú
 * ya se cerró: mientras se cierra, el menú se queda con el foco y cerraría el
 * cuadro recién abierto. `despues(fn)` va en el onSelect del item y
 * `alCerrar` en el onCloseAutoFocus del contenido del menú.
 */
export function useAlCerrarMenu() {
  const pendiente = useRef<(() => void) | null>(null);
  return {
    despues: (fn: () => void) => { pendiente.current = fn; },
    alCerrar: (e: Event) => {
      e.preventDefault();
      const fn = pendiente.current;
      pendiente.current = null;
      fn?.();
    },
  };
}

/** Cuadro para pegar el enlace de una imagen (.jpg, .png…) y ponerla. */
export function EnlaceImagen({ onPoner, onCerrar }: { onPoner: (url: string) => void; onCerrar: () => void }) {
  const [url, setUrl] = useState('');
  const poner = () => { if (url.trim()) { onPoner(url.trim()); onCerrar(); } };
  return (
    <div className="mt-1.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        aria-label="Enlace de la imagen"
        placeholder="https://… (JPG, PNG, WebP o GIF)"
        className="h-8 min-w-0 flex-1 rounded-md border border-[#0F3D4D]/30 bg-white px-2 text-[13px] outline-none focus:border-[#0F3D4D]"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') poner(); if (e.key === 'Escape') onCerrar(); }}
      />
      <button type="button" disabled={!url.trim()} onClick={poner} className="h-8 rounded-md bg-[#0F3D4D] px-3 text-[12.5px] font-medium text-white disabled:opacity-40">Poner</button>
      <button type="button" onClick={onCerrar} className="h-8 px-1 text-[12.5px] text-muted-foreground hover:text-[#0F3D4D]">Cancelar</button>
    </div>
  );
}
