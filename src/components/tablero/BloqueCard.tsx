// Marco de un bloque del tablero: título, lo que lo distingue del resto del tablero (periodo, comparación o fecha propios) y, solo al editar, el asa para moverlo y
// los botones de editar, duplicar y quitar. Al ver, el bloque se muestra limpio.
import { Copy, ClipboardCopy, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { tablaComoTexto } from '@/lib/tablero/exportar';
import { FECHAS_ETIQUETA } from '@/lib/tablero/campos';
import { etiquetaComparacion, etiquetaPeriodo } from '@/lib/tablero/periodos';
import type { Bloque, Deal, Resultado } from '@/lib/tablero/tipos';
import type { AsaProps } from './Rejilla';
import { Visualizacion } from './visualizaciones';

interface Props {
  bloque: Bloque;
  res: Resultado;
  hoy: string;
  oscuro: boolean;
  editando: boolean;
  seleccionado: boolean;
  asa: AsaProps;
  onEditar: () => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onDetalle: (titulo: string, deals: Deal[]) => void;
}

const noArrastrar = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() };

export default function BloqueCard({ bloque, res, hoy, oscuro, editando, seleccionado, asa, onEditar, onDuplicar, onEliminar, onDetalle }: Props) {
  const c = bloque.consulta;
  // Lo que este bloque hace distinto del resto del tablero, a la vista para que no haya sorpresas.
  const propios: string[] = [];
  if (c.periodo) propios.push(etiquetaPeriodo(c.periodo, hoy));
  if (c.comparacion) propios.push(etiquetaComparacion(c.comparacion).toLowerCase());
  if (c.fecha) propios.push(`por ${FECHAS_ETIQUETA[c.fecha.campo].replace('Fecha de ', '')}`);
  if (c.filtros.length) propios.push(`${c.filtros.length} ${c.filtros.length === 1 ? 'filtro' : 'filtros'}`);
  // Hay comparación en el tablero pero este tipo de gráfica no la dibuja (pastel, dona, embudo, dispersión, o con cruce): se avisa en lugar de dejar creer que sí.
  const dibujaComparacion = bloque.tipo === 'kpi' || bloque.tipo === 'ranking' || (['barras', 'lineas', 'area', 'tabla'].includes(bloque.tipo) && !res.hayCruce);
  if (res.periodos.previo && !dibujaComparacion) propios.push('esta gráfica no compara');

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(tablaComoTexto(res, c.moneda ?? 'todas'));
      toast.success('Datos copiados');
    } catch {
      toast.error('No se pudieron copiar los datos');
    }
  };

  return (
    <div className={`group flex h-full flex-col overflow-hidden rounded-xl border bg-card ${editando ? 'border-dashed' : ''} ${seleccionado ? 'border-primary ring-2 ring-primary/40' : ''}`}>
      <div {...asa} className="flex min-h-[36px] items-center gap-1.5 px-3 pb-1 pt-2.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
        {editando && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <h3 className="min-w-0 truncate text-sm font-semibold" title={bloque.titulo}>{bloque.titulo}</h3>
        {propios.length > 0 && (
          <span className="hidden min-w-0 shrink truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline" title={propios.join(' · ')}>{propios.join(' · ')}</span>
        )}
        <div className={`ml-auto flex shrink-0 items-center gap-0.5 ${editando && !seleccionado ? 'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100' : ''}`}>
          {editando ? (
            <>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar bloque" aria-label="Editar bloque" onClick={onEditar} {...noArrastrar}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Duplicar" aria-label="Duplicar bloque" onClick={onDuplicar} {...noArrastrar}><Copy className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Quitar" aria-label="Quitar bloque" onClick={onEliminar} {...noArrastrar}><Trash2 className="h-3.5 w-3.5" /></Button>
            </>
          ) : (
            <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" title="Copiar los datos" aria-label="Copiar los datos" onClick={copiar}>
              <ClipboardCopy className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">
        <Visualizacion res={res} bloque={bloque} oscuro={oscuro} onDetalle={onDetalle} />
      </div>
    </div>
  );
}
