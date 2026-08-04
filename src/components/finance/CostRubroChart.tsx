import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type RubroRow = {
  rubro: string;
  cotizado: number;
  precioCliente: number;
  gastado: number;
};

const SHORT: Record<string, string> = {
  'Reclutamiento e incentivos': 'Reclutamiento',
  'Moderación': 'Moderación',
  'Management': 'Management',
  'Logística y operación': 'Logística',
  'Back office': 'Back office',
};

const fmtY = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
};

const fmtTooltip = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

export default function CostRubroChart({ byRubro }: { byRubro: RubroRow[] }) {
  const data = byRubro.map(r => ({
    name: SHORT[r.rubro] ?? r.rubro,
    'Precio cliente': r.precioCliente,
    'Costo cotizado': r.cotizado,
    'Gastado (ODCs)': r.gastado,
  }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 16, bottom: 8 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={{ stroke: 'hsl(var(--border))' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmtY}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          formatter={(v: number) => fmtTooltip(v)}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            fontSize: 13,
          }}
          labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="Precio cliente" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Costo cotizado" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} opacity={0.6} />
        <Bar dataKey="Gastado (ODCs)" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
