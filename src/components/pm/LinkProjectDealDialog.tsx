import { useState, useEffect } from 'react';
import { linkProjectDeal, getDeals } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  projectId: string;
  currentDealId?: string;
  onLinked: () => void;
}

// Diálogo exclusivo de Sergio (el botón que lo abre solo se renderiza para su
// email, ver ProjectBudgetTab.tsx) para elegir a qué deal se vincula el
// proyecto. Sep 2026: qué rubros/sub-rubros de presupuesto son visibles ya no
// se configura aquí — son switches directamente en la pestaña Presupuesto
// (ProjectBudgetTab.tsx), una vez que el deal ya está vinculado y se conocen
// sus líneas reales — este diálogo solo decide el vínculo en sí.
export default function LinkProjectDealDialog({ projectId, currentDealId, onLinked }: Props) {
  const [open, setOpen] = useState(false);
  const [deals, setDeals] = useState<{ id: string; dealName?: string }[]>([]);
  const [dealId, setDealId] = useState(currentDealId ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getDeals({}).then(d => setDeals(d.deals)).catch(() => {});
    setDealId(currentDealId ?? '');
  }, [open, currentDealId]);

  const save = async () => {
    setSaving(true);
    try {
      await linkProjectDeal({ projectId, dealId: dealId || undefined });
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
              Una vez vinculado, podrás elegir qué rubros o líneas de presupuesto son visibles directamente en la pestaña Presupuesto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Deal</label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger><SelectValue placeholder="Selecciona un deal..." /></SelectTrigger>
              <SelectContent>
                {deals.map(d => <SelectItem key={d.id} value={d.id}>{d.dealName ?? '(sin nombre)'}</SelectItem>)}
              </SelectContent>
            </Select>
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
