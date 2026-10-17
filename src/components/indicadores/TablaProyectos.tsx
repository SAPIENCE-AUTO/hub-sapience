import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { estadoMeta, type Previas, type ProyectoReclutamiento } from '../../lib/indicadores/reclutamiento';
import { PELIGRO } from '../../lib/toolColors';
import { fmtFecha, fmtNum, fmtPct } from './formato';

type Columna = 'proyecto' | 'fecha' | 'entraron' | 'noElegibles' | 'repetidores' | 'duplicados';

const pct = (parte: number, total: number) => (total > 0 ? (100 * parte) / total : null);

/** Cuántas personas que entraron en cada proyecto fueron no elegibles, repetidoras o duplicadas. Se ordena tocando el encabezado. */
export function TablaProyectos({ proyectos, previas, metaNoElegibles }: {
  proyectos: ProyectoReclutamiento[];
  previas: Previas;
  metaNoElegibles: number | undefined;
}) {
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: 'noElegibles', asc: false });

  const filas = useMemo(() => {
    const conGente = proyectos.filter((p) => p.participaron > 0).map((p) => ({
      ...p,
      pctNoElegibles: pct(p.noElegibles, p.participaron),
      repetidores: p.previas[previas],
      pctRepetidores: pct(p.previas[previas], p.participaron),
      pctDuplicados: pct(p.duplicados, p.participaron),
    }));
    const valor = (f: (typeof conGente)[number]): number | string => {
      switch (orden.col) {
        case 'proyecto': return f.codigo;
        case 'fecha': return f.fecha;
        case 'entraron': return f.participaron;
        case 'noElegibles': return f.pctNoElegibles ?? -1;
        case 'repetidores': return f.pctRepetidores ?? -1;
        case 'duplicados': return f.pctDuplicados ?? -1;
      }
    };
    return [...conGente].sort((a, b) => {
      const x = valor(a), y = valor(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (orden.asc ? c : -c) || a.codigo.localeCompare(b.codigo);
    });
  }, [proyectos, previas, orden]);

  const encabezado = (col: Columna, texto: string, derecha = true) => (
    <th scope="col" className={`sticky top-0 z-10 bg-card px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${derecha ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setOrden((o) => ({ col, asc: o.col === col ? !o.asc : col === 'proyecto' || col === 'fecha' }))} className="inline-flex items-center gap-1 hover:text-foreground">
        {texto}
        {orden.col === col && (orden.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  if (filas.length === 0) return <p className="text-xs text-muted-foreground">Sin proyectos con personas en este periodo.</p>;

  return (
    <div className="max-h-[520px] overflow-auto rounded-lg border">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead className="border-b">
          <tr>
            {encabezado('proyecto', 'Proyecto', false)}
            {encabezado('fecha', 'Inicio')}
            {encabezado('entraron', 'Entraron')}
            {encabezado('noElegibles', 'No elegibles')}
            {encabezado('repetidores', `Con ${previas}+ previas`)}
            {encabezado('duplicados', 'Duplicados')}
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
  );
}
