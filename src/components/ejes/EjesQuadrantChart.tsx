import { useMemo, useRef, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { PELIGRO } from '@/lib/toolColors';

export interface EjesIdeaResultado {
  id: string;
  titulo: string;
  imagenUrl?: string;
  avgX: number;
  avgY: number;
  totalEvaluaciones: number;
  cuadrante?: 'alto_alto' | 'bajo_alto' | 'bajo_bajo' | 'alto_bajo';
  cuadranteLabel?: string;
}

export interface EjesEvaluacionPunto { valorX: number; valorY: number }

interface EjesQuadrantChartProps {
  ejeXLabel: string; ejeXMin: number; ejeXMax: number;
  ejeYLabel: string; ejeYMin: number; ejeYMax: number;
  ideas: EjesIdeaResultado[];
  height?: number;
  dotColor?: string;
  gridColor?: string;
  textColor?: string;
  onIdeaClick?: (idea: EjesIdeaResultado) => void;
  /** Pasar cursor sobre un punto (y quitarlo, con `null`) — mismo modo detalle que `onIdeaClick`, pero disparado al pasar el mouse en vez de hacer click (usado en la proyección, donde no hay lista de chips para "cerrar" la selección). */
  onIdeaHover?: (idea: EjesIdeaResultado | null) => void;
  /** Idea seleccionada: su punto promedio se dibuja más grande y encima de sus evaluaciones individuales (puntitos grises). */
  detalleIdeaId?: string;
  detalleEvaluaciones?: EjesEvaluacionPunto[];
}

const RADIO_BASE = 5;
const RADIO_MAX = 13;
const RADIO_SELECCIONADA = 14;

function radioPorEvaluaciones(n: number): number {
  return Math.min(RADIO_MAX, RADIO_BASE + n * 1.3);
}

interface HoverInfo { left: number; top: number; idea: EjesIdeaResultado }

/**
 * Reusa el patrón de ScatterChart ya establecido en
 * src/components/commercial-dashboard/ChartRenderer.tsx:124-162 (recharts
 * ya es dependencia y ya tiene exactamente esta forma) — no se hand-rolla
 * SVG. Las `ReferenceLine` al punto medio de cada eje son las que dividen
 * el plano en los 4 cuadrantes.
 *
 * Modo detalle (`detalleIdeaId` presente): el resto de las ideas se oculta
 * por completo (no solo se atenúa) para no competir visualmente con los
 * puntitos grises de evaluación individual — solo queda el punto promedio
 * de la idea seleccionada, en rojo. El tamaño de cada punto-promedio ya no
 * viene de `ZAxis` — se calcula a mano vía un `shape` custom.
 *
 * El mini popup NO usa `<Tooltip>` de recharts — su tracking interno de
 * "punto activo" vive separado de nuestros `onMouseEnter/onMouseLeave` en
 * `<Scatter>`, y se desincroniza justo cuando el arreglo de datos cambia de
 * tamaño (que es exactamente lo que pasa al entrar en modo detalle): el
 * popup se apagaba solo, de forma intermitente ("aparece y se borra").
 * En vez de pelear con eso, el popup se dibuja a mano, posicionado con las
 * coordenadas del mouse nativo — mismo mecanismo ya estable que dispara
 * `onIdeaHover`/`onIdeaClick`.
 */
export default function EjesQuadrantChart({
  ejeXLabel, ejeXMin, ejeXMax, ejeYLabel, ejeYMin, ejeYMax, ideas, height = 320,
  dotColor = '#027495', gridColor, textColor, onIdeaClick, onIdeaHover, detalleIdeaId, detalleEvaluaciones,
}: EjesQuadrantChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const midX = (ejeXMin + ejeXMax) / 2;
  const midY = (ejeYMin + ejeYMax) / 2;
  const ideasVisibles = useMemo(
    () => (detalleIdeaId ? ideas.filter((idea) => idea.id === detalleIdeaId) : ideas),
    [ideas, detalleIdeaId],
  );
  const scatterData = useMemo(
    () => ideasVisibles.map((idea) => ({ ...idea, x: idea.avgX, y: idea.avgY })),
    [ideasVisibles],
  );
  const puntosIndividuales = useMemo(
    () => (detalleEvaluaciones ?? []).map((ev) => ({ x: ev.valorX, y: ev.valorY })),
    [detalleEvaluaciones],
  );
  const stroke = gridColor ?? 'hsl(var(--border))';
  const fill = textColor ?? 'hsl(var(--muted-foreground))';

  const handleMouseEnter = (entry: any, _index: number, event: any) => {
    onIdeaHover?.(entry);
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect && event) {
      let left = event.clientX - containerRect.left + 14;
      const top = event.clientY - containerRect.top - 14;
      if (left + 224 > containerRect.width) left = event.clientX - containerRect.left - 224 - 14;
      setHoverInfo({ left, top, idea: entry as EjesIdeaResultado });
    }
  };
  const handleMouseLeave = () => {
    onIdeaHover?.(null);
    setHoverInfo(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 10, right: 20, left: 5, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={stroke} />
          <XAxis
            dataKey="x" type="number" domain={[ejeXMin, ejeXMax]} tick={{ fontSize: 11, fill }}
            label={{ value: ejeXLabel, position: 'insideBottom', offset: -12, fontSize: 11, fill }}
          />
          <YAxis
            dataKey="y" type="number" domain={[ejeYMin, ejeYMax]} tick={{ fontSize: 11, fill }}
            label={{ value: ejeYLabel, angle: -90, position: 'insideLeft', offset: 10, fontSize: 11, fill }}
          />
          <ReferenceLine x={midX} stroke={stroke} strokeDasharray="4 4" />
          <ReferenceLine y={midY} stroke={stroke} strokeDasharray="4 4" />
          {puntosIndividuales.length > 0 && (
            <Scatter
              data={puntosIndividuales}
              shape={(props: any) => (
                <circle cx={props.cx} cy={props.cy} r={4} fill="#9aa5a9" fillOpacity={0.7} />
              )}
              isAnimationActive={false}
            />
          )}
          <Scatter
            data={scatterData}
            shape={(props: any) => {
              const seleccionada = props.payload?.id === detalleIdeaId;
              const r = seleccionada ? RADIO_SELECCIONADA : radioPorEvaluaciones(props.payload?.totalEvaluaciones ?? 0);
              return (
                <circle
                  cx={props.cx} cy={props.cy} r={r}
                  fill={seleccionada ? PELIGRO : dotColor} fillOpacity={0.9}
                  style={{ cursor: onIdeaClick ? 'pointer' : undefined }}
                />
              );
            }}
            onClick={(entry: any) => onIdeaClick?.(entry)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            isAnimationActive={false}
          />
        </ScatterChart>
      </ResponsiveContainer>
      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-10 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          style={{ left: hoverInfo.left, top: hoverInfo.top }}
        >
          {hoverInfo.idea.imagenUrl ? (
            <div className="relative flex h-28 w-full items-center justify-center overflow-hidden bg-[#eef1f2]">
              <img src={hoverInfo.idea.imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
              <img src={hoverInfo.idea.imagenUrl} alt="" className="relative max-h-full max-w-full object-contain p-2" />
            </div>
          ) : null}
          <div className="p-3">
            <p className="text-[15px] font-bold leading-tight text-foreground">{hoverInfo.idea.titulo}</p>
            {hoverInfo.idea.cuadranteLabel && <p className="mt-1 text-xs text-muted-foreground">{hoverInfo.idea.cuadranteLabel}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hoverInfo.idea.totalEvaluaciones} evaluación{hoverInfo.idea.totalEvaluaciones !== 1 ? 'es' : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
