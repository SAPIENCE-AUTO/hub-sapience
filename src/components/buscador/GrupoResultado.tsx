import { useMemo, useState } from 'react';
import { filasQueCumplen, type GrupoHallado } from '../../lib/busqueda/agrupar';
import { capitalizar } from '../../lib/busqueda/texto';
import { fmtNum } from '../indicadores/formato';
import { etiquetaMes } from '../indicadores/graficas';
import { TEAL } from '../../lib/toolColors';

const MOSTRAR_AL_INICIO = 8;

/** «2026-01-15» → «ene 26». */
const mesDe = (fecha: string | null): string => (fecha && /^\d{4}-\d{2}/.test(fecha) ? etiquetaMes(fecha.slice(0, 7)) : '');

/**
 * Una forma de haber preguntado por el término, con los tableros donde se preguntó así. Explica cómo se preguntó (el nombre de la pregunta tal como está) y deja elegir qué respuestas cuentan: en una
 * pregunta por marca («Levité (Priorización marcas)») cada persona escogió una opción, y «los que la rechazan» son los que escogieron «No me gusta / no la compro».
 */
/** `termino` es el texto normalizado con el que se busca; `escrito`, como lo escribió la persona (con acentos), para mostrarlo. */
export function GrupoResultado({ grupo, termino, escrito }: { grupo: GrupoHallado; termino: string; escrito: string }) {
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(new Set());
  const [soloPrimero, setSoloPrimero] = useState(false);
  const [verTodos, setVerTodos] = useState(false);
  const hayPrimero = useMemo(() => grupo.donde === 'respuesta' && grupo.items.some((i) => i.valores.some((v) => v.primero != null && v.primero > 0 || /[,;\n|]/.test(v.valor))), [grupo]);

  const filas = useMemo(() => grupo.items
    .map((i) => ({ i, n: filasQueCumplen(grupo.donde, i, elegidas, soloPrimero, termino) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || (b.i.fechaInicio ?? '').localeCompare(a.i.fechaInicio ?? '')),
  [grupo, elegidas, soloPrimero, termino]);
  const total = filas.reduce((s, x) => s + x.n, 0);
  const maximo = filas[0]?.n ?? 1;
  const visibles = verTodos ? filas : filas.slice(0, MOSTRAR_AL_INICIO);

  const alternar = (valor: string) => setElegidas((e) => { const n = new Set(e); if (n.has(valor)) n.delete(valor); else n.add(valor); return n; });
  const esColumna = grupo.donde === 'columna';

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {esColumna ? `El nombre de la pregunta lleva «${escrito}»` : `«${escrito}» está en lo que contestaron`}
        </p>
        <h3 className="mt-0.5 text-sm font-semibold leading-snug">{grupo.ejemplo}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Se preguntó en {fmtNum(grupo.tableros)} {grupo.tableros === 1 ? 'tablero' : 'tableros'}
          {grupo.items.length < grupo.tableros ? ` (se muestran los ${fmtNum(grupo.items.length)} con más respuestas)` : ''}.
        </p>
      </header>

      <div className="grid gap-4 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-semibold">
            {esColumna ? 'Marca las respuestas que te sirven' : 'Lo que respondieron'}
          </legend>
          <ul className="space-y-1">
            {grupo.valores.slice(0, 12).map((v) => (
              <li key={v.valor}>
                {esColumna ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/50">
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[#0F3D4D]" checked={elegidas.has(v.valor)} onChange={() => alternar(v.valor)} />
                    <span className="min-w-0 flex-1 break-words">{capitalizar(v.etiqueta || v.valor)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtNum(v.filas)}</span>
                  </label>
                ) : (
                  <div className="flex items-start gap-2 px-1.5 py-1 text-xs">
                    <span className="min-w-0 flex-1 break-words">{capitalizar(v.etiqueta || v.valor)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{fmtNum(v.filas)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {grupo.valores.length > 12 && <p className="mt-1 px-1.5 text-[11px] text-muted-foreground">y {fmtNum(grupo.valores.length - 12)} respuestas más</p>}
          {!esColumna && hayPrimero && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 px-1.5 text-xs">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[#0F3D4D]" checked={soloPrimero} onChange={(e) => setSoloPrimero(e.target.checked)} />
              Solo cuando la ponen primero (la favorita)
            </label>
          )}
          {esColumna && elegidas.size > 0 && (
            <button type="button" onClick={() => setElegidas(new Set())} className="mt-2 px-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline">Quitar la selección</button>
          )}
        </fieldset>

        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-semibold">
            {esColumna && elegidas.size === 0 ? 'Filas que respondieron esta pregunta' : 'Filas que cumplen'}: {fmtNum(total)} en {fmtNum(filas.length)} {filas.length === 1 ? 'tablero' : 'tableros'}
          </p>
          {filas.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Ningún tablero cumple con lo que elegiste.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {visibles.map(({ i, n }) => (
                <li key={`${i.tableroId}|${i.columnaId}`} className="px-3 py-2 text-xs">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-semibold" title={`${i.proyecto ?? ''} · ${i.tablero}`}>{i.proyecto ?? 'Sin proyecto'}</span>
                    <span className="shrink-0 tabular-nums font-semibold">{fmtNum(n)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="min-w-0 truncate">{i.tablero}</span>
                    {i.cliente && <span>{i.cliente}</span>}
                    {mesDe(i.fechaInicio) && <span>{mesDe(i.fechaInicio)}</span>}
                    {esColumna && elegidas.size > 0 && <span>de {fmtNum(i.respondieron)} que respondieron</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * n) / maximo)}%`, backgroundColor: TEAL }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {filas.length > MOSTRAR_AL_INICIO && (
            <button type="button" onClick={() => setVerTodos((v) => !v)} className="mt-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline">
              {verTodos ? 'Ver menos' : `Ver los ${fmtNum(filas.length - MOSTRAR_AL_INICIO)} tableros que faltan`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
