import { useEffect, useRef, useState } from 'react';

/** Texto con **negritas** (como las guarda la guía). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((s, i) =>
        s.startsWith('**') && s.endsWith('**') ? <strong key={i}>{s.slice(2, -2)}</strong> : <span key={i}>{s}</span>)}
    </>
  );
}

/**
 * Texto que se corrige con un clic: se vuelve un cuadro de texto y se guarda al salir.
 * Esc deshace; un texto vacío se puede quitar con `onRemove`.
 */
export default function EditableText({ value, onChange, placeholder, className = '', label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [editing, draft]);
  // Al abrir, el cursor queda al final del texto.
  useEffect(() => {
    if (editing && ref.current) ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
  }, [editing]);

  const start = () => { setDraft(value); setEditing(true); };
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v !== value) onChange(v);
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        className={`gd-edit ${className}`}
        aria-label={label}
        autoFocus
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
        }}
      />
    );
  }
  return (
    <span
      className={`gd-text ${className}${value ? '' : ' is-empty'}`}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${value || 'vacío'}. Clic para corregir`}
      onClick={start}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }}
    >
      {value ? <Rich text={value} /> : placeholder}
    </span>
  );
}
