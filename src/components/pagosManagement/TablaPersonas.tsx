import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AcumuladoPersona } from '../../lib/pagosManagement/reparto';
import { fmtMonto, fmtMontos, fmtPct } from './formato';

/** Lo que lleva acumulado cada persona; al tocar un renglón se ve de qué proyectos sale. */
export function TablaPersonas({ personas }: { personas: AcumuladoPersona[] }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="max-h-[620px] overflow-auto rounded-lg border">
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead className="border-b">
          <tr>
            <th scope="col" className="sticky top-0 z-10 w-8 bg-card" />
            <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Persona</th>
            <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Proyectos</th>
            <th scope="col" className="sticky top-0 z-10 bg-card px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Acumulado</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((p) => {
            const esta = abierta === p.clave;
            return (
              <Fragment key={p.clave}>
                <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={() => setAbierta(esta ? null : p.clave)}>
                  <td className="px-2 py-2.5 text-muted-foreground">{esta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" aria-expanded={esta} onClick={(e) => { e.stopPropagation(); setAbierta(esta ? null : p.clave); }} className="text-left font-semibold">{p.nombre}</button>
                    {p.externo && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Externa</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.proyectos}</td>
                  <td className="px-3 py-2.5 text-right text-[15px] font-bold tabular-nums">{fmtMontos(p.porMoneda)}</td>
                </tr>
                {esta && p.detalle.map((d) => (
                  <tr key={`${p.clave}-${d.codigo}`} className="border-b bg-muted/30 text-xs">
                    <td />
                    <td className="px-3 py-1.5">
                      <span className="font-semibold">{d.codigo}</span>
                      {d.cliente && <span className="ml-2 text-muted-foreground">{d.cliente}</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtPct(d.porcentaje)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmtMonto(d.monto, d.moneda)}</td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
