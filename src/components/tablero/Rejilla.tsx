// Rejilla de bloques del tablero: 12 columnas, bloques que se arrastran por el asa y se estiran por la esquina (solo al editar). Mientras se arrastra, el bloque sigue
// al cursor y los demás se acomodan en vivo; al soltar se guarda el acomodo. Las cuentas del acomodo viven en lib/tablero/rejilla.ts (puras y probadas); aquí solo
// se traducen los pixeles del cursor a posiciones de la rejilla. En pantallas angostas los bloques se apilan en una columna y no se mueven.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as PE, ReactNode } from 'react';
import { COLUMNAS, alturaTotal, mover, redimensionar } from '@/lib/tablero/rejilla';
import { minimoPorTipo } from '@/lib/tablero/vistas';
import type { Bloque, Pos } from '@/lib/tablero/tipos';

export const ALTO_FILA = 40;
export const SEPARACION = 12;
const FILA = ALTO_FILA + SEPARACION;
/** Más angosto que esto (o que ANCHO_EDITANDO al editar) los bloques se apilan en una columna. */
const ANCHO_MINIMO = 520;
const ANCHO_EDITANDO = 340;

export interface AsaProps {
  onPointerDown?: (e: PE<HTMLElement>) => void;
  onPointerMove?: (e: PE<HTMLElement>) => void;
  onPointerUp?: (e: PE<HTMLElement>) => void;
  onPointerCancel?: (e: PE<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  tabIndex?: number;
  role?: string;
  'aria-label'?: string;
  style?: CSSProperties;
}

interface Gesto {
  id: string;
  tipo: 'mover' | 'estirar';
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  colW: number;
  base: Bloque[];
  vista: Bloque[];
}

interface Props {
  bloques: Bloque[];
  editando: boolean;
  onCambio: (bloques: Bloque[]) => void;
  /** Dibuja un bloque; recibe las propiedades que hacen de asa para arrastrarlo. */
  dibujar: (b: Bloque, extra: { asa: AsaProps; moviendo: boolean }) => ReactNode;
}

const posicionCss = (p: Pos, animar: boolean): CSSProperties => ({
  left: `calc((100% + ${SEPARACION}px) * ${p.x} / ${COLUMNAS})`,
  width: `calc((100% + ${SEPARACION}px) * ${p.w} / ${COLUMNAS} - ${SEPARACION}px)`,
  top: p.y * FILA,
  height: p.h * FILA - SEPARACION,
  transition: animar ? 'top .15s ease, left .15s ease, width .15s ease, height .15s ease' : undefined,
});

const mismasPosiciones = (a: Bloque[], b: Bloque[]): boolean =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id && x.pos.x === b[i].pos.x && x.pos.y === b[i].pos.y && x.pos.w === b[i].pos.w && x.pos.h === b[i].pos.h);

export default function Rejilla({ bloques, editando, onCambio, dibujar }: Props) {
  const cont = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const actual = useRef<Gesto | null>(null);

  useEffect(() => {
    const el = cont.current;
    if (!el) return;
    const ob = new ResizeObserver(() => setAncho(el.clientWidth));
    ob.observe(el);
    setAncho(el.clientWidth);
    return () => ob.disconnect();
  }, []);

  const empezar = (e: PE<HTMLElement>, id: string, tipo: Gesto['tipo']) => {
    if (!editando || e.button !== 0 || !cont.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const g: Gesto = { id, tipo, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, colW: (cont.current.clientWidth + SEPARACION) / COLUMNAS, base: bloques, vista: bloques };
    actual.current = g;
    setGesto(g);
  };

  const seguir = (e: PE<HTMLElement>) => {
    const g = actual.current;
    if (!g) return;
    const b = g.base.find(i => i.id === g.id);
    if (!b) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const vista = g.tipo === 'mover'
      ? mover(g.base, g.id, b.pos.x + dx / g.colW, b.pos.y + dy / FILA)
      : redimensionar(g.base, g.id, b.pos.w + dx / g.colW, b.pos.h + dy / FILA, minimoPorTipo(b.tipo));
    const sig: Gesto = { ...g, dx, dy, vista };
    actual.current = sig;
    setGesto(sig);
  };

  const terminar = (e: PE<HTMLElement>) => {
    const g = actual.current;
    if (!g) return;
    actual.current = null;
    setGesto(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ya soltado */ }
    if (!mismasPosiciones(g.vista, g.base)) onCambio(g.vista);
  };

  const teclas = (e: KeyboardEvent<HTMLElement>, b: Bloque) => {
    const paso = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (!editando || !paso) return;
    e.preventDefault();
    onCambio(e.shiftKey
      ? redimensionar(bloques, b.id, b.pos.w + paso[0], b.pos.h + paso[1], minimoPorTipo(b.tipo))
      : mover(bloques, b.id, b.pos.x + paso[0], b.pos.y + paso[1]));
  };

  const asaDe = (b: Bloque): AsaProps => (editando ? {
    onPointerDown: e => empezar(e, b.id, 'mover'),
    onPointerMove: seguir,
    onPointerUp: terminar,
    onPointerCancel: terminar,
    onKeyDown: e => teclas(e, b),
    tabIndex: 0,
    role: 'button',
    'aria-label': `Mover el bloque «${b.titulo}». Con las flechas se mueve; con mayúsculas y flechas se estira.`,
    style: { cursor: gesto?.id === b.id ? 'grabbing' : 'grab', touchAction: 'none' },
  } : {});

  const angosto = ancho > 0 && ancho < (editando ? ANCHO_EDITANDO : ANCHO_MINIMO);
  if (angosto) {
    const orden = [...bloques].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    return (
      <div ref={cont} className="flex flex-col gap-3">
        {orden.map(b => (
          <div key={b.id} style={{ height: Math.max(b.pos.h * FILA - SEPARACION, 160) }}>{dibujar(b, { asa: {}, moviendo: false })}</div>
        ))}
      </div>
    );
  }

  const lista = gesto?.vista ?? bloques;
  const enMovimiento = gesto?.tipo === 'mover' ? gesto : null;
  return (
    <div ref={cont} className={`relative ${gesto ? 'select-none' : ''}`} style={{ height: Math.max(alturaTotal(lista) * FILA - SEPARACION, 0) }}>
      {enMovimiento && (
        <div className="absolute rounded-xl border-2 border-dashed border-primary/40 bg-primary/5" style={posicionCss(lista.find(b => b.id === enMovimiento.id)!.pos, true)} />
      )}
      {lista.map(b => {
        const moviendo = enMovimiento?.id === b.id;
        const origen = moviendo ? enMovimiento.base.find(i => i.id === b.id) : undefined;
        const estilo: CSSProperties = moviendo && origen
          ? { left: origen.pos.x * enMovimiento.colW + enMovimiento.dx, top: origen.pos.y * FILA + enMovimiento.dy, width: origen.pos.w * enMovimiento.colW - SEPARACION, height: origen.pos.h * FILA - SEPARACION, zIndex: 30 }
          : posicionCss(b.pos, !!gesto);
        return (
          <div key={b.id} className={`absolute ${moviendo ? 'opacity-90 shadow-xl' : ''}`} style={estilo}>
            {dibujar(b, { asa: asaDe(b), moviendo })}
            {editando && (
              <div
                role="presentation"
                className="absolute bottom-1 right-1 z-10 h-4 w-4 cursor-se-resize touch-none rounded-sm text-muted-foreground/60 hover:text-primary"
                onPointerDown={e => empezar(e, b.id, 'estirar')}
                onPointerMove={seguir}
                onPointerUp={terminar}
                onPointerCancel={terminar}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M14 6 6 14M14 10l-4 4" /></svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
