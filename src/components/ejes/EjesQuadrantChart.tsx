import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';

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
  /** Idea seleccionada: su punto promedio se dibuja más grande y encima de sus evaluaciones individuales (puntitos grises). */
  detalleIdeaId?: string;
  detalleEvaluaciones?: EjesEvaluacionPunto[];
}

const RADIO_BASE = 5;
const RADIO_MAX = 13;
const RADIO_SELECCIONADO = 15;

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
 * El tamaño de cada punto-promedio ya no viene de `ZAxis` (no se puede
 * mezclar con el resaltado manual de la idea seleccionada sin pelearse por
 * el mismo dominio de tamaños) — se calcula a mano vía un `shape` custom,
 * lo que de paso permite dibujar más grande y con anillo blanco el punto de
 * la idea que el facilitador seleccionó, encima de sus puntitos grises de
 * evaluación individual (que van en un `Scatter` aparte, dibujado antes
 * para quedar detrás).
 */
export default function EjesQuadrantChart({
  ejeXLabel, ejeXMin, ejeXMax, ejeYLabel, ejeYMin, ejeYMax, ideas, height = 320,
  dotColor = '#027495', gridColor, textColor, onIdeaClick, detalleIdeaId, detalleEvaluaciones,
}: EjesQuadrantChartProps) {
  const midX = (ejeXMin + ejeXMax) / 2;
  const midY = (ejeYMin + ejeYMax) / 2;
  const scatterData = ideas.map((idea) => ({ ...idea, x: idea.avgX, y: idea.avgY }));
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
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as EjesIdeaResultado;
            if (!p.titulo) return null;
            return (
              <div className="space-y-1 rounded-lg border border-border bg-card p-2 text-xs shadow-md">
                <p className="font-semibold text-foreground">{p.titulo}</p>
                {p.cuadranteLabel && <p className="text-muted-foreground">{p.cuadranteLabel}</p>}
                <p className="text-muted-foreground">{p.totalEvaluaciones} evaluación{p.totalEvaluaciones !== 1 ? 'es' : ''}</p>
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
            const r = seleccionada ? RADIO_SELECCIONADO : radioPorEvaluaciones(props.payload?.totalEvaluaciones ?? 0);
            return (
              <circle
                cx={props.cx} cy={props.cy} r={r}
                fill={dotColor} fillOpacity={0.85}
                stroke={seleccionada ? '#fff' : 'none'} strokeWidth={seleccionada ? 2.5 : 0}
                style={{ cursor: onIdeaClick ? 'pointer' : undefined }}
              />
            );
          }}
          onClick={(entry: any) => onIdeaClick?.(entry)}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
