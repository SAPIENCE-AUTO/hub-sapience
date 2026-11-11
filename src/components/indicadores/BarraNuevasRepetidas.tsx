import { MAX_TRAMO, TRAMOS_REPETIDAS, etiquetaTramo, resumenDe, type ResumenConteo } from '../../lib/indicadores/reclutadores';
import { fmtNum, fmtPct } from './formato';
import { COLORES_REPETIDA, COLOR_COMPARTIDO, COLOR_NUEVA } from './reclutadoresColores';

/**
 * Una barra al 100 %: lo morado son las nuevas, lo ámbar las repetidas (más oscuro, más proyectos anteriores: de 1 a 8 o más) y lo gris el contacto compartido.
 * Delgada, con un hueco de 2 px entre las partes (no un borde) y todo el ancho de la celda donde va (debajo del nombre), entre un mínimo y un máximo.
 */
export function BarraNuevasRepetidas({ conteo, ancho = 'w-full min-w-[16rem] max-w-[34rem]' }: { conteo: ReadonlyArray<number>; ancho?: string }) {
  const r = resumenDe(conteo);
  if (r.total === 0) return <span className="text-muted-foreground">—</span>;
  const partes = [
    { n: r.nuevas, color: COLOR_NUEVA, titulo: 'Nuevas' },
    ...TRAMOS_REPETIDAS.map((t, i) => ({ n: r.repetidasPorTramo[i], color: COLORES_REPETIDA[i], titulo: `Repetidas con ${etiquetaTramo(t)}` })),
    { n: r.compartido, color: COLOR_COMPARTIDO, titulo: 'Contacto compartido' },
  ].filter((p) => p.n > 0);
  const resumen = `${fmtNum(r.nuevas)} nuevas, ${fmtNum(r.repetidas)} repetidas${r.compartido ? `, ${fmtNum(r.compartido)} de contacto compartido` : ''}`;
  return (
    <div className={`flex h-2 gap-[2px] overflow-hidden rounded-full ${ancho}`} role="img" aria-label={resumen}>
      {partes.map((p) => <i key={p.titulo} title={`${p.titulo}: ${fmtNum(p.n)} (${fmtPct((100 * p.n) / r.total)})`} style={{ flex: `${p.n} 1 0%`, backgroundColor: p.color }} />)}
    </div>
  );
}

export function LeyendaBarra() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLOR_NUEVA }} />Nuevas</span>
      <span className="font-medium text-foreground">Repetidas, con cuántos proyectos antes:</span>
      {TRAMOS_REPETIDAS.map((t, i) => (
        <span key={t} className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: COLORES_REPETIDA[i] }} />{t >= MAX_TRAMO ? `${MAX_TRAMO} o más` : t}</span>
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

/** Las respuestas de personas no elegibles: ya habían participado con el mismo cliente, o en los 6 meses anteriores al proyecto. */
export function CifraNoElegibles({ r }: { r: ResumenConteo }) {
  return (
    <span title="No elegibles: ya habían participado con el mismo cliente, o en cualquier proyecto en los 6 meses anteriores al proyecto donde se recibió la respuesta. No se mide en el contacto compartido.">
      <CifraConPct n={r.avisos} pct={r.pctAvisos} />
    </span>
  );
}

/** Las que terminaron en un grupo, y de ellas cuántas eran no elegibles. */
export function CifraEntraron({ r }: { r: ResumenConteo }) {
  return (
    <span title="Entraron a un grupo: asistieron, o están en un grupo, en alguno de los tableros donde está la respuesta.">
      <CifraConPct n={r.entraron} pct={r.pctEntraron} />
      {r.avisosQueEntraron > 0 && (
        <span className="block text-[11px] text-muted-foreground" title="De las que entraron a un grupo, cuántas eran no elegibles en el proyecto donde entraron (la misma cifra de «No elegibles que entraron» de Metas por área)">{fmtNum(r.avisosQueEntraron)} eran no elegibles</span>
      )}
    </span>
  );
}
