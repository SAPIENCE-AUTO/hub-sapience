import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { CLASE_BOTON_SUAVE, TEXTO_ALERTA } from '@/components/payments/estilos';
import { estadoDeDeal, type ResumenDeal } from '../../lib/pagosManagement/reparto';
import { COLOR_ESTADO_DEAL, COLOR_ESTADO_REPARTO, ETIQUETA_ESTADO, ETIQUETA_ESTADO_DEAL, fmtFecha, fmtMonto, fmtPct, fmtUnidades } from './formato';

const CODIGOS_VISIBLES = 3;

function BarraDeal({ resumen }: { resumen: ResumenDeal }) {
  const estado = estadoDeDeal(resumen);
  const color = COLOR_ESTADO_DEAL[estado];
  const moneda = resumen.deal.moneda;
  return (
    <div title={ETIQUETA_ESTADO_DEAL[estado]}>
      <div className="flex items-center gap-2">
        <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full" style={{ width: `${Math.min(resumen.porcentaje, 100)}%`, backgroundColor: color }} />
        </div>
        <span className="whitespace-nowrap text-xs font-semibold tabular-nums" style={{ color }}>{fmtPct(resumen.porcentaje)}</span>
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground" style={estado === 'excedido' ? { color: TEXTO_ALERTA } : undefined}>
        {estado === 'excedido' ? `Se pasa ${fmtMonto(-resumen.disponible, moneda)}` : estado === 'completo' ? 'Todo repartido' : `Quedan ${fmtMonto(resumen.disponible, moneda)}`}
      </p>
    </div>
  );
}

/**
 * Los deals con Management cotizado: cuánto de lo cotizado ya está repartido entre proyectos (el porcentaje) y qué proyectos lo forman. Tocar un renglón
 * muestra sus proyectos, con lo que se lleva cada uno; desde ahí se abre un proyecto o se le asigna otro al deal.
 */
export function TablaDeals({ resumenes, onAbrirProyecto, onAgregar, puedeAgregar }: {
  resumenes: ResumenDeal[];
  onAbrirProyecto: (projectId: string) => void;
  onAgregar: (dealId: string) => void;
  puedeAgregar: boolean;
}) {
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(new Set());
  const alternar = (id: string) => setAbiertos((actual) => {
    const nuevo = new Set(actual);
    if (nuevo.has(id)) nuevo.delete(id); else nuevo.add(id);
    return nuevo;
  });

  return (
    <div className="max-h-[620px] overflow-auto rounded-lg border">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead className="border-b">
          <tr>
            {['Deal', 'Cotizado', 'Repartido en proyectos', 'Proyectos'].map((t, i) => (
              <th key={t} scope="col" className={`sticky top-0 z-10 bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${i === 1 ? 'text-right' : 'text-left'}`}>{t}</th>
            ))}
            <th scope="col" className="sticky top-0 z-10 w-8 bg-card" />
          </tr>
        </thead>
        <tbody>
          {resumenes.map((r) => {
            const id = r.deal.dealId;
            const abierto = abiertos.has(id);
            return (
              <Fragment key={id}>
                <tr onClick={() => alternar(id)} className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <button type="button" aria-expanded={abierto} onClick={(e) => { e.stopPropagation(); alternar(id); }} className="text-left font-semibold hover:underline">{r.deal.nombre}</button>
                    {r.deal.cliente && <span className="ml-2 text-xs text-muted-foreground">{r.deal.cliente}</span>}
                    {(r.deal.unidades.length > 0 || r.deal.inicio) && (
                      <p className="mt-0.5 text-[11px] font-normal tabular-nums text-muted-foreground">
                        {[r.deal.inicio ? fmtFecha(r.deal.inicio) : '', fmtUnidades(r.deal.unidades, r.deal.moneda)].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtMonto(r.deal.cotizado, r.deal.moneda)}</td>
                  <td className="px-3 py-2.5"><BarraDeal resumen={r} /></td>
                  <td className="px-3 py-2.5">
                    {r.proyectos.length === 0 ? (
                      <span className="text-muted-foreground">Sin proyectos</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {r.proyectos.slice(0, CODIGOS_VISIBLES).map((p) => <span key={p.projectId} className="rounded-md bg-muted px-1.5 py-0.5 text-xs">{p.codigo}</span>)}
                        {r.proyectos.length > CODIGOS_VISIBLES && <span className="text-xs text-muted-foreground">+{r.proyectos.length - CODIGOS_VISIBLES}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-muted-foreground">{abierto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                </tr>
                {abierto && (
                  <tr className="border-b bg-muted/20 last:border-b-0">
                    <td colSpan={5} className="px-3 py-3">
                      {r.proyectos.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Todavía ningún proyecto se lleva management de este deal.</p>
                      ) : (
                        <ul className="max-w-xl divide-y rounded-lg border bg-card">
                          {r.proyectos.map((p) => (
                            <li key={p.projectId}>
                              <button type="button" onClick={() => onAbrirProyecto(p.projectId)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-muted/50">
                                <span className="min-w-0 flex-1 break-words font-semibold leading-tight">{p.codigo}</span>
                                <span className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-white" style={{ backgroundColor: COLOR_ESTADO_REPARTO[p.estadoReparto] }}>{ETIQUETA_ESTADO[p.estadoReparto]}</span>
                                <span className="min-w-[5rem] shrink-0 text-right font-semibold tabular-nums">{p.monto > 0 ? fmtMonto(p.monto, r.deal.moneda) : <span className="font-normal text-muted-foreground">Sin monto</span>}</span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {puedeAgregar && (
                        <div className="mt-2">
                          <button type="button" className={CLASE_BOTON_SUAVE} onClick={() => onAgregar(id)}><Plus className="h-3.5 w-3.5" />Agregar proyecto</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
