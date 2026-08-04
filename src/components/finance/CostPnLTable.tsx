import { cn } from '@/lib/utils';

const fmt = (v: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v);

type RubroRow = {
  rubro: string;
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

type Props = {
  byRubro: RubroRow[];
  totals: Omit<RubroRow, 'rubro'>;
};

function NumCell({ value, currency = true }: { value: number; currency?: boolean }) {
  const pos = value >= 0;
  return (
    <td className={cn('px-3 py-3 text-right font-medium tabular-nums', pos ? 'text-emerald-600' : 'text-destructive')}>
      {currency ? fmt(value) : `${value.toFixed(1)}%`}
    </td>
  );
}

function PctCell({ value }: { value: number | null }) {
  if (value === null) return <td className="px-3 py-3 text-right text-muted-foreground">—</td>;
  return <NumCell value={value} currency={false} />;
}

function Row({ row, bold = false }: { row: Omit<RubroRow, 'rubro'> & { rubro?: string }; bold?: boolean }) {
  const cls = bold ? 'font-semibold bg-muted' : 'hover:bg-muted/30 transition-colors';
  return (
    <tr className={cls}>
      <td className={cn('px-3 py-3 text-foreground', bold && 'font-semibold')}>{row.rubro ?? 'Total'}</td>
      <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">{fmt(row.cotizado)}</td>
      <NumCell value={row.markUpInicial} />
      <td className="px-3 py-3 text-right tabular-nums">{fmt(row.costoConMarkup)}</td>
      <td className="px-3 py-3 text-right tabular-nums font-medium">{fmt(row.precioCliente)}</td>
      <td className="px-3 py-3 text-right tabular-nums">{fmt(row.gastado)}</td>
      <NumCell value={row.diferenciaTotalMxn} />
      <NumCell value={row.markUpFinal} />
      <PctCell value={row.revenueInicial} />
      <PctCell value={row.revenueFinal} />
    </tr>
  );
}

export default function CostPnLTable({ byRubro, totals }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground border-b border-border">
          <tr>
            <th className="px-3 py-3 text-left font-medium">Elemento</th>
            <th className="px-3 py-3 text-right font-medium">Cotizados</th>
            <th className="px-3 py-3 text-right font-medium">
              <span title="Subtotal Precio − Cotizados">Mark Up Inicial</span>
            </th>
            <th className="px-3 py-3 text-right font-medium">Subtotal Precio</th>
            <th className="px-3 py-3 text-right font-medium">Precio a cliente (F)</th>
            <th className="px-3 py-3 text-right font-medium">Costos Reales</th>
            <th className="px-3 py-3 text-right font-medium">
              <span title="Mark Up Final − Mark Up Inicial">Diferencia Total MXN</span>
            </th>
            <th className="px-3 py-3 text-right font-medium">
              <span title="Precio a cliente − Costos Reales">Mark Up Final</span>
            </th>
            <th className="px-3 py-3 text-right font-medium">
              <span title="Mark Up Inicial / Precio a cliente">Revenue Inicial %</span>
            </th>
            <th className="px-3 py-3 text-right font-medium">
              <span title="Mark Up Final / Precio a cliente">Revenue Final %</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {byRubro.map(row => <Row key={row.rubro} row={row} />)}
        </tbody>
        <tfoot className="border-t-2 border-border">
          <Row row={totals} bold />
        </tfoot>
      </table>
    </div>
  );
}
