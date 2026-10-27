// Filtros del tablero y de cada bloque: fichas con lo que se está filtrando y un botón para agregar. Funciona con cualquier corte del registro (cliente, tipo, fase…):
// se elige el campo y luego los valores que existen en los deals, con cuántos deals tiene cada uno; se puede dejar solo eso o dejarlo fuera.
import { useMemo, useState } from 'react';
import { Filter, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DIMENSIONES, DIMENSIONES_ORDEN, valoresDe } from '@/lib/tablero/campos';
import type { Contexto, Deal, Filtro } from '@/lib/tablero/tipos';

interface Props {
  filtros: Filtro[];
  onChange: (f: Filtro[]) => void;
  deals: Deal[];
  ctx: Contexto;
  /** Con el título chico (en el panel de un bloque) en lugar del botón grande de la barra. */
  compacto?: boolean;
}

const CAMPOS = DIMENSIONES_ORDEN.filter(id => DIMENSIONES[id]?.tipo === 'categoria' && !['anio', 'trimestreAnio', 'mesAnio'].includes(id));

function resumen(f: Filtro): string {
  const v = f.valores.length <= 2 ? f.valores.join(', ') : `${f.valores.slice(0, 2).join(', ')} y ${f.valores.length - 2} más`;
  return `${DIMENSIONES[f.campo]?.etiqueta ?? f.campo}${f.excluir ? ' no es' : ':'} ${v}`;
}

function EditorFiltro({ campo, inicial, deals, ctx, onAplicar, onQuitar }: {
  campo: string; inicial?: Filtro; deals: Deal[]; ctx: Contexto; onAplicar: (f: Filtro) => void; onQuitar?: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [elegidos, setElegidos] = useState<string[]>(inicial?.valores ?? []);
  const [excluir, setExcluir] = useState(!!inicial?.excluir);
  const valores = useMemo(() => valoresDe(campo, deals, ctx), [campo, deals, ctx]);
  const visibles = valores.filter(v => v.valor.toLowerCase().includes(busqueda.toLowerCase()));
  const alternar = (v: string) => setElegidos(e => (e.includes(v) ? e.filter(x => x !== v) : [...e, v]));
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium">{DIMENSIONES[campo]?.etiqueta}</div>
      <Input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar…" className="h-8 text-xs" />
      <div className="max-h-52 space-y-0.5 overflow-auto">
        {visibles.length === 0 && <div className="py-3 text-center text-xs text-muted-foreground">Nada que coincida</div>}
        {visibles.map(v => (
          <label key={v.valor} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted">
            <Checkbox checked={elegidos.includes(v.valor)} onCheckedChange={() => alternar(v.valor)} className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{v.valor}</span>
            <span className="tabular-nums text-muted-foreground">{v.n}</span>
          </label>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
        <Checkbox checked={excluir} onCheckedChange={v => setExcluir(v === true)} className="h-3.5 w-3.5" /> Dejar fuera lo elegido
      </label>
      <div className="flex justify-between gap-2">
        {onQuitar ? <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={onQuitar}>Quitar filtro</Button> : <span />}
        <Button size="sm" className="h-8 text-xs" disabled={elegidos.length === 0} onClick={() => onAplicar({ campo, valores: elegidos, ...(excluir ? { excluir: true } : {}) })}>Aplicar</Button>
      </div>
    </div>
  );
}

export default function Filtros({ filtros, onChange, deals, ctx, compacto }: Props) {
  const [agregando, setAgregando] = useState(false);
  const [campoNuevo, setCampoNuevo] = useState<string | null>(null);
  const [editando, setEditando] = useState<number | null>(null);

  const reemplazar = (i: number, f: Filtro) => onChange(filtros.map((x, j) => (j === i ? f : x)));
  const quitar = (i: number) => onChange(filtros.filter((_, j) => j !== i));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filtros.map((f, i) => (
        <Popover key={`${f.campo}-${i}`} open={editando === i} onOpenChange={o => setEditando(o ? i : null)}>
          <span className="inline-flex items-center rounded-full border bg-card text-xs">
            <PopoverTrigger asChild>
              <button type="button" className="max-w-[240px] truncate rounded-l-full py-1 pl-2.5 pr-1.5 hover:bg-muted" title={resumen(f)}>{resumen(f)}</button>
            </PopoverTrigger>
            <button type="button" aria-label="Quitar filtro" className="rounded-r-full py-1 pl-0.5 pr-2 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => quitar(i)}><X className="h-3 w-3" /></button>
          </span>
          <PopoverContent align="start" className="w-64">
            <EditorFiltro campo={f.campo} inicial={f} deals={deals} ctx={ctx} onAplicar={nuevo => { reemplazar(i, nuevo); setEditando(null); }} onQuitar={() => { quitar(i); setEditando(null); }} />
          </PopoverContent>
        </Popover>
      ))}
      <Popover open={agregando} onOpenChange={o => { setAgregando(o); if (!o) setCampoNuevo(null); }}>
        <PopoverTrigger asChild>
          <Button variant={compacto ? 'ghost' : 'outline'} size="sm" className="h-8 gap-1 text-xs">
            {compacto ? <Plus className="h-3.5 w-3.5" /> : <Filter className="h-3.5 w-3.5" />} {filtros.length === 0 && !compacto ? 'Filtros' : 'Filtro'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          {campoNuevo ? (
            <EditorFiltro campo={campoNuevo} deals={deals} ctx={ctx} onAplicar={f => { onChange([...filtros, f]); setAgregando(false); setCampoNuevo(null); }} />
          ) : (
            <div className="space-y-0.5">
              <div className="px-1.5 pb-1 text-xs font-medium text-muted-foreground">Filtrar por</div>
              {CAMPOS.map(id => (
                <button key={id} type="button" className="w-full rounded px-1.5 py-1.5 text-left text-xs hover:bg-muted" onClick={() => setCampoNuevo(id)}>{DIMENSIONES[id].etiqueta}</button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
