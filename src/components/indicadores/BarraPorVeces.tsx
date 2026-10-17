import { VECES, etiquetaVeces, type PorVeces } from '../../lib/indicadores/reclutamiento';
import { fmtNum, fmtPct } from './formato';

/**
 * Una barra de un proyecto: su largo es el porcentaje de quienes entraron que son de este grupo, y por dentro va partida en colores según
 * cuántas veces ya habían participado (de claro a oscuro). `tope` es el porcentaje que ocupa la barra completa; todas las barras de la
 * tabla comparten el mismo, para poder compararlas. La raya es la meta total, si hay.
 */
export function BarraPorVeces({ conteos, total, colores, tope, metaPct }: {
  conteos: PorVeces;
  /** Cuántas personas entraron al proyecto (el 100 %). */
  total: number;
  colores: string[];
  tope: number;
  metaPct?: number;
}) {
  const suma = VECES.reduce((s, v) => s + conteos[v], 0);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3.5 min-w-[90px] flex-1">
        <div className="absolute inset-0 flex overflow-hidden rounded-[3px] bg-muted">
          {VECES.map((v) => conteos[v] > 0 && (
            <div
              key={v}
              title={`${etiquetaVeces(v)}: ${fmtNum(conteos[v])} ${conteos[v] === 1 ? 'persona' : 'personas'}`}
              style={{ width: `${(((100 * conteos[v]) / total) / tope) * 100}%`, backgroundColor: colores[v - 1] }}
            />
          ))}
        </div>
        {metaPct !== undefined && (
          <div className="absolute -bottom-0.5 -top-0.5 w-px bg-foreground/70" style={{ left: `${(metaPct / tope) * 100}%` }} title={`Meta total: ${fmtPct(metaPct)}`} />
        )}
      </div>
      <span className="min-w-[76px] text-right text-xs tabular-nums">
        <b className="font-semibold">{fmtNum(suma)}</b>
        <span className="text-muted-foreground"> · {fmtPct(total > 0 ? (100 * suma) / total : null)}</span>
      </span>
    </div>
  );
}
