import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { VECES, etiquetaVeces, type PorVeces, type ProyectoReclutamiento } from '../../lib/indicadores/reclutamiento';
import { BarraPorVeces } from './BarraPorVeces';
import { AZUL, ROJO } from './colores';
import { fmtFecha, fmtNum } from './formato';

type Columna = 'proyecto' | 'fecha' | 'entraron' | 'noElegibles' | 'elegibles' | 'duplicados';

/** Con menos gente que esto el porcentaje engaña (5 de 6 es 83 %), así que esos proyectos se esconden salvo que se pidan. */
export const MIN_PERSONAS = 10;

const sumaVeces = (a: PorVeces | undefined) => (a ? VECES.reduce((s, v) => s + a[v], 0) : 0);
const CEROS: PorVeces = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

function Leyenda({ nombre, colores }: { nombre: string; colores: string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-[230px] font-medium text-foreground">{nombre}</span>
      {VECES.map((v) => (
        <span key={v} className="inline-flex items-center gap-1">
          <i className="h-3 w-3 rounded-sm" style={{ backgroundColor: colores[v - 1] }} />
          {etiquetaVeces(v)}
        </span>
      ))}
    </span>
  );
}

/**
 * Cada proyecto con dos barras de quienes entraron: los no elegibles (rojo) y los elegibles que ya habían participado (azul), cada una
 * partida en colores por cuántas veces habían participado. Se ordena tocando el encabezado.
 */
export function TablaProyectos({ proyectos, metaNoElegibles }: {
  proyectos: ProyectoReclutamiento[];
  /** La meta total de no elegibles (en %), que se marca con una raya en esa barra. */
  metaNoElegibles: number | undefined;
}) {
  // Primero el que más personas metió sin deber: el número, no el porcentaje.
  const [orden, setOrden] = useState<{ col: Columna; asc: boolean }>({ col: 'noElegibles', asc: false });
  const [verTodos, setVerTodos] = useState(false);

  const conGente = useMemo(() => proyectos.filter((p) => p.participaron > 0), [proyectos]);
  const ocultos = conGente.filter((p) => p.participaron < MIN_PERSONAS).length;

  const { filas, tope } = useMemo(() => {
    const visibles = conGente.filter((p) => verTodos || p.participaron >= MIN_PERSONAS).map((p) => ({
      ...p,
      noEleg: p.noElegiblesPorVeces ?? CEROS,
      eleg: p.elegiblesPorVeces ?? CEROS,
      cuantosElegibles: sumaVeces(p.elegiblesPorVeces),
    }));
    const valor = (f: (typeof visibles)[number]): number | string => {
      switch (orden.col) {
        case 'proyecto': return f.codigo;
        case 'fecha': return f.fecha;
        case 'entraron': return f.participaron;
        case 'noElegibles': return f.noElegibles;
        case 'elegibles': return f.cuantosElegibles;
        case 'duplicados': return f.duplicados;
      }
    };
    const ordenadas = [...visibles].sort((a, b) => {
      const x = valor(a), y = valor(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return (orden.asc ? c : -c) || a.codigo.localeCompare(b.codigo);
    });
    // Todas las barras comparten la misma escala (el porcentaje más alto que se vea o la meta), para poder compararlas.
    const mayor = Math.max(5, metaNoElegibles ?? 0, ...visibles.map((f) => (100 * Math.max(f.noElegibles, f.cuantosElegibles)) / f.participaron));
    return { filas: ordenadas, tope: mayor * 1.08 };
  }, [conGente, verTodos, orden, metaNoElegibles]);

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
      <div className="mb-2 space-y-1 text-xs text-muted-foreground">
        <p>Cada barra es el porcentaje de quienes entraron al proyecto; los colores dicen cuántas veces ya habían participado.</p>
        <Leyenda nombre="No elegibles" colores={ROJO} />
        <Leyenda nombre="Elegibles que ya habían participado" colores={AZUL} />
      </div>
      {ocultos > 0 && (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} className="h-3.5 w-3.5 accent-[#0F3D4D]" />
          {verTodos ? 'Mostrando también' : 'Mostrar también'} los {fmtNum(ocultos)} proyectos con menos de {MIN_PERSONAS} personas
        </label>
      )}
      {filas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Ningún proyecto de este periodo llega a {MIN_PERSONAS} personas.</p>
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-lg border">
          <table className="w-full min-w-[900px] border-collapse text-[13px]">
            <thead className="border-b">
              <tr>
                {encabezado('proyecto', 'Proyecto', false)}
                {encabezado('fecha', 'Inicio')}
                {encabezado('entraron', 'Entraron')}
                {encabezado('noElegibles', 'No elegibles', false)}
                {encabezado('elegibles', 'Elegibles que ya habían participado', false)}
                {encabezado('duplicados', 'Filas repetidas')}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.codigo} className="border-b last:border-b-0 hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <span className="font-semibold">{f.codigo}</span>
                    {f.cliente && <span className="ml-2 text-xs text-muted-foreground">{f.cliente}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground" title={f.inferida ? 'El proyecto no tiene fecha de inicio: se usó la de su última actividad' : undefined}>
                    {fmtFecha(f.fecha)}{f.inferida && '*'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.participaron)}</td>
                  <td className="w-[28%] px-3 py-2"><BarraPorVeces conteos={f.noEleg} total={f.participaron} colores={ROJO} tope={tope} metaPct={metaNoElegibles} /></td>
                  <td className="w-[28%] px-3 py-2"><BarraPorVeces conteos={f.eleg} total={f.participaron} colores={AZUL} tope={tope} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(f.duplicados)} <span className="text-xs text-muted-foreground">· {((100 * f.duplicados) / f.participaron).toFixed(1)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
