import { estadoMeta, type PuntoTrimestre } from '../../lib/indicadores/reclutamiento';
import { TEAL } from '../../lib/toolColors';
import { COLOR_META } from './TarjetaIndicador';
import { fmtNum, fmtPct } from './formato';

/**
 * «No elegibles que entran» trimestre por trimestre: una barra por trimestre (más corta es mejor), con una raya donde está la meta.
 * La barra va verde si ese trimestre cumplió la meta y roja si no; sin meta, teal.
 */
export function TendenciaTrimestral({ puntos, meta }: { puntos: PuntoTrimestre[]; meta: number | undefined }) {
  if (puntos.length === 0) return <p className="text-xs text-muted-foreground">Sin proyectos en este periodo.</p>;
  const tope = Math.max(1, meta ?? 0, ...puntos.map((p) => p.pct ?? 0)) * 1.08;
  return (
    <div className="space-y-2">
      {puntos.map((p) => {
        const estado = estadoMeta(p.pct, meta, 'menos');
        const color = estado === 'sinMeta' ? TEAL : COLOR_META[estado];
        return (
          <div key={p.trimestre} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 text-xs">
            <span className="font-semibold text-muted-foreground">{p.trimestre}</span>
            <div className="relative h-5 rounded bg-muted">
              <div className="h-full rounded" style={{ width: `${((p.pct ?? 0) / tope) * 100}%`, backgroundColor: color }} />
              {meta !== undefined && (
                <div className="absolute -top-1 -bottom-1 w-px bg-foreground/70" style={{ left: `${(meta / tope) * 100}%` }} title={`Meta: ${fmtPct(meta)}`} />
              )}
            </div>
            <span className="min-w-[120px] text-right tabular-nums">
              <span className="font-bold" style={{ color }}>{fmtPct(p.pct)}</span>
              <span className="ml-1.5 text-muted-foreground">{fmtNum(p.noElegibles)} de {fmtNum(p.participaron)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
