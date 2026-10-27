import type { ReactNode } from 'react';

/** Pill sólido chico del Hub: relleno de color, texto blanco. El color es el significado (ver toolColors). */
export function Pildora({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide text-white" style={{ backgroundColor: color }}>
      {children}
    </span>
  );
}
