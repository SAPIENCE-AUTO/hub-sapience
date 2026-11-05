import { useEffect, useState } from 'react';
import { Copy, Download, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getNDADetail, getNDAPdfUrl } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { NdaPill } from '@/components/nda/NdaPill';
import { NDA_AYUDA, fechaMx, type EstadoNda } from '@/lib/nda';
import { ALERTA, EXITO, GRIS, INFO, PELIGRO } from '@/lib/toolColors';

interface Evento { tipo: string; at: string; actor?: string; detalle?: string }
interface Envio {
  id: string; estado: EstadoNda; nombre: string; nombreFirmado?: string; correo: string; enlace: string; envios: number; tienePdf: boolean;
  enviadoAt?: string; ultimoEnvioAt?: string; abiertoAt?: string; firmadoAt?: string; rechazadoAt?: string;
  motivoRechazo?: string; enviadoPor?: string; ip?: string; userAgent?: string; sesion?: string; eventos: Evento[];
}

const EVENTO: Record<string, { texto: string; color: string }> = {
  enviado: { texto: 'Correo enviado', color: GRIS },
  reenviado: { texto: 'Correo reenviado', color: GRIS },
  abierto: { texto: 'Abrió la liga', color: INFO },
  firmado: { texto: 'Firmó el acuerdo', color: EXITO },
  rechazado: { texto: 'No aceptó el acuerdo', color: PELIGRO },
  pdf_creado: { texto: 'PDF guardado', color: GRIS },
  pdf_fallido: { texto: 'No se pudo guardar el PDF', color: ALERTA },
  copia_enviada: { texto: 'Copia enviada a la persona', color: GRIS },
  copia_fallida: { texto: 'No se pudo mandar la copia a la persona', color: ALERTA },
};
// De estos eventos el detalle sí se lee (el motivo, el error); en los demás es un dato técnico (correo, huella) que ya está en otra parte.
const CON_DETALLE = new Set(['rechazado', 'pdf_fallido', 'copia_fallida']);

/**
 * Detalle del NDA de una fila (patrón DetailDialog de los módulos financieros): el estado, la línea de tiempo con fechas y lo que se puede hacer —
 * ver el PDF firmado, copiar la liga para mandarla por WhatsApp, reenviar el correo o mandar uno nuevo. Qué guarda cada paso: docs/nda.md.
 */
export function NdaDetailDialog({ rowId, open, onOpenChange, onReenviar }: {
  rowId: string | null; open: boolean; onOpenChange: (o: boolean) => void; onReenviar: (rowId: string, modo: 'reenviar' | 'nuevo') => void;
}) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [error, setError] = useState(false);
  const [abriendoPdf, setAbriendoPdf] = useState(false);

  useEffect(() => {
    if (!open || !rowId) return;
    let vivo = true;
    setEnvios(null); setError(false);
    getNDADetail({ rowId })
      .then((d: { envios: Envio[] }) => { if (vivo) setEnvios(d.envios); })
      .catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [open, rowId]);

  const actual = envios?.[0];
  const anteriores = envios?.slice(1) ?? [];

  const verPdf = async () => {
    if (!actual) return;
    setAbriendoPdf(true);
    try {
      const { url } = await getNDAPdfUrl({ envioId: actual.id });
      window.open(url, '_blank', 'noopener');
    } catch { toast.error('No se pudo abrir el PDF. Inténtalo de nuevo.'); }
    finally { setAbriendoPdf(false); }
  };
  const copiarLiga = async () => {
    if (!actual) return;
    try { await navigator.clipboard.writeText(actual.enlace); toast.success('Liga copiada'); }
    catch { toast.error('No se pudo copiar. Selecciónala y cópiala a mano.'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>NDA</DialogTitle>
          <DialogDescription className="sr-only">Estado del acuerdo de confidencialidad de este participante</DialogDescription>
        </DialogHeader>

        {!envios && !error && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {error && <p className="py-6 text-center text-sm text-muted-foreground">No se pudo cargar el detalle. Cierra y vuelve a abrir.</p>}
        {envios && !actual && <p className="py-6 text-center text-sm text-muted-foreground">Todavía no se le ha mandado el NDA.</p>}

        {actual && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{actual.nombreFirmado ?? actual.nombre}</p>
                <p className="truncate text-sm text-muted-foreground">{actual.correo}</p>
              </div>
              <NdaPill estado={actual.estado} title={NDA_AYUDA[actual.estado]} />
            </div>

            {actual.sesion && <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed"><span className="font-medium">Sesión:</span> {actual.sesion}</p>}

            {actual.nombreFirmado && actual.nombreFirmado !== actual.nombre && (
              <p className="text-xs text-muted-foreground">En el tablero está como «{actual.nombre}»; firmó como «{actual.nombreFirmado}».</p>
            )}

            <ol className="space-y-2.5 border-l border-border pl-4">
              {actual.eventos.filter((e) => EVENTO[e.tipo]).map((e, i) => (
                <li key={`${e.tipo}-${e.at}-${i}`} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: EVENTO[e.tipo].color }} />
                  <span className="font-medium">{EVENTO[e.tipo].texto}</span>
                  <span className="text-muted-foreground"> · {fechaMx(e.at)}</span>
                  {e.actor && e.actor !== 'participante' && e.actor !== 'sistema' && <span className="text-muted-foreground"> · {e.actor}</span>}
                  {CON_DETALLE.has(e.tipo) && e.detalle && <p className="mt-0.5 text-xs text-muted-foreground">{e.detalle}</p>}
                </li>
              ))}
              {actual.eventos.length === 0 && <li className="text-sm text-muted-foreground">Sin movimientos registrados.</li>}
            </ol>

            {(actual.estado === 'firmado' || actual.estado === 'rechazado') && (actual.ip || actual.userAgent) && (
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                <p className="mb-0.5 font-medium text-foreground/70">Constancia</p>
                {actual.ip && <p>IP: {actual.ip}</p>}
                {actual.userAgent && <p className="break-words">Dispositivo: {actual.userAgent}</p>}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {actual.estado === 'firmado' && (
                <>
                  <Button onClick={verPdf} disabled={abriendoPdf} className="gap-2">
                    {abriendoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Ver PDF firmado
                  </Button>
                  <Button variant="ghost" onClick={() => rowId && onReenviar(rowId, 'nuevo')} className="gap-2 text-muted-foreground"><Send className="h-4 w-4" /> Mandar otro</Button>
                </>
              )}
              {(actual.estado === 'enviado' || actual.estado === 'abierto') && (
                <>
                  <Button onClick={() => rowId && onReenviar(rowId, 'reenviar')} className="gap-2"><Send className="h-4 w-4" /> Reenviar correo</Button>
                  <Button variant="outline" onClick={copiarLiga} className="gap-2"><Copy className="h-4 w-4" /> Copiar liga</Button>
                </>
              )}
              {actual.estado === 'rechazado' && (
                <Button onClick={() => rowId && onReenviar(rowId, 'nuevo')} className="gap-2"><Send className="h-4 w-4" /> Mandar de nuevo</Button>
              )}
            </div>
            {(actual.estado === 'enviado' || actual.estado === 'abierto') && (
              <p className="-mt-2 text-xs text-muted-foreground">«Copiar liga» sirve para mandarla por WhatsApp: al firmar por ahí también queda registrado aquí.</p>
            )}

            {anteriores.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Envíos anteriores</p>
                <ul className="space-y-1">
                  {anteriores.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <NdaPill estado={a.estado} />
                      {fechaMx(a.firmadoAt ?? a.rechazadoAt ?? a.abiertoAt ?? a.enviadoAt)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
