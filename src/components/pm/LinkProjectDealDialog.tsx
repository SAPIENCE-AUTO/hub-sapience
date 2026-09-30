import { useState, useEffect } from 'react';
import { linkProjectDeal, getDeals, type GetProjectBudgetOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { RUBROS } from '../commercial/dealUtils';

type RubroData = GetProjectBudgetOutputType['rubros'][0];

interface Props {
  projectId: string;
  currentDealId?: string;
  currentVisibleRubros: string[] | null;
  // Árbol completo de rubros/sub-rubros del deal ya vinculado (Sergio
  // siempre lo ve sin filtrar, ver canSeeAll en getProjectBudget.ts) — sirve
  // para armar los checkboxes de sub-rubro. Viene vacío si el proyecto
  // todavía no tiene deal vinculado o el deal no tiene líneas de
  // presupuesto; en ese caso cada rubro cae al switch simple de antes.
  rubros: RubroData[];
  onLinked: () => void;
}

// Cada entrada guardada es o el nombre del rubro completo ("Reclutamiento e
// incentivos" — todo visible) o "Rubro::SubRubro" (solo esa línea puntual) —
// ver el mismo formato consumido por getProjectBudget.ts.
function subKey(rubro: string, subRubro: string): string {
  return `${rubro}::${subRubro}`;
}

// Sub-rubros únicos de un rubro, en el orden en que aparecen en la cotización.
function dedupSubRubros(items: { subRubro: string }[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const li of items) {
    const sr = li.subRubro ?? '';
    if (!seen.has(sr)) { seen.add(sr); list.push(sr); }
  }
  return list;
}

// Diálogo exclusivo de Sergio (el botón que lo abre solo se renderiza para su
// email, ver ProjectBudgetTab.tsx) para vincular un proyecto a un deal y, de
// paso, decidir explícitamente qué rubros de presupuesto quedan visibles para
// quien tenga ese rubro asignado — antes la visibilidad era 100% global por
// usuario (cotizacionRubros), sin ningún control por proyecto. Sep 2026: se
// vuelve granular por sub-rubro ("que dentro de Reclutamiento se pueda
// elegir qué ve cada quien", Sergio) — el switch maestro del rubro sigue
// existiendo para el caso simple de "todo o nada".
export default function LinkProjectDealDialog({ projectId, currentDealId, currentVisibleRubros, rubros, onLinked }: Props) {
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

  // Switch maestro del rubro: sin desglose de sub-rubro conocido, se
  // comporta como antes (todo o nada, guarda el nombre plano del rubro).
  const toggleWholeSimple = (rubro: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      next.has(rubro) ? next.delete(rubro) : next.add(rubro);
      return next;
    });
  };

  // Switch maestro cuando SÍ hay sub-rubros: enciende/apaga todas las líneas
  // de ese rubro de un golpe, limpiando cualquier estado granular previo.
  const toggleWholeGranular = (rubro: string, allSubKeys: string[], isCurrentlyOn: boolean) => {
    setVisible(prev => {
      const next = new Set(prev);
      next.delete(rubro);
      allSubKeys.forEach(k => next.delete(k));
      if (!isCurrentlyOn) allSubKeys.forEach(k => next.add(k));
      return next;
    });
  };

  // Toca una sub-rubro puntual. Si el rubro estaba en modo "todo visible"
  // (forma vieja, nombre plano), lo expande a granular: todas encendidas
  // menos la que se acaba de tocar.
  const toggleSub = (rubro: string, allSubKeys: string[], key: string) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(rubro)) {
        next.delete(rubro);
        allSubKeys.forEach(k => { if (k !== key) next.add(k); });
      } else if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
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
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vincular proyecto a un Deal</DialogTitle>
            <DialogDescription>
              Elige el deal y qué rubros (o líneas puntuales dentro de un rubro) de presupuesto son visibles aquí. Los Owners, Socios y Finanzas siempre ven todo.
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
              <div className="space-y-3 rounded-lg border p-3">
                {RUBROS.map(rubro => {
                  const rubroData = rubros.find(r => r.rubroName === rubro);
                  const subRubros = rubroData ? dedupSubRubros(rubroData.lineItems) : [];

                  if (subRubros.length === 0) {
                    return (
                      <div key={rubro} className="flex items-center justify-between">
                        <span className="text-sm">{rubro}</span>
                        <Switch checked={visible.has(rubro)} onCheckedChange={() => toggleWholeSimple(rubro)} />
                      </div>
                    );
                  }

                  const allSubKeys = subRubros.map(sr => subKey(rubro, sr));
                  const allOn = visible.has(rubro) || allSubKeys.every(k => visible.has(k));
                  const someOn = !allOn && allSubKeys.some(k => visible.has(k));

                  return (
                    <div key={rubro} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {rubro}
                          {someOn && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(parcial)</span>}
                        </span>
                        <Switch checked={allOn} onCheckedChange={() => toggleWholeGranular(rubro, allSubKeys, allOn)} />
                      </div>
                      <div className="pl-3 space-y-1 border-l-2 border-border">
                        {subRubros.map((sr, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{sr || '(sin sub-rubro)'}</span>
                            <Switch
                              className="scale-90"
                              checked={visible.has(allSubKeys[i]) || visible.has(rubro)}
                              onCheckedChange={() => toggleSub(rubro, allSubKeys, allSubKeys[i])}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
