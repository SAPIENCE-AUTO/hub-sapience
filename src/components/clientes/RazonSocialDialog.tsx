import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Loader2 } from 'lucide-react';
import { saveClientEntity } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { FORMAS_PAGO, METODOS_PAGO, REGIMENES_FISCALES, USOS_CFDI, type OpcionSat } from '@/lib/clientes/catalogos';
import { fasesQueAplican } from '@/lib/clientes/fases';
import { correoValido, cpValido, normalizarRfc, rfcValido, separarCorreos } from '@/lib/clientes/validacion';
import type { Entidad } from './tipos';

const NINGUNO = '__ninguno__';
const etiqueta = 'text-[11px] text-muted-foreground uppercase tracking-wide font-medium';

function Campo({ nombre, children, ayuda }: { nombre: string; children: React.ReactNode; ayuda?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={etiqueta}>{nombre}</label>
      {children}
      {ayuda}
    </div>
  );
}

function SelectSat({ lista, valor, onChange, vacio = 'Sin definir' }: { lista: OpcionSat[]; valor: string; onChange: (v: string) => void; vacio?: string }) {
  return (
    <Select value={valor || NINGUNO} onValueChange={v => onChange(v === NINGUNO ? '' : v)}>
      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NINGUNO}>{vacio}</SelectItem>
        {lista.map(o => <SelectItem key={o.clave} value={o.clave}>{o.clave} · {o.nombre}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Casilla({ marcada, onChange, children }: { marcada: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
      <Checkbox checked={marcada} onCheckedChange={v => onChange(v === true)} />
      {children}
    </label>
  );
}

interface Props {
  clientId: string;
  entidad?: Entidad;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function RazonSocialDialog({ clientId, entidad, open, onClose, onSaved }: Props) {
  const [legalName, setLegalName] = useState('');
  const [rfc, setRfc] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [taxRegime, setTaxRegime] = useState('');
  const [cfdiUse, setCfdiUse] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentForm, setPaymentForm] = useState('');
  const [billingEmails, setBillingEmails] = useState('');
  const [creditDays, setCreditDays] = useState('');
  const [requiresPo, setRequiresPo] = useState(false);
  const [requiresPortal, setRequiresPortal] = useState(false);
  const [portalUrl, setPortalUrl] = useState('');
  const [requiresGr, setRequiresGr] = useState(false);
  const [requiresProforma, setRequiresProforma] = useState(false);
  const [processNotes, setProcessNotes] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLegalName(entidad?.legalName ?? '');
    setRfc(entidad?.rfc ?? '');
    setPostalCode(entidad?.postalCode ?? '');
    setTaxRegime(entidad?.taxRegime ?? '');
    setCfdiUse(entidad?.cfdiUse ?? '');
    setPaymentMethod(entidad?.paymentMethod ?? '');
    setPaymentForm(entidad?.paymentForm ?? '');
    setBillingEmails(entidad?.billingEmails ?? '');
    setCreditDays(entidad?.creditDays != null ? String(entidad.creditDays) : '');
    setRequiresPo(entidad?.requiresPo ?? false);
    setRequiresPortal(entidad?.requiresPortal ?? false);
    setPortalUrl(entidad?.portalUrl ?? '');
    setRequiresGr(entidad?.requiresGr ?? false);
    setRequiresProforma(entidad?.requiresProforma ?? false);
    setProcessNotes(entidad?.processNotes ?? '');
  }, [open, entidad]);

  const rfcLimpio = normalizarRfc(rfc);
  const rfcMal = !!rfcLimpio && !rfcValido(rfcLimpio);
  const cpMal = postalCode !== '' && !cpValido(postalCode);
  const correosMalos = separarCorreos(billingEmails).filter(c => !correoValido(c));
  const diasNum = creditDays.trim() === '' ? null : Number(creditDays);
  const diasMal = diasNum != null && (!Number.isInteger(diasNum) || diasNum < 0 || diasNum > 365);
  const pasos = useMemo(() => fasesQueAplican({ requiresProforma, requiresPortal, requiresGr }).filter(f => f !== 'Por iniciar'), [requiresProforma, requiresPortal, requiresGr]);
  const puedeGuardar = legalName.trim() !== '' && !rfcMal && !cpMal && correosMalos.length === 0 && !diasMal;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      await saveClientEntity({
        id: entidad?.id, clientId, legalName, rfc, taxRegime, postalCode, cfdiUse, paymentMethod, paymentForm, billingEmails,
        creditDays: diasNum, requiresPo, requiresPortal, portalUrl: requiresPortal ? portalUrl : '', requiresGr, requiresProforma, processNotes,
      });
      toast.success(entidad ? 'Razón social actualizada' : 'Razón social agregada');
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? 'No se pudo guardar la razón social');
    }
    setGuardando(false);
  };

  const error = (texto: string) => <p className="text-[11px] text-destructive">{texto}</p>;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" />{entidad ? 'Editar razón social' : 'Agregar razón social'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Datos para facturar</p>
            <Campo nombre="Razón social">
              <Input className="h-9" value={legalName} onChange={e => setLegalName(e.target.value)} autoFocus placeholder="Tal como aparece en su constancia de situación fiscal" />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo nombre="RFC" ayuda={rfcMal ? error('Debe tener 12 caracteres (empresa) o 13 (persona física)') : undefined}>
                <Input className="h-9 font-mono uppercase" value={rfc} onChange={e => setRfc(e.target.value.toUpperCase())} maxLength={14} />
              </Campo>
              <Campo nombre="Código postal fiscal" ayuda={cpMal ? error('Son 5 dígitos') : undefined}>
                <Input className="h-9 font-mono" inputMode="numeric" value={postalCode} onChange={e => setPostalCode(e.target.value.replace(/\D/g, '').slice(0, 5))} />
              </Campo>
            </div>
            <Campo nombre="Régimen fiscal">
              <SelectSat lista={REGIMENES_FISCALES} valor={taxRegime} onChange={setTaxRegime} />
            </Campo>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Campo nombre="Uso del CFDI"><SelectSat lista={USOS_CFDI} valor={cfdiUse} onChange={setCfdiUse} /></Campo>
              <Campo nombre="Método de pago"><SelectSat lista={METODOS_PAGO} valor={paymentMethod} onChange={setPaymentMethod} /></Campo>
              <Campo nombre="Forma de pago"><SelectSat lista={FORMAS_PAGO} valor={paymentForm} onChange={setPaymentForm} /></Campo>
            </div>
            {diasNum != null && diasNum > 0 && paymentMethod === 'PUE' && (
              <p className="text-[11px] text-muted-foreground">Con días de crédito lo normal es PPD (se paga después): al cobrarla hay que emitir el complemento de pago.</p>
            )}
            <Campo nombre="Correos para enviar la factura" ayuda={correosMalos.length > 0 ? error(`Revisa: ${correosMalos.join(', ')}`) : <p className="text-[11px] text-muted-foreground">Varios, separados por coma.</p>}>
              <Input className="h-9" value={billingEmails} onChange={e => setBillingEmails(e.target.value)} />
            </Campo>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cobranza</p>
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-6 gap-y-3 items-start">
              <Campo nombre="Días de crédito" ayuda={diasMal ? error('Un número entre 0 y 365') : undefined}>
                <Input className="h-9" type="number" min={0} max={365} value={creditDays} onChange={e => setCreditDays(e.target.value)} />
              </Campo>
              <div className="space-y-2 pt-0.5">
                <label className={etiqueta}>Qué pide este cliente</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  <Casilla marcada={requiresPo} onChange={setRequiresPo}>Orden de compra suya</Casilla>
                  <Casilla marcada={requiresProforma} onChange={setRequiresProforma}>Proforma antes de facturar</Casilla>
                  <Casilla marcada={requiresPortal} onChange={setRequiresPortal}>Subir la factura a un portal</Casilla>
                  <Casilla marcada={requiresGr} onChange={setRequiresGr}>GR / Migo</Casilla>
                </div>
              </div>
            </div>
            {requiresPortal && (
              <Campo nombre="Liga del portal">
                <Input className="h-9" value={portalUrl} onChange={e => setPortalUrl(e.target.value)} placeholder="portal.cliente.com" />
              </Campo>
            )}
            <Campo nombre="Instrucciones de cobranza">
              <Textarea rows={3} className="text-sm resize-none" value={processNotes} onChange={e => setProcessNotes(e.target.value)}
                placeholder="Cómo y dónde se sube la factura, fechas de corte, a quién escribir si se atrasa…" />
            </Campo>
            <div className="rounded-lg bg-muted/40 px-3.5 py-3">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium mb-1.5">Pasos del proceso de este cliente</p>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {pasos.map((p, i) => (
                  <span key={p} className="inline-flex items-center gap-1.5">
                    <span className="rounded-md bg-background border border-border px-2 py-0.5 font-medium">{p}</span>
                    {i < pasos.length - 1 && <span className="text-muted-foreground">→</span>}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={!puedeGuardar || guardando} className="gap-1.5">
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {guardando ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
