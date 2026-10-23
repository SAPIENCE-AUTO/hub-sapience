import { useEffect, useRef, useState } from 'react';

/** «{opcion}» se ve como una marca: ahí va el nombre de cada opción cuando la sección se repite. */
export function ConMarcador({ texto }: { texto: string }) {
  const partes = texto.split('{opcion}');
  return (
    <>
      {partes.map((p, i) => (
        <span key={i}>
          {p}
          {i < partes.length - 1 && <span title="Aquí va el nombre de cada opción: la sección se repite por cada una" className="mx-0.5 rounded bg-[#0F3D4D]/10 px-1 py-px text-[0.85em] font-medium text-[#0F3D4D]">opción</span>}
        </span>
      ))}
    </>
  );
}

/**
 * Texto que se corrige con un clic, como en la guía de tópicos: se vuelve un
 * cuadro de texto; Esc deshace, Cmd+Enter guarda y salir del cuadro también
 * guarda. En `linea` (opciones, títulos) Enter también guarda. Un texto que
 * no puede quedar vacío (`obligatorio`) vuelve a lo que tenía.
 */
export function TextoEditable({ valor, onGuardar, etiqueta, placeholder, className = '', linea = false, obligatorio = false, abrir = false, onCerrar }: {
  valor: string;
  onGuardar: (v: string) => void;
  etiqueta: string;
  placeholder?: string;
  className?: string;
  linea?: boolean;
  obligatorio?: boolean;
  /** Abrir ya en edición (lo recién agregado). */
  abrir?: boolean;
  onCerrar?: () => void;
}) {
  const [editando, setEditando] = useState(abrir);
  const [borrador, setBorrador] = useState(valor);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (abrir) { setBorrador(valor); setEditando(true); } }, [abrir]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editando || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [editando, borrador]);
  useEffect(() => {
    if (!editando || !ref.current) return;
    ref.current.focus();
    // Lo recién agregado («Pregunta nueva») se selecciona entero para escribir encima; lo demás, cursor al final.
    if (abrir) ref.current.select();
    else ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
  }, [editando]); // eslint-disable-line react-hooks/exhaustive-deps

  const empezar = () => { setBorrador(valor); setEditando(true); };
  const cerrar = () => { setEditando(false); onCerrar?.(); };
  const guardar = () => {
    const v = borrador.trim();
    cerrar();
    if (v === valor.trim()) return;
    if (!v && obligatorio) return;
    onGuardar(v);
  };

  if (editando) {
    return (
      <textarea
        ref={ref}
        aria-label={etiqueta}
        rows={1}
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={guardar}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation(); // Cmd+Z dentro del cuadro es del cuadro, no del editor
          if (e.key === 'Escape') { e.preventDefault(); setBorrador(valor); cerrar(); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || linea)) { e.preventDefault(); guardar(); }
        }}
        className={`block w-full resize-none rounded-md border border-[#0F3D4D]/40 bg-white px-1.5 py-0.5 outline-none ring-2 ring-[#0F3D4D]/15 ${className}`}
      />
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${etiqueta}: ${valor || 'vacío'}. Clic para corregir`}
      title="Clic para corregir"
      onClick={(e) => { e.stopPropagation(); empezar(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); empezar(); } }}
      className={`cursor-text rounded-sm decoration-[#0F3D4D]/30 underline-offset-4 hover:bg-[#0F3D4D]/[0.04] hover:underline hover:decoration-dotted ${valor ? '' : 'italic text-muted-foreground'} ${className}`}
    >
      {valor ? <ConMarcador texto={valor} /> : placeholder}
    </span>
  );
}
