import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
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
 */
export default function EjesQuadrantChart({
  ejeXLabel, ejeXMin, ejeXMax, ejeYLabel, ejeYMin, ejeYMax, ideas, height = 320,
  dotColor = '#027495', gridColor, textColor, onIdeaClick, onIdeaHover, detalleIdeaId, detalleEvaluaciones,
}: EjesQuadrantChartProps) {
  const midX = (ejeXMin + ejeXMax) / 2;
  const midY = (ejeYMin + ejeYMax) / 2;
  const ideasVisibles = detalleIdeaId ? ideas.filter((idea) => idea.id === detalleIdeaId) : ideas;
  const scatterData = ideasVisibles.map((idea) => ({ ...idea, x: idea.avgX, y: idea.avgY }));
  const puntosIndividuales = (detalleEvaluaciones ?? []).map((ev) => ({ x: ev.valorX, y: ev.valorY }));
  const stroke = gridColor ?? 'hsl(var(--border))';
  const fill = textColor ?? 'hsl(var(--muted-foreground))';

  return (
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
        <Tooltip
          cursor={false}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as EjesIdeaResultado;
            if (!p.titulo) return null;
            return (
              <div className="w-56 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
                {p.imagenUrl ? (
                  <div className="relative flex h-28 w-full items-center justify-center overflow-hidden bg-[#eef1f2]">
                    <img src={p.imagenUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
                    <img src={p.imagenUrl} alt="" className="relative max-h-full max-w-full object-contain p-2" />
                  </div>
                ) : null}
                <div className="p-3">
                  <p className="text-[15px] font-bold leading-tight text-foreground">{p.titulo}</p>
                  {p.cuadranteLabel && <p className="mt-1 text-xs text-muted-foreground">{p.cuadranteLabel}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.totalEvaluaciones} evaluación{p.totalEvaluaciones !== 1 ? 'es' : ''}</p>
                </div>
              </div>
            );
          }}
        />
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
          onMouseEnter={(entry: any) => onIdeaHover?.(entry)}
          onMouseLeave={() => onIdeaHover?.(null)}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
