import { AlertTriangle, ChevronRight } from 'lucide-react';
import { costoDealDe, esEditado, estadoReparto, etiquetaRubros, montosDe, presupuestoDe, sumaPorcentajes, type ProyectoManagement } from '../../lib/pagosManagement/reparto';
import { COLOR_ESTADO_REPARTO, ETIQUETA_ESTADO, fmtFecha, fmtMonto, fmtPct } from './formato';

const PERSONAS_VISIBLES = 3;

function BarraReparto({ proyecto }: { proyecto: ProyectoManagement }) {
  const estado = estadoReparto(proyecto.personas);
  const color = COLOR_ESTADO_REPARTO[estado];
  if (estado === 'sinRepartir') {
    return <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-4 text-white" style={{ backgroundColor: color }}>{ETIQUETA_ESTADO[estado]}</span>;
  }
  const suma = sumaPorcentajes(proyecto.personas);
  return (
    <div className="flex items-center gap-2" title={ETIQUETA_ESTADO[estado]}>
      <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${Math.min(suma, 100)}%`, backgroundColor: color }} />
      </div>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold tabular-nums" style={{ color }}>
        {estado === 'excedido' && <AlertTriangle className="h-3 w-3" aria-label="Se pasa de 100 %" />}
        {fmtPct(suma)}
      </span>
    </div>
  );
}

/** Los proyectos con su presupuesto, cuánto va repartido y entre quién. Tocar un renglón abre el reparto. */
export function TablaRepartos({ proyectos, onAbrir }: { proyectos: ProyectoManagement[]; onAbrir: (p: ProyectoManagement) => void }) {
  return (
    <div className="max-h-[620px] overflow-auto rounded-lg border">
      <table className="w-full min-w-[820px] border-collapse text-[13px]">
        <thead className="border-b">
          <tr>
            {['Proyecto', 'Inicio', 'Presupuesto', 'Repartido', 'Personas'].map((t, i) => (
              <th key={t} scope="col" className={`sticky top-0 z-10 bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${i === 2 ? 'text-right' : 'text-left'}`}>{t}</th>
            ))}
            <th scope="col" className="sticky top-0 z-10 w-8 bg-card" />
          </tr>
        </thead>
        <tbody>
          {proyectos.map((p) => {
            const base = presupuestoDe(p);
            const montos = montosDe(base, p.personas);
            const editado = esEditado(p); // cambiado respecto a lo que dice el deal, donde el deal dice algo
            const delDeal = p.rubros.reduce((suma, r) => suma + costoDealDe(p.rubrosDeal, r.rubro), 0);
            const soloManagement = p.rubros.length === 1 && p.rubros[0].rubro === 'Management';
            return (
              <tr
                key={p.repartoId ?? p.projectId ?? p.codigo}
                onClick={p.eliminado ? undefined : () => onAbrir(p)}
                className={`border-b last:border-b-0 ${p.eliminado ? 'opacity-70' : 'cursor-pointer hover:bg-muted/40'}`}
              >
                <td className="px-3 py-2.5">
                  {p.eliminado ? (
                    <span className="font-semibold">{p.codigo}</span>
                  ) : (
                    <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(p); }} className="text-left font-semibold hover:underline" title={p.nombre}>{p.codigo}</button>
                  )}
                  {p.cliente && <span className="ml-2 text-xs text-muted-foreground">{p.cliente}</span>}
                  {p.eliminado && <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Proyecto eliminado</span>}
                  {!p.eliminado && <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">{p.dealNombre ? `Deal: ${p.dealNombre}` : 'Sin deal'}</p>}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{p.inicio ? fmtFecha(p.inicio) : '—'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {base > 0 ? (
                    <span className="font-semibold" title={editado ? `El deal dice ${fmtMonto(delDeal, p.monedaDeal)}` : undefined}>{fmtMonto(base, p.moneda)}</span>
                  ) : (
                    <span className="text-muted-foreground">Sin monto</span>
                  )}
                  {editado && <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Editado</span>}
                  {!soloManagement && <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">{etiquetaRubros(p.rubros)}</p>}
                </td>
                <td className="px-3 py-2.5"><BarraReparto proyecto={p} /></td>
                <td className="px-3 py-2.5">
                  {p.personas.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      {p.personas.slice(0, PERSONAS_VISIBLES).map((persona, i) => (
                        <span key={persona.id ?? persona.nombre} className="rounded-md bg-muted px-1.5 py-0.5 text-xs" title={`${persona.nombre}: ${fmtPct(persona.porcentaje)} · ${fmtMonto(montos[i], p.moneda)}${persona.externo ? ' (externa)' : ''}`}>
                          {persona.nombre.split(' ')[0]}
                          <span className="ml-1 tabular-nums text-muted-foreground">{fmtPct(persona.porcentaje)}</span>
                        </span>
                      ))}
                      {p.personas.length > PERSONAS_VISIBLES && (
                        <span className="text-xs text-muted-foreground" title={p.personas.slice(PERSONAS_VISIBLES).map((x) => x.nombre).join(', ')}>+{p.personas.length - PERSONAS_VISIBLES}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2.5 text-muted-foreground">{!p.eliminado && <ChevronRight className="h-4 w-4" />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
