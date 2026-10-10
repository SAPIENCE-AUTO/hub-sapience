import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { fmtMonto, plural } from '../../lib/payments/formato';
import { fmtFechaCorta } from '../../lib/payments/fechas';
import type { ResumenTarjetas, Tarjeta, TotalesMoneda } from '../../lib/payments/urgencia';
import { EXITO, GRIS, PELIGRO, TEAL } from '../../lib/toolColors';
import { FONDO_PELIGRO } from './estilos';

// Pesos y dólares nunca se suman: el monto grande es el de pesos (o el de dólares si solo hay dólares) y el otro va abajo.
function Montos({ totales, alerta }: { totales: TotalesMoneda; alerta?: boolean }) {
  const mxn = totales.MXN?.total ?? 0;
  const usd = totales.USD?.total ?? 0;
  const entero = { centavos: 'nunca' } as const;
  if (mxn === 0 && usd === 0) return <p className="text-lg font-bold mt-0.5">$0</p>;
  return (
    <>
      <p className="text-lg font-bold mt-0.5 leading-tight">
        {mxn !== 0 ? fmtMonto(mxn, 'MXN', entero) : fmtMonto(usd, 'USD', entero)}
        {mxn !== 0 && <span className="ml-1 text-xs font-normal opacity-70">MXN</span>}
      </p>
      {mxn !== 0 && usd !== 0 && <p className={`text-sm leading-tight ${alerta ? '' : 'text-muted-foreground'}`}>+ {fmtMonto(usd, 'USD', entero)}</p>}
    </>
  );
}

function KpiCard({ icono: Icono, etiqueta, tarjeta, pie, alerta, color }: {
  icono: React.ElementType;
  etiqueta: string;
  tarjeta: Tarjeta;
  pie: string;
  alerta?: boolean;
  color: string;
}) {
  return (
    <div
      className={`border rounded-xl p-4 flex items-center gap-4 ${alerta ? '' : 'bg-card'}`}
      style={alerta ? { backgroundColor: FONDO_PELIGRO, borderColor: `${PELIGRO}47` } : undefined}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
        <Icono className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0" style={alerta ? { color: PELIGRO } : undefined}>
        <p className={`text-xs ${alerta ? '' : 'text-muted-foreground'}`}>{etiqueta}</p>
        <Montos totales={tarjeta.totales} alerta={alerta} />
        <p className={`text-[11px] mt-0.5 ${alerta ? 'opacity-80' : 'text-muted-foreground'}`}>{pie}</p>
      </div>
    </div>
  );
}

export function PaymentsKpis({ resumen, hoy }: { resumen: ResumenTarjetas; hoy: string }) {
  const { porPagar, vencido, vencidoMasViejo, pagadoMes, nombreMes } = resumen;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
      <KpiCard icono={Clock} etiqueta="Por pagar" tarjeta={porPagar} pie={plural(porPagar.n, 'pago')} color={TEAL} />
      <KpiCard
        icono={AlertTriangle}
        etiqueta="Vencido"
        tarjeta={vencido}
        alerta={vencido.n > 0}
        color={vencido.n > 0 ? PELIGRO : GRIS}
        pie={vencido.n > 0 ? `${plural(vencido.n, 'pago')} · el más viejo, ${fmtFechaCorta(vencidoMasViejo, hoy)}` : 'Nada vencido'}
      />
      <KpiCard icono={CheckCircle} etiqueta={`Pagado en ${nombreMes}`} tarjeta={pagadoMes} pie={plural(pagadoMes.n, 'pago')} color={EXITO} />
    </div>
  );
}
