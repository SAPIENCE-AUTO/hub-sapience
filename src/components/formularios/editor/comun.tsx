import { createContext, useContext, useRef, type ReactNode } from 'react';
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
  /** Dónde está el cursor: ahí cae una imagen pegada. */
  apuntar: (destino: Destino | null) => void;
  /** Id de lo recién agregado: su texto se abre en edición. */
  nuevo: string | null;
  setNuevo: (id: string | null) => void;
  /** Pide confirmación antes de quitar algo que se usa en otra parte. */
  quitar: (q: Quitar) => void;
  /** Fase 3: pedir cambios a la IA (botón IA en cada pregunta, Comentar en cada sección). */
  ia?: { formularioId: string; contarUso: () => void };
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

/** Pill sólido chico con puntito blanco (moodboard del Hub). */
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
