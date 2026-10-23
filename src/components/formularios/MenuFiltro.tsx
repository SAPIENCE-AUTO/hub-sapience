import { toast } from 'sonner';
import { Copy, CopyPlus, ExternalLink, History, LayoutList, MoreHorizontal, Redo2, Trash2, Undo2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Editor } from './editor/useEditorFiltro';
import type { EstadoEditable } from './EstadoFiltro';

/**
 * El menú «⋯» del filtro: lo que no se usa a cada rato, en un solo lugar
 * (deshacer, estructura, versiones, el enlace, cambiar de estado, borrar).
 */
export function MenuFiltro({ editor, estado, enlace, uso, escribiendo, onEstado, onEstructura, onVersiones, onDuplicar, onBorrar }: {
  editor: Editor;
  estado: string;
  enlace: string;
  /** Uso de la IA en la hora, si el filtro tiene IA. */
  uso?: { usadas: number; limite: number };
  escribiendo?: boolean;
  onEstado: (e: EstadoEditable) => void;
  onEstructura?: () => void;
  onVersiones: () => void;
  onDuplicar: () => void;
  /** Solo si no tiene respuestas reales. */
  onBorrar?: () => void;
}) {
  const icono = 'mr-2 h-4 w-4';
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Más opciones del filtro" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-[#0F3D4D]">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem disabled={!editor.puedeDeshacer} onSelect={editor.deshacer}><Undo2 className={icono} />Deshacer<span className="ml-auto text-xs text-muted-foreground">⌘Z</span></DropdownMenuItem>
        <DropdownMenuItem disabled={!editor.puedeRehacer} onSelect={editor.rehacer}><Redo2 className={icono} />Rehacer<span className="ml-auto text-xs text-muted-foreground">⌘⇧Z</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        {onEstructura && <DropdownMenuItem disabled={escribiendo} onSelect={onEstructura}><LayoutList className={icono} />Ver y ajustar la estructura</DropdownMenuItem>}
        <DropdownMenuItem onSelect={onVersiones}><History className={icono} />Versiones</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDuplicar}><CopyPlus className={icono} />Duplicar</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(enlace); toast.success('Enlace copiado'); }}><Copy className={icono} />Copiar enlace</DropdownMenuItem>
        <DropdownMenuItem disabled={estado === 'borrador'} onSelect={() => window.open(enlace, '_blank')}><ExternalLink className={icono} />Abrir enlace</DropdownMenuItem>
        {estado === 'prueba' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onEstado('borrador')}>Volver a borrador</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEstado('cerrado')}>Cerrar (ya no recibe respuestas)</DropdownMenuItem>
          </>
        )}
        {onBorrar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[#D32222] focus:text-[#D32222]" onSelect={onBorrar}><Trash2 className={icono} />Borrar filtro</DropdownMenuItem>
          </>
        )}
        {uso && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">IA: {uso.usadas} de {uso.limite} esta hora</DropdownMenuLabel>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
