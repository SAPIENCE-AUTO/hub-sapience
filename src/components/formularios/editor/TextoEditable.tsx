import { useEffect, useRef, useState } from 'react';
import { alternarMarca, COLOR_RESALTADO, sinFormato, type Marca } from '@/lib/formularios/formato';
import { TextoConFormato } from '../TextoConFormato';

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
 * `formato`: lo que lee el participante (pregunta, ayuda, bienvenida…) lleva
 * negritas (⌘B) y color de resaltar (lib/formularios/formato.ts); en el cuadro
 * se ven las marcas y afuera ya con su formato.
 */
export function TextoEditable({ valor, onGuardar, etiqueta, placeholder, className = '', linea = false, obligatorio = false, abrir = false, onCerrar, formato = false, enNegrita = false }: {
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
  formato?: boolean;
  /** El texto ya va en negritas (la pregunta): lo marcado en negritas se subraya. */
  enNegrita?: boolean;
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

  const marcar = (marca: Marca) => {
    const el = ref.current;
    if (!el) return;
    const r = alternarMarca(borrador, el.selectionStart, el.selectionEnd, marca);
    if (r.valor === borrador) return;
    setBorrador(r.valor);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.inicio, r.fin); });
  };

  if (editando) {
    const cuadro = (
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
          if (formato && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); marcar('negrita'); }
        }}
        className={`block w-full resize-none rounded-md border border-[#0F3D4D]/40 bg-white px-1.5 py-0.5 outline-none ring-2 ring-[#0F3D4D]/15 ${className}`}
      />
    );
    if (!formato) return cuadro;
    // Los botones no le quitan el foco al cuadro (si no, se guardaría al tocarlos).
    const boton = 'flex h-6 min-w-6 items-center justify-center rounded border border-[#E4E4E7] bg-white px-1.5 text-[12px] leading-none hover:bg-[#F1F2F4]';
    return (
      <span className="block">
        <span className="mb-1 flex items-center gap-1 font-normal not-italic">
          <button type="button" className={`${boton} font-bold text-[#1F1F23]`} title="Negritas (⌘B): selecciona la palabra o pon el cursor en ella" onMouseDown={(e) => { e.preventDefault(); marcar('negrita'); }}>B</button>
          <button type="button" className={`${boton} gap-1 font-semibold`} style={{ color: COLOR_RESALTADO }} title="Resaltar en color: selecciona la palabra o pon el cursor en ella" onMouseDown={(e) => { e.preventDefault(); marcar('resaltado'); }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_RESALTADO }} />Color
          </button>
        </span>
        {cuadro}
      </span>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`${etiqueta}: ${sinFormato(valor) || 'vacío'}. Clic para corregir`}
      title="Clic para corregir"
      onClick={(e) => { e.stopPropagation(); empezar(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); empezar(); } }}
      className={`cursor-text rounded-sm decoration-[#0F3D4D]/30 underline-offset-4 hover:bg-[#0F3D4D]/[0.04] hover:underline hover:decoration-dotted ${valor ? '' : 'italic text-muted-foreground'} ${className}`}
    >
      {!valor ? placeholder : formato ? <TextoConFormato texto={valor} enNegrita={enNegrita} pieza={(t) => <ConMarcador texto={t} />} /> : <ConMarcador texto={valor} />}
    </span>
  );
}
