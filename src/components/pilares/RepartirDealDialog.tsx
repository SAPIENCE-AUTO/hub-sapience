import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DealPilares from './DealPilares';
import type { DealBasicoApi } from './tipos';

// El reparto de un deal en una ventana, para la pantalla de Pilares (en el deal mismo vive en la pestaña General).
export default function RepartirDealDialog({ deal, onCerrar, onGuardado }: { deal: DealBasicoApi | null; onCerrar: () => void; onGuardado: () => void }) {
  return (
    <Dialog open={!!deal} onOpenChange={o => !o && onCerrar()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deal?.nombre || 'Deal sin nombre'}</DialogTitle>
          <DialogDescription>{[deal?.cliente, deal?.fase].filter(Boolean).join(', ')}</DialogDescription>
        </DialogHeader>
        {deal && <DealPilares dealId={deal.id} precioDeal={deal.precio} moneda={deal.moneda} onGuardado={onGuardado} />}
      </DialogContent>
    </Dialog>
  );
}
