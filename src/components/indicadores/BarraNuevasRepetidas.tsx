import { TRAMOS_REPETIDAS, etiquetaTramo, resumenDe } from '../../lib/indicadores/reclutadores';
import { fmtNum, fmtPct } from './formato';
import { COLORES_REPETIDA, COLOR_COMPARTIDO, COLOR_NUEVA } from './reclutadoresColores';

/** Una barra al 100 %: lo verde son las nuevas, lo ámbar las repetidas (más oscuro, más proyectos anteriores) y lo gris el contacto compartido. */
export function BarraNuevasRepetidas({ conteo, ancho = 'w-44' }: { conteo: ReadonlyArray<number>; ancho?: string }) {
  const r = resumenDe(conteo);
  if (r.total === 0) return <span className="text-muted-foreground">—</span>;
  const partes = [
    { n: r.nuevas, color: COLOR_NUEVA, titulo: 'Nuevas' },
    ...TRAMOS_REPETIDAS.map((t, i) => ({ n: r.repetidasPorTramo[i], color: COLORES_REPETIDA[i], titulo: `Repetidas con ${etiquetaTramo(t)}` })),
    { n: r.compartido, color: COLOR_COMPARTIDO, titulo: 'Contacto compartido' },
  ].filter((p) => p.n > 0);
  const resumen = `${fmtNum(r.nuevas)} nuevas, ${fmtNum(r.repetidas)} repetidas${r.compartido ? `, ${fmtNum(r.compartido)} de contacto compartido` : ''}`;
  return (
    <div className={`flex h-3 overflow-hidden rounded-full bg-muted ${ancho}`} role="img" aria-label={resumen}>
      {partes.map((p) => <i key={p.titulo} title={`${p.titulo}: ${fmtNum(p.n)} (${fmtPct((100 * p.n) / r.total)})`} style={{ width: `${(100 * p.n) / r.total}%`, backgroundColor: p.color }} />)}
    </div>
  );
}

export function LeyendaBarra() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLOR_NUEVA }} />Nuevas</span>
      <span className="font-medium text-foreground">Repetidas, con cuántos proyectos antes:</span>
      {TRAMOS_REPETIDAS.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLORES_REPETIDA[i] }} />{t >= 4 ? '4 o más' : t}</span>
      ))}
      <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLOR_COMPARTIDO }} />Contacto compartido</span>
    </span>
  );
}

/** «n (xx %)» de las respuestas ya clasificadas. */
export function CifraConPct({ n, pct }: { n: number; pct: number | null }) {
  return (
    <span className="tabular-nums">
      {fmtNum(n)}
      <span className="ml-1 text-xs text-muted-foreground">{pct === null ? '' : `(${fmtPct(pct)})`}</span>
    </span>
  );
}
