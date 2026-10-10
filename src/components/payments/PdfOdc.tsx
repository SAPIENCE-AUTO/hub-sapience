import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getPoPdfBase64 } from 'zite-endpoints-sdk';
import { motivoDelError } from '../../lib/payments/errores';
import { base64ABlob } from '../../lib/payments/odc';
import { TEAL } from '../../lib/toolColors';
import { CLASE_BOTON_SUAVE } from './estilos';

/**
 * El PDF de la ODC a un clic. No se baja hasta que se pide (pesa unos 150 KB por ODC y la lista de pagos no lo trae) y
 * se muestra ahí mismo, con salida a otra pestaña para verlo junto al detalle.
 */
export function PdfOdc({ poId, poNumber }: { poId: string; poNumber?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const vivo = useRef(true);
  const pedido = useRef(0); // número de la última petición: una respuesta vieja no pisa a la nueva

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);
  // El archivo temporal se libera al ocultar el PDF, al cambiar de pago o al cerrar el detalle.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  // Otro pago, otra ODC: el PDF de la anterior ya no corresponde.
  useEffect(() => {
    pedido.current += 1;
    setUrl(null);
    setCargando(false);
  }, [poId]);

  const abrir = async () => {
    const mio = ++pedido.current;
    setCargando(true);
    try {
      const { pdfBase64 } = await getPoPdfBase64({ poId });
      if (!vivo.current || mio !== pedido.current) return;
      if (!pdfBase64) {
        toast.error('Esta ODC no tiene PDF guardado');
        setCargando(false);
        return;
      }
      setUrl(URL.createObjectURL(base64ABlob(pdfBase64)));
    } catch (e) {
      if (!vivo.current || mio !== pedido.current) return;
      toast.error(motivoDelError(e, 'No se pudo cargar el PDF de la ODC'));
    }
    setCargando(false);
  };

  if (!url) {
    return (
      <div className="mt-3">
        <button type="button" onClick={abrir} disabled={cargando} className={CLASE_BOTON_SUAVE}>
          {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" style={{ color: TEAL }} />}
          {cargando ? 'Cargando PDF…' : 'Ver PDF de la ODC'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setUrl(null)} className={CLASE_BOTON_SUAVE}>
          <X className="h-3.5 w-3.5" /> Ocultar PDF
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className={CLASE_BOTON_SUAVE}>
          <ExternalLink className="h-3.5 w-3.5" /> Abrir en otra pestaña
        </a>
        <a href={url} download={`OC-${poNumber ?? 'orden'}.pdf`} className={CLASE_BOTON_SUAVE}>
          <Download className="h-3.5 w-3.5" /> Descargar
        </a>
      </div>
      <iframe
        src={`${url}#toolbar=0&navpanes=0`}
        title={`PDF de la ODC${poNumber ? ` ${poNumber}` : ''}`}
        className="h-[420px] w-full rounded-lg border bg-card"
      />
    </div>
  );
}
