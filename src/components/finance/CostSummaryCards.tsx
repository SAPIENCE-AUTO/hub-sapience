import { TrendingUp, TrendingDown, DollarSign, FileText, ShoppingCart, Tag, Percent } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const fmt = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

type Totals = {
  cotizado: number;
  costoConMarkup: number;
  precioCliente: number;
  gastado: number;
  markUpInicial: number;
  markUpFinal: number;
  diferenciaTotalMxn: number;
  revenueInicial: number | null;
  revenueFinal: number | null;
};

export default function CostSummaryCards({ totals, hasDeal }: { totals: Totals; hasDeal: boolean }) {
  const posMarkUpFinal = totals.markUpFinal >= 0;
  const posRevFinal = (totals.revenueFinal ?? 0) >= 0;
  const posRevInicial = (totals.revenueInicial ?? 0) >= 0;

  const cards = [
    {
      label: 'Costo cotizado',
      value: fmt(totals.cotizado),
      sub: 'Costo base sin markup',
      icon: FileText,
      accent: 'text-muted-foreground',
      bg: 'bg-muted',
    },
    {
      label: 'Mark Up Inicial',
      value: fmt(totals.markUpInicial),
      sub: 'Subtotal − Cotizados',
      icon: Tag,
      accent: 'text-chart-4',
      bg: 'bg-chart-4/10',
    },
    {
      label: 'Subtotal Precio',
      value: fmt(totals.costoConMarkup),
      sub: 'Cotizado con markup aplicado',
      icon: Tag,
      accent: 'text-chart-4',
      bg: 'bg-chart-4/10',
    },
    {
      label: 'Precio a cliente (F)',
      value: fmt(totals.precioCliente),
      sub: hasDeal ? 'Precio negociado con cliente' : 'Vincular deal para ver',
      icon: DollarSign,
      accent: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      label: 'Costos Reales',
      value: fmt(totals.gastado),
      sub: 'Órdenes aprobadas y activas',
      icon: ShoppingCart,
      accent: 'text-chart-2',
      bg: 'bg-chart-2/10',
    },
    {
      label: 'Mark Up Final',
      value: fmt(totals.markUpFinal),
      sub: 'P. Cliente − Costos Reales',
      icon: posMarkUpFinal ? TrendingUp : TrendingDown,
      accent: posMarkUpFinal ? 'text-emerald-600' : 'text-destructive',
      bg: posMarkUpFinal ? 'bg-emerald-50' : 'bg-destructive/10',
    },
    {
      label: 'Revenue Inicial',
      value: totals.revenueInicial !== null ? `${totals.revenueInicial.toFixed(1)}%` : '—',
      sub: 'Mark Up Inicial / P. Cliente',
      icon: posRevInicial ? Percent : TrendingDown,
      accent: posRevInicial ? 'text-chart-3' : 'text-destructive',
      bg: posRevInicial ? 'bg-chart-3/10' : 'bg-destructive/10',
    },
    {
      label: 'Revenue Final',
      value: totals.revenueFinal !== null ? `${totals.revenueFinal.toFixed(1)}%` : '—',
      sub: 'Mark Up Final / P. Cliente',
      icon: posRevFinal ? TrendingUp : TrendingDown,
      accent: posRevFinal ? 'text-emerald-600' : 'text-destructive',
      bg: posRevFinal ? 'bg-emerald-50' : 'bg-destructive/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map(c => (
        <Card key={c.label} className="border-border shadow-sm">
          <CardContent className="p-4">
            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
              <c.icon className={`w-4 h-4 ${c.accent}`} />
            </div>
            <p className="text-xs text-muted-foreground mb-1 leading-tight">{c.label}</p>
            <p className={`text-base font-bold ${c.accent} leading-tight`}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-tight">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
