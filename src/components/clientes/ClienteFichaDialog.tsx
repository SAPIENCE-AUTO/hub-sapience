import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, ExternalLink, Pencil, Plus, Power, Trash2, Users } from 'lucide-react';
import { deleteClientContact, getClientDetail, setClientEntityActive } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { REGIMENES_FISCALES, etiquetaSat } from '@/lib/clientes/catalogos';
import { faltanParaCobrar, faltanParaFacturar } from '@/lib/clientes/fases';
import { fmtCurrency } from '@/lib/format';
import Pastilla from './Pastilla';
import RazonSocialDialog from './RazonSocialDialog';
import ContactoDialog from './ContactoDialog';
import type { Contacto, Entidad, FichaDeCliente } from './tipos';

function Titulo({ icono: Icono, texto, accion }: { icono: React.ElementType; texto: string; accion?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icono className="w-3.5 h-3.5" />{texto}</p>
      {accion}
    </div>
  );
}

function TarjetaRazonSocial({ e, onEditar, onCambiarActiva }: { e: Entidad; onEditar: () => void; onCambiarActiva: () => void }) {
  const cobro = faltanParaCobrar(e);
  const fiscal = faltanParaFacturar(e);
  const condiciones = [
    e.creditDays != null ? `${e.creditDays} días de crédito` : null,
    e.paymentMethod,
    e.requiresPo ? 'Orden de compra' : null,
    e.requiresProforma ? 'Proforma' : null,
    e.requiresPortal ? 'Portal' : null,
    e.requiresGr ? 'GR / Migo' : null,
  ].filter(Boolean).join(' · ');
  const fiscales = [e.rfc ? `RFC ${e.rfc}` : null, e.postalCode ? `CP ${e.postalCode}` : null, e.taxRegime ? etiquetaSat(REGIMENES_FISCALES, e.taxRegime) : null].filter(Boolean).join(' · ');

  return (
    <div className={`rounded-xl border border-border bg-card p-4 space-y-2 ${e.active ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{e.legalName || 'Sin nombre'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {!e.active && <Pastilla tono="gris">Desactivada</Pastilla>}
            {cobro.length === 0 ? <Pastilla tono="exito">Cobro listo</Pastilla> : <Pastilla tono="alerta" title={`Falta: ${cobro.join(', ')}`}>Cobro incompleto</Pastilla>}
            {fiscal.length === 0 ? <Pastilla tono="exito">Fiscal listo</Pastilla> : <Pastilla tono="alerta" title={`Falta: ${fiscal.join(', ')}`}>Fiscal incompleto</Pastilla>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={onEditar}><Pencil className="w-3.5 h-3.5" />Editar</Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={onCambiarActiva}><Power className="w-3.5 h-3.5" />{e.active ? 'Desactivar' : 'Reactivar'}</Button>
        </div>
      </div>
      {fiscales && <p className="text-sm text-muted-foreground"><span className="font-mono">{fiscales}</span></p>}
      {condiciones && <p className="text-sm">{condiciones}</p>}
      {fiscal.length > 0 && <p className="text-xs text-muted-foreground">Para facturar falta: {fiscal.join(', ')}.</p>}
      {e.billingEmails && <p className="text-sm text-muted-foreground">Facturas a: {e.billingEmails}</p>}
      {e.requiresPortal && e.portalUrl && (
        <a href={e.portalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ExternalLink className="w-3.5 h-3.5" />Portal del cliente</a>
      )}
      {e.processNotes && <p className="text-sm rounded-lg bg-muted/40 px-3 py-2 whitespace-pre-wrap">{e.processNotes}</p>}
    </div>
  );
}

interface Props {
  clientId: string | null;
  onClose: () => void;
  /** Avisa a la lista que algo cambió para que recalcule sus conteos. */
  onChanged: () => void;
}

export default function ClienteFichaDialog({ clientId, onClose, onChanged }: Props) {
  const [ficha, setFicha] = useState<FichaDeCliente | null>(null);
  const [razon, setRazon] = useState<{ abierto: boolean; entidad?: Entidad }>({ abierto: false });
  const [contacto, setContacto] = useState<{ abierto: boolean; contacto?: Contacto }>({ abierto: false });
  const [porBorrar, setPorBorrar] = useState<Contacto | null>(null);

  const cargar = useCallback(async () => {
    if (!clientId) return;
    try {
      setFicha(await getClientDetail({ clientId }));
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo abrir el cliente');
      onClose();
    }
  }, [clientId, onClose]);

  useEffect(() => {
    setFicha(null);
    if (clientId) cargar();
  }, [clientId, cargar]);

  const cambioAlgo = async () => { await cargar(); onChanged(); };

  const cambiarActiva = async (e: Entidad) => {
    try {
      await setClientEntityActive({ id: e.id, active: !e.active });
      toast.success(e.active ? 'Razón social desactivada' : 'Razón social reactivada');
      await cambioAlgo();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo cambiar');
    }
  };

  const borrarContacto = async () => {
    if (!porBorrar) return;
    try {
      await deleteClientContact({ id: porBorrar.id });
      toast.success('Contacto borrado');
      await cambioAlgo();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo borrar el contacto');
    }
    setPorBorrar(null);
  };

  const entidades = ficha?.entities ?? [];
  const nombreDe = (id?: string) => entidades.find(e => e.id === id)?.legalName;

  return (
    <>
      <Dialog open={!!clientId} onOpenChange={v => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {ficha?.client?.name ?? 'Cliente'}
              {ficha?.client?.sharpliLinked && <Pastilla tono="info" title="Este cliente ya está enlazado con Sharpli">Sharpli</Pastilla>}
            </DialogTitle>
            {ficha?.stats && (
              <p className="text-sm text-muted-foreground">
                {ficha.stats.deals} deals · {ficha.stats.projects} proyectos
                {ficha.stats.pending.length > 0 && <> · Por cobrar: {ficha.stats.pending.map(p => `${fmtCurrency(p.amount, p.currency)} ${p.currency}`).join(' + ')}</>}
              </p>
            )}
          </DialogHeader>

          {!ficha ? (
            <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-20 w-full" /></div>
          ) : (
            <div className="space-y-6">
              <section>
                <Titulo icono={Building2} texto="Razones sociales" accion={
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setRazon({ abierto: true })}><Plus className="w-3.5 h-3.5" />Agregar razón social</Button>
                } />
                {entidades.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                    <p className="text-sm font-medium">Este cliente todavía no tiene razón social</p>
                    <p className="text-xs text-muted-foreground mt-1">Con una razón social, Cobranza trae sola los días de crédito y los pasos al iniciar un proceso, y más adelante saldrá la factura.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {entidades.map(e => (
                      <TarjetaRazonSocial key={e.id} e={e} onEditar={() => setRazon({ abierto: true, entidad: e })} onCambiarActiva={() => cambiarActiva(e)} />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <Titulo icono={Users} texto="Contactos de cobranza" accion={
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setContacto({ abierto: true })}><Plus className="w-3.5 h-3.5" />Agregar contacto</Button>
                } />
                {ficha.contacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin contactos todavía: a quién se le manda la factura y quién libera los pagos.</p>
                ) : (
                  <div className="rounded-xl border border-border divide-y divide-border">
                    {ficha.contacts.map(c => (
                      <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{c.name}</span>
                            {c.role && <Pastilla tono="info">{c.role}</Pastilla>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[c.email, c.phone, c.entityId ? nombreDe(c.entityId) : 'Todas las razones sociales'].filter(Boolean).join(' · ')}
                          </p>
                          {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Editar contacto" onClick={() => setContacto({ abierto: true, contacto: c })}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Borrar contacto" onClick={() => setPorBorrar(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {clientId && (
        <RazonSocialDialog clientId={clientId} entidad={razon.entidad} open={razon.abierto} onClose={() => setRazon({ abierto: false })} onSaved={cambioAlgo} />
      )}
      {clientId && (
        <ContactoDialog clientId={clientId} entidades={entidades.filter(e => e.active)} contacto={contacto.contacto} open={contacto.abierto} onClose={() => setContacto({ abierto: false })} onSaved={cambioAlgo} />
      )}

      <AlertDialog open={!!porBorrar} onOpenChange={v => { if (!v) setPorBorrar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar a {porBorrar?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Se quita de los contactos de cobranza de este cliente.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={borrarContacto}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
