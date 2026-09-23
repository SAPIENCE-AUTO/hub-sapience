import { useState, useEffect } from 'react';
import { linkProjectDeal, getDeals } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { RUBROS } from '../commercial/dealUtils';

interface Props {
  projectId: string;
  currentDealId?: string;
  currentVisibleRubros: string[] | null;
  onLinked: () => void;
}

// Diálogo exclusivo de Sergio (el botón que lo abre solo se renderiza para su
// email, ver ProjectBudgetTab.tsx) para vincular un proyecto a un deal y, de
// paso, decidir explícitamente qué rubros de presupuesto quedan visibles para
// quien tenga ese rubro asignado — antes la visibilidad era 100% global por
// usuario (cotizacionRubros), sin ningún control por proyecto.
export default function LinkProjectDealDialog({ projectId, currentDealId, currentVisibleRubros, onLinked }: Props) {
  const [open, setOpen] = useState(false);
  const [deals, setDeals] = useState<{ id: string; dealName?: string }[]>([]);
  const [dealId, setDealId] = useState(currentDealId ?? '');
  const [visible, setVisible] = useState<Set<string>>(new Set(currentVisibleRubros ?? []));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getDeals({}).then(d => setDeals(d.deals)).catch(() => {});
    setDealId(currentDealId ?? '');
    // Todos apagados por default al abrir — Sergio prende explícitamente los
    // que quiere mostrar, en vez de tener que apagar los que no quiere.
    setVisible(new Set(currentVisibleRubros ?? []));
  }, [open, currentDealId, currentVisibleRubros]);

  const toggleRubro = (r: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await linkProjectDeal({ projectId, dealId: dealId || undefined, visibleRubros: [...visible] });
      toast.success('Deal vinculado');
      setOpen(false);
      onLinked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al vincular el deal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Link2 className="w-3.5 h-3.5" />
        {currentDealId ? 'Cambiar vínculo con Deal' : 'Vincular a Deal'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular proyecto a un Deal</DialogTitle>
            <DialogDescription>
              Elige el deal y qué rubros de presupuesto son visibles aquí. Los Owners, Socios y Finanzas siempre ven todo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Deal</label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger><SelectValue placeholder="Selecciona un deal..." /></SelectTrigger>
                <SelectContent>
                  {deals.map(d => <SelectItem key={d.id} value={d.id}>{d.dealName ?? '(sin nombre)'}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Rubros visibles para este proyecto</label>
              <div className="space-y-2 rounded-lg border p-3">
                {RUBROS.map(r => (
                  <div key={r} className="flex items-center justify-between">
                    <span className="text-sm">{r}</span>
                    <Switch checked={visible.has(r)} onCheckedChange={() => toggleRubro(r)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !dealId}>{saving ? 'Guardando...' : 'Guardar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
