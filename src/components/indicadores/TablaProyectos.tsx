import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { estadoMeta, type Previas, type ProyectoReclutamiento } from '../../lib/indicadores/reclutamiento';
import { PELIGRO } from '../../lib/toolColors';
import { fmtFecha, fmtNum, fmtPct } from './formato';

type Columna = 'proyecto' | 'fecha' | 'entraron' | 'noElegibles' | 'repetidores' | 'duplicados';

/** Con menos gente que esto el porcentaje engaña (5 de 6 es 83 %), así que esos proyectos se esconden salvo que se pidan. */
export const MIN_PERSONAS = 10;

const pct = (parte: number, total: number) => (total > 0 ? (100 * parte) / total : null);

/** Cuántas personas que entraron en cada proyecto no debían, venían de varios proyectos o están repetidas. Se ordena tocando el encabezado. */
export function TablaProyectos({ proyectos, previas, metaNoElegibles }: {
  proyectos: ProyectoReclutamiento[];
  previas: Previas;
  metaNoElegibles: number | undefined;
}) {
  // Primero el que más personas metió sin deber: el número, no el porcentaje.
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: 'noElegibles', asc: false });
  const [verTodos, setVerTodos] = useState(false);

  const conGente = useMemo(() => proyectos.filter((p) => p.participaron > 0), [proyectos]);
  const ocultos = conGente.filter((p) => p.participaron < MIN_PERSONAS).length;

  const filas = useMemo(() => {
    const visibles = conGente.filter((p) => verTodos || p.participaron >= MIN_PERSONAS).map((p) => ({
      ...p,
      pctNoElegibles: pct(p.noElegibles, p.participaron),
      repetidores: p.previas[previas],
      pctRepetidores: pct(p.previas[previas], p.participaron),
      pctDuplicados: pct(p.duplicados, p.participaron),
    }));
    const valor = (f: (typeof visibles)[number]): number | string => {
      switch (orden.col) {
        case 'proyecto': return f.codigo;
        case 'fecha': return f.fecha;
        case 'entraron': return f.participaron;
        case 'noElegibles': return f.noElegibles;
        case 'repetidores': return f.repetidores;
        case 'duplicados': return f.duplicados;
      }
    };
    return [...visibles].sort((a, b) => {
      const x = valor(a), y = valor(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (orden.asc ? c : -c) || a.codigo.localeCompare(b.codigo);
    });
  }, [conGente, verTodos, previas, orden]);

  const encabezado = (col: Columna, texto: string, derecha = true) => (
    <th scope="col" className={`sticky top-0 z-10 bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${derecha ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setOrden((o) => ({ col, asc: o.col === col ? !o.asc : col === 'proyecto' || col === 'fecha' }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {texto}
        {orden.col === col && (orden.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  if (conGente.length === 0) return <p className="text-xs text-muted-foreground">Sin proyectos con personas en este periodo.</p>;

  return (
    <div>
      {ocultos > 0 && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} className="h-3.5 w-3.5 accent-[#0F3D4D]" />
          {verTodos ? 'Mostrando también' : 'Mostrar también'} los {fmtNum(ocultos)} proyectos con menos de {MIN_PERSONAS} personas
        </label>
      )}
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ningún proyecto de este periodo llega a {MIN_PERSONAS} personas.</p>
      ) : (
        <div className="max-h-[520px] overflow-auto rounded-lg border">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead className="border-b">
              <tr>
                {encabezado('proyecto', 'Proyecto', false)}
                {encabezado('fecha', 'Inicio')}
                {encabezado('entraron', 'Entraron a grupo')}
                {encabezado('noElegibles', 'No debían entrar')}
                {encabezado('repetidores', `Venían de ${previas}+ proyectos`)}
                {encabezado('duplicados', 'Filas repetidas')}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const fuera = estadoMeta(f.pctNoElegibles, metaNoElegibles, 'menos') === 'fuera';
                return (
                  <tr key={f.codigo} className="border-b last:border-b-0 hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <span className="font-semibold">{f.codigo}</span>
                      {f.cliente && <span className="ml-2 text-xs text-muted-foreground">{f.cliente}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground" title={f.inferida ? 'El proyecto no tiene fecha de inicio: se usó la de su última actividad' : undefined}>
                      {fmtFecha(f.fecha)}{f.inferida && '*'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.participaron)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={fuera ? { color: PELIGRO, fontWeight: 700 } : undefined}>
                      {fmtNum(f.noElegibles)} <span className="text-xs opacity-80">· {fmtPct(f.pctNoElegibles)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.repetidores)} <span className="text-xs text-muted-foreground">· {fmtPct(f.pctRepetidores)}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.duplicados)} <span className="text-xs text-muted-foreground">· {fmtPct(f.pctDuplicados)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
