import { useEffect, useRef, useState } from 'react';

/** Texto con **negritas** (como las guarda la guía). */
export function Rico({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((parte, i) =>
        parte.length > 4 && parte.startsWith('**') && parte.endsWith('**') ? <strong key={i}>{parte.slice(2, -2)}</strong> : <span key={i}>{parte}</span>)}
    </>
  );
}

interface Props {
  valor: string;
  /** Con el texto nuevo; vacío = quitarlo (quien lo usa decide qué quita). */
  onCambio: (valor: string) => void;
  /** Para lectores de pantalla: qué texto es. */
  etiqueta: string;
  placeholder?: string;
  className?: string;
  /** Las **negritas** se ven como negritas; solo donde el Word también las pone. */
  rico?: boolean;
  maxLength?: number;
  /** Nace abierto (un texto recién agregado): si se deja vacío, se avisa con `onCambio('')` para que se quite. */
  empezarEditando?: boolean;
  deshabilitado?: boolean;
}

/**
 * Texto que se corrige con un clic: se vuelve un cuadro de texto que crece y se guarda al salir o con Enter. Esc deshace. Es de un solo renglón: los saltos de línea
 * se vuelven espacios, porque en el Word cada texto es un párrafo.
 */
export default function TextoEditable({ valor, onCambio, etiqueta, placeholder = 'Escribe aquí', className = '', rico = true, maxLength = 2000, empezarEditando = false, deshabilitado = false }: Props) {
  const [editando, setEditando] = useState(empezarEditando);
  const [borrador, setBorrador] = useState(valor);
  const ref = useRef<HTMLTextAreaElement>(null);
  const omitirBlur = useRef(false);
  const eraNuevo = useRef(empezarEditando && valor === '');

  useEffect(() => {
    if (!editando || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [editando, borrador]);

  // Al abrir, el cursor queda al final.
  useEffect(() => {
    if (!editando || !ref.current) return;
    ref.current.focus();
    const n = ref.current.value.length;
    ref.current.setSelectionRange(n, n);
  }, [editando]);

  const empezar = () => {
    if (deshabilitado) return;
    omitirBlur.current = false;
    setBorrador(valor);
    setEditando(true);
  };

  const terminar = (guardar: boolean) => {
    omitirBlur.current = true;
    setEditando(false);
    const nuevo = borrador.replace(/\s*\n+\s*/g, ' ').trim();
    if (guardar) {
      if (nuevo !== valor || (eraNuevo.current && nuevo === '')) onCambio(nuevo);
    } else if (eraNuevo.current && valor === '') {
      onCambio('');
    }
    eraNuevo.current = false;
  };

  if (editando) {
    return (
      <textarea
        ref={ref}
        rows={1}
        value={borrador}
        maxLength={maxLength}
        aria-label={etiqueta}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={() => { if (!omitirBlur.current) terminar(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); setBorrador(valor); terminar(false); }
          else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); terminar(true); }
        }}
        className={`block w-full resize-none rounded-md border border-primary/40 bg-background px-1.5 py-1 text-[inherit] leading-[inherit] outline-none ring-2 ring-primary/15 ${className}`}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={deshabilitado ? -1 : 0}
      aria-label={`${etiqueta}: ${valor || 'vacío'}. Clic para corregir`}
      aria-disabled={deshabilitado || undefined}
      onClick={empezar}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); empezar(); } }}
      className={`-mx-0.5 cursor-text rounded px-0.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40 ${valor ? '' : 'italic text-muted-foreground'} ${deshabilitado ? 'pointer-events-none' : ''} ${className}`}
    >
      {valor ? (rico ? <Rico texto={valor} /> : valor) : placeholder}
    </span>
  );
}
