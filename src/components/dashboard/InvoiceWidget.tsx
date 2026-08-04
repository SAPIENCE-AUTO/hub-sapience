import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { GetInvoiceWidgetDataOutputType } from 'zite-endpoints-sdk';

type Invoice = GetInvoiceWidgetDataOutputType['invoices'][0];

function statusBadge(status?: string) {
  if (!status) return <Badge variant="outline" className="text-[10px] py-0">—</Badge>;
  if (status === 'Rechazada') {
    return <Badge variant="destructive" className="text-[10px] py-0">{status}</Badge>;
  }
  if (status === 'En revisión') {
    return (
      <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium bg-[hsl(var(--chart-3)/0.15)] text-[hsl(var(--chart-3))] border border-[hsl(var(--chart-3)/0.3)]">
        {status}
      </span>
    );
  }
  // Pendiente and others
  return (
    <span className="inline-flex items-center px-1.5 py-0 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border">
      {status}
    </span>
  );
}

function formatCurrency(amount?: number, currency?: string) {
  if (amount == null) return '—';
  const symbol = currency === 'USD' ? 'USD $' : '$';
  return `${symbol}${amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const timeAgo = invoice.uploadDate
    ? formatDistanceToNow(new Date(invoice.uploadDate), { addSuffix: true, locale: es })
    : '';

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {invoice.supplierName ?? invoice.invoiceNumber ?? 'Sin proveedor'}
          </span>
          {invoice.invoiceNumber && invoice.supplierName && (
            <span className="text-[11px] text-muted-foreground shrink-0">#{invoice.invoiceNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {invoice.projectCode && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {invoice.projectCode}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">{timeAgo}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-sm font-semibold tabular-nums">
          {formatCurrency(invoice.amount, invoice.currency)}
        </span>
        {statusBadge(invoice.status)}
      </div>
    </div>
  );
}

interface Props {
  data: GetInvoiceWidgetDataOutputType | null;
  loading: boolean;
}

export default function InvoiceWidget({ data, loading }: Props) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/operacion/facturas-proveedores')}
      className="w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
    >
      {/* Header with count */}
      <div className="p-4 pb-3 border-b border-border">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-20 rounded-lg" />
            <Skeleton className="h-3 w-36 rounded" />
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-black leading-none text-foreground">
                {data?.unpaidCount ?? 0}
              </span>
              <div className="flex items-center gap-1.5 mb-0.5">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">sin programar a pago</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Invoice list */}
      {loading ? (
        <div className="p-3 space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 rounded-lg" />)}
        </div>
      ) : data && data.invoices.length > 0 ? (
        <div className="divide-y divide-border">
          {data.invoices.map(inv => (
            <InvoiceRow key={inv.id} invoice={inv} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
          <FileText className="w-8 h-8 opacity-30" />
          <p className="text-sm">Sin facturas pendientes</p>
        </div>
      )}
    </button>
  );
}
