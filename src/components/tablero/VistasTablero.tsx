// Vistas guardadas del tablero: elegir una, guardar la actual con otro nombre, renombrar, dejarla como la que abre por defecto, quitarla, o traer una del dashboard anterior.
import { useState } from 'react';
import { Check, ChevronDown, Star } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

export interface VistaGuardada {
  dbId: string;
  viewId: string;
  viewName: string;
  isDefault: boolean;
  isShared: boolean;
  sortOrder: number;
  widgetsJson: string;
}

export interface VistaAnterior {
  viewId: string;
  viewName: string;
  filtersJson: string;
  widgetsJson: string;
  dateReference: string;
}

interface Props {
  vistas: VistaGuardada[];
  anteriores: VistaAnterior[];
  activaId: string | null;
  sinGuardar: boolean;
  onElegir: (v: VistaGuardada) => void;
  onGuardarComo: (nombre: string) => void;
  onRenombrar: (nombre: string) => void;
  onPredeterminada: () => void;
  onEliminar: () => void;
  onImportar: (v: VistaAnterior) => void;
}

type Pedido = null | 'guardarComo' | 'renombrar' | 'eliminar';

export default function VistasTablero({ vistas, anteriores, activaId, sinGuardar, onElegir, onGuardarComo, onRenombrar, onPredeterminada, onEliminar, onImportar }: Props) {
  const [pedido, setPedido] = useState<Pedido>(null);
  const [nombre, setNombre] = useState('');
  const activa = vistas.find(v => v.viewId === activaId);
  const pedir = (p: Pedido) => { setNombre(p === 'renombrar' ? activa?.viewName ?? '' : ''); setPedido(p); };
  const confirmar = () => {
    const limpio = nombre.trim();
    if (!limpio) return;
    if (pedido === 'guardarComo') onGuardarComo(limpio);
    if (pedido === 'renombrar') onRenombrar(limpio);
    setPedido(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <span className="max-w-[180px] truncate">{activa?.viewName ?? 'Vista sin guardar'}</span>
            {sinGuardar && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Hay cambios sin guardar" />}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {vistas.length > 0 && <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Mis vistas</DropdownMenuLabel>}
          {vistas.map(v => (
            <DropdownMenuItem key={v.viewId} onClick={() => onElegir(v)} className="gap-2 text-xs">
              {v.viewId === activaId ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
              <span className="min-w-0 flex-1 truncate">{v.viewName}</span>
              {v.isDefault && <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-label="Es la que abre por defecto" />}
            </DropdownMenuItem>
          ))}
          {vistas.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => pedir('guardarComo')} className="text-xs">Guardar como vista nueva…</DropdownMenuItem>
          {activa && <DropdownMenuItem onClick={() => pedir('renombrar')} className="text-xs">Cambiar el nombre…</DropdownMenuItem>}
          {activa && !activa.isDefault && <DropdownMenuItem onClick={onPredeterminada} className="text-xs">Que esta abra por defecto</DropdownMenuItem>}
          {activa && <DropdownMenuItem onClick={() => pedir('eliminar')} className="text-xs text-destructive focus:text-destructive">Eliminar esta vista…</DropdownMenuItem>}
          {anteriores.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Traer del dashboard anterior</DropdownMenuLabel>
              {anteriores.map(v => <DropdownMenuItem key={v.viewId} onClick={() => onImportar(v)} className="text-xs"><span className="truncate">{v.viewName}</span></DropdownMenuItem>)}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pedido === 'guardarComo' || pedido === 'renombrar'} onOpenChange={o => !o && setPedido(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{pedido === 'renombrar' ? 'Cambiar el nombre de la vista' : 'Guardar como vista nueva'}</DialogTitle></DialogHeader>
          <Input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirmar()} placeholder="Por ejemplo: Ventas 2026" maxLength={80} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPedido(null)}>Cancelar</Button>
            <Button onClick={confirmar} disabled={!nombre.trim()}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pedido === 'eliminar'} onOpenChange={o => !o && setPedido(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{activa?.viewName}»?</AlertDialogTitle>
            <AlertDialogDescription>La vista se borra para siempre. Los deals y el dashboard anterior no se tocan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onEliminar(); setPedido(null); }}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
