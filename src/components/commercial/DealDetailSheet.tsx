import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { GetDealsOutputType } from 'zite-endpoints-sdk';
import { PHASE_COLOR_MAP } from './dealUtils';
import DealGeneralTab from './DealGeneralTab';
import CotizacionesTab from './CotizacionesTab';
import DocumentosTab from './DocumentosTab';
import ResumenTab from './ResumenTab';
import BriefEditor from './BriefEditor';
import ApprovalReviewDialog from './ApprovalReviewDialog';

type Deal = GetDealsOutputType['deals'][0];

const APPROVE_PHASES = ['Cotización enviada', 'Negociación'];

interface Props {
  deal: Deal;
  isOpen: boolean;
  onClose: () => void;
  onDealUpdated: (deal: Deal) => void;
  onDeleted: () => void;
  existingClients?: string[];
}

export default function DealDetailSheet({ deal, isOpen, onClose, onDealUpdated, onDeleted, existingClients }: Props) {
  const [localDeal, setLocalDeal] = useState<Deal>(deal);
  const [approvalReviewOpen, setApprovalReviewOpen] = useState(false);
  const isNew = !deal.id;
  const phaseColor = PHASE_COLOR_MAP[localDeal.phase ?? ''] ?? 'hsl(var(--muted-foreground))';
  const canApprove = !!localDeal.id && APPROVE_PHASES.includes(localDeal.phase ?? '');

  // Sync when parent deal changes (e.g. new deal opened)
  useEffect(() => { setLocalDeal(deal); }, [deal]);

  const handleDealSaved = (updated: Deal) => {
    setLocalDeal(updated);
    onDealUpdated(updated);
  };

  const handleDealFieldUpdated = (fields: { clientPrice?: number; quotedCost?: number; retencionesPct?: number }) => {
    setLocalDeal(prev => ({ ...prev, ...fields }));
    onDealUpdated({ ...localDeal, ...fields });
  };

  const handleApprovalSuccess = (res: { projectCode: string; projectId: string; quotedCost: number; notificationsSent: number }) => {
    const today = new Date().toISOString().split('T')[0];
    const updated: Deal = { ...localDeal, phase: 'Ganado', approvalDate: today, quotedCost: res.quotedCost };
    (updated as any).projects = [res.projectId];
    setLocalDeal(updated);
    onDealUpdated(updated);
    setApprovalReviewOpen(false);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={o => !o && onClose()}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                {!isNew && (
                  <div className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5" style={{ backgroundColor: phaseColor }} />
                )}
                <div className="min-w-0">
                  <DialogTitle className="text-base leading-tight">
                    {isNew ? 'Nuevo Deal' : (localDeal.dealName || 'Deal sin nombre')}
                  </DialogTitle>
                  {!isNew && localDeal.client && (
                    <p className="text-sm text-muted-foreground mt-0.5">{localDeal.client}</p>
                  )}
                </div>
              </div>

            </div>
          </DialogHeader>

          {isNew ? (
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <DealGeneralTab deal={localDeal} onSaved={handleDealSaved} onDeleted={onDeleted} existingClients={existingClients} />
            </div>
          ) : (
            <Tabs defaultValue="general" className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <TabsList className="mx-6 mt-3 mb-0 flex-shrink-0 grid grid-cols-5">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="cotizaciones">Cotizaciones</TabsTrigger>
                <TabsTrigger value="documentos">Documentos</TabsTrigger>
                <TabsTrigger value="brief">Brief</TabsTrigger>
                <TabsTrigger value="resumen">Resumen</TabsTrigger>
              </TabsList>
              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
                <TabsContent value="general" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <DealGeneralTab deal={localDeal} onSaved={handleDealSaved} onDeleted={onDeleted} existingClients={existingClients} />
                </TabsContent>
                <TabsContent value="cotizaciones" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <CotizacionesTab
                    dealId={localDeal.id}
                    dealCurrency={localDeal.currency}
                    dealClientPrice={localDeal.clientPrice}
                    dealQuotedCost={localDeal.quotedCost}
                    dealTaxesPct={localDeal.taxesPct}
                    dealRetencionesPct={localDeal.retencionesPct}
                    onDealFieldUpdated={handleDealFieldUpdated}
                  />
                </TabsContent>
                <TabsContent value="documentos" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <DocumentosTab dealId={localDeal.id} />
                </TabsContent>
                <TabsContent value="brief" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <BriefEditor dealId={localDeal.id} />
                </TabsContent>
                <TabsContent value="resumen" className="mt-0 data-[state=inactive]:hidden" forceMount>
                  <ResumenTab deal={localDeal} />
                </TabsContent>
              </div>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <ApprovalReviewDialog
        open={approvalReviewOpen}
        onClose={() => setApprovalReviewOpen(false)}
        deal={localDeal}
        onApproved={handleApprovalSuccess}
      />
    </>
  );
}
