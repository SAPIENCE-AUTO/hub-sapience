import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Recuadro para firmar con el dedo o el mouse. Guarda los trazos como puntos y los vuelve a dibujar si cambia el tamaño (girar el celular no borra la firma);
// al exportar los dibuja de nuevo a 600 px de ancho con fondo transparente (el servidor revisa que sea una firma de verdad y la reduce).
export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  /** PNG (data URL) de 600 px de ancho con fondo transparente. */
  toDataURL: () => string;
}

type Punto = { x: number; y: number };
const TINTA = '#0b2530';
const GROSOR = 2.4;
const ANCHO_EXPORTADO = 600;

function trazar(ctx: CanvasRenderingContext2D, trazos: Punto[][], factor: number) {
  ctx.strokeStyle = TINTA;
  ctx.fillStyle = TINTA;
  ctx.lineWidth = GROSOR * factor;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of trazos) {
    if (t.length === 0) continue;
    if (t.length === 1) {
      ctx.beginPath();
      ctx.arc(t[0].x * factor, t[0].y * factor, (GROSOR * factor) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(t[0].x * factor, t[0].y * factor);
    for (let i = 1; i < t.length - 1; i++) {
      // curva suave: cada punto es el control y el destino es el punto medio con el siguiente
      const mx = ((t[i].x + t[i + 1].x) / 2) * factor;
      const my = ((t[i].y + t[i + 1].y) / 2) * factor;
      ctx.quadraticCurveTo(t[i].x * factor, t[i].y * factor, mx, my);
    }
    const u = t[t.length - 1];
    ctx.lineTo(u.x * factor, u.y * factor);
    ctx.stroke();
  }
}

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (vacio: boolean) => void; alto?: number }>(function SignaturePad({ onChange, alto = 170 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trazos = useRef<Punto[][]>([]);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);

  const pintar = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trazar(ctx, trazos.current, 1);
  }, []);

  // Ajusta la resolución del lienzo al tamaño real en pantalla (y a pantallas retina) y repinta lo dibujado.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ajustar = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      pintar();
    };
    ajustar();
    const obs = new ResizeObserver(ajustar);
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [pintar]);

  const marcar = (v: boolean) => { setVacio(v); onChange?.(v); };

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): Punto => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useImperativeHandle(ref, () => ({
    clear: () => { trazos.current = []; pintar(); marcar(true); },
    isEmpty: () => trazos.current.length === 0,
    toDataURL: () => {
      const canvas = canvasRef.current;
      const ancho = canvas?.clientWidth || 1;
      const factor = ANCHO_EXPORTADO / ancho;
      const salida = document.createElement('canvas');
      salida.width = ANCHO_EXPORTADO;
      salida.height = Math.max(1, Math.round((canvas?.clientHeight || alto) * factor));
      const ctx = salida.getContext('2d');
      if (ctx) trazar(ctx, trazos.current, factor);
      return salida.toDataURL('image/png');
    },
  }), [pintar, alto]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative rounded-lg border border-dashed border-slate-300 bg-slate-50" style={{ height: alto }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Recuadro para firmar con el dedo o con el mouse"
        className="absolute inset-0 h-full w-full cursor-crosshair rounded-lg"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dibujando.current = true;
          trazos.current.push([punto(e)]);
          pintar();
        }}
        onPointerMove={(e) => {
          if (!dibujando.current) return;
          const t = trazos.current[trazos.current.length - 1];
          t.push(punto(e));
          pintar();
        }}
        onPointerUp={() => { if (dibujando.current) { dibujando.current = false; marcar(false); } }}
        onPointerCancel={() => { if (dibujando.current) { dibujando.current = false; marcar(trazos.current.length === 0); } }}
      />
      {vacio && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          Firma aquí con el dedo o el mouse
        </div>
      )}
      {/* la línea de firma */}
      <div className="pointer-events-none absolute bottom-7 left-4 right-4 border-b border-slate-300" />
    </div>
  );
});
