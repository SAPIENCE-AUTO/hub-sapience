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

interface EjesQuadrantChartProps {
  ejeXLabel: string; ejeXMin: number; ejeXMax: number;
  ejeYLabel: string; ejeYMin: number; ejeYMax: number;
  ideas: EjesIdeaResultado[];
  height?: number;
  dotColor?: string;
  gridColor?: string;
  textColor?: string;
  onIdeaClick?: (idea: EjesIdeaResultado) => void;
}

/**
 * Reusa el patrón de ScatterChart ya establecido en
 * src/components/commercial-dashboard/ChartRenderer.tsx:124-162 (recharts
 * ya es dependencia y ya tiene exactamente esta forma) — no se hand-rolla
 * SVG. Las `ReferenceLine` al punto medio de cada eje son las que dividen
 * el plano en los 4 cuadrantes.
 */
export default function EjesQuadrantChart({
  ejeXLabel, ejeXMin, ejeXMax, ejeYLabel, ejeYMin, ejeYMax, ideas, height = 320,
  dotColor = '#027495', gridColor, textColor, onIdeaClick,
}: EjesQuadrantChartProps) {
  const midX = (ejeXMin + ejeXMax) / 2;
  const midY = (ejeYMin + ejeYMax) / 2;
  const scatterData = ideas.map((idea) => ({ ...idea, x: idea.avgX, y: idea.avgY, z: idea.totalEvaluaciones }));
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
        <ZAxis dataKey="z" range={[70, 260]} />
        <ReferenceLine x={midX} stroke={stroke} strokeDasharray="4 4" />
        <ReferenceLine y={midY} stroke={stroke} strokeDasharray="4 4" />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as EjesIdeaResultado;
            return (
              <div className="space-y-1 rounded-lg border border-border bg-card p-2 text-xs shadow-md">
                <p className="font-semibold text-foreground">{p.titulo}</p>
                {p.cuadranteLabel && <p className="text-muted-foreground">{p.cuadranteLabel}</p>}
                <p className="text-muted-foreground">{p.totalEvaluaciones} evaluación{p.totalEvaluaciones !== 1 ? 'es' : ''}</p>
              </div>
            );
          }}
        />
        <Scatter
          data={scatterData}
          fill={dotColor}
          fillOpacity={0.85}
          cursor={onIdeaClick ? 'pointer' : undefined}
          onClick={(entry: any) => onIdeaClick?.(entry)}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
