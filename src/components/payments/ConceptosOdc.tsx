import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { getPoLineItems } from 'zite-endpoints-sdk';
import { Skeleton } from '@/components/ui/skeleton';
import { fmtMonto, plural } from '../../lib/payments/formato';
import { CONCEPTOS_QUE_CABEN, conceptosVisibles, detalleCantidad, type ConceptoOdc } from '../../lib/payments/odc';
import { PELIGRO } from '../../lib/toolColors';

/**
 * Los conceptos de la ODC (qué se compró y a cuánto) con el total de la ODC al final. Se cargan al abrir el detalle del
 * pago; el total sale del propio pago, así que se ve aunque los conceptos tarden o no carguen.
 */
export function ConceptosOdc({ poId, moneda, total }: { poId: string; moneda?: string; total?: number }) {
  const [conceptos, setConceptos] = useState<ConceptoOdc[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [expandido, setExpandido] = useState(false);

  useEffect(() => {
    let vigente = true; // si se abre otro pago antes de terminar, la respuesta vieja se ignora
    setConceptos(null);
    setFallo(false);
    setExpandido(false);
    getPoLineItems({ poId })
      .then(d => { if (vigente) setConceptos(d.lineItems as ConceptoOdc[]); })
      .catch(() => { if (vigente) setFallo(true); });
    return () => { vigente = false; };
  }, [poId]);

  const { visibles, ocultos } = conceptosVisibles(conceptos ?? [], expandido);
  const listaLarga = (conceptos?.length ?? 0) > CONCEPTOS_QUE_CABEN;

  return (
    <div>
      {conceptos === null && !fallo && (
        <div className="space-y-2 py-1">{[1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
      )}
      {fallo && <p className="py-1 text-xs text-muted-foreground">No se pudieron cargar los conceptos de la ODC.</p>}
      {conceptos !== null && conceptos.length === 0 && <p className="py-1 text-xs text-muted-foreground">Esta ODC no tiene conceptos capturados.</p>}

      {visibles.length > 0 && (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {visibles.map(c => {
            const detalle = detalleCantidad(c, moneda);
            return (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{c.description || 'Sin descripción'}</p>
                  {detalle && <p className="font-mono text-[11px] text-muted-foreground">{detalle}</p>}
                </div>
                {/* un descuento (monto negativo) va en rojo */}
                <p className="shrink-0 font-mono text-[13px] font-semibold" style={c.total < 0 ? { color: PELIGRO } : undefined}>{fmtMonto(c.total, moneda)}</p>
              </li>
            );
          })}
        </ul>
      )}

      {listaLarga && (
        <button
          type="button"
          onClick={() => setExpandido(e => !e)}
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {expandido ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {expandido ? 'Ver menos' : `${plural(ocultos, 'concepto')} más`}
        </button>
      )}

      <div className="flex items-center justify-between pt-2.5">
        <span className="text-xs font-semibold text-muted-foreground">Total de la ODC</span>
        <span className="font-mono text-[13px] font-bold">{fmtMonto(total, moneda)}</span>
      </div>
    </div>
  );
}
