import { useEffect, useState } from 'react';
import { Download, ExternalLink, EyeOff, FileWarning, Loader2 } from 'lucide-react';
import {
  BYTES_PARA_RECONOCER, LIMITE_VISTA_PREVIA, nombreDeDescarga, reconoceArchivo, type Adjunto, type TipoArchivo,
} from '../../lib/payments/comprobante';
import { CLASE_BOTON_SUAVE } from './estilos';

type Estado =
  | { fase: 'cargando' }
  | { fase: 'listo'; url: string; tipo: TipoArchivo; mime: string }
  | { fase: 'grande' }
  | { fase: 'noSoportado' }
  | { fase: 'error' };

const MENSAJE: Record<'grande' | 'noSoportado' | 'error', string> = {
  grande: 'El archivo es muy grande para mostrarlo aquí. Ábrelo en otra pestaña.',
  noSoportado: 'Este tipo de archivo no se puede mostrar aquí. Ábrelo en otra pestaña.',
  error: 'No se pudo cargar el comprobante. Ábrelo en otra pestaña para verlo.',
};

/**
 * El comprobante de un pago dentro del detalle: lo baja como archivo temporal, reconoce si es PDF o imagen por sus
 * primeros bytes y lo muestra ahí mismo. Si no se puede (muy grande, de otro tipo, sin conexión) lo dice y deja abrirlo
 * en otra pestaña.
 */
export function VistaPreviaComprobante({ adjunto, poNumber, indice, etiqueta, onOcultar }: {
  adjunto: Adjunto;
  poNumber?: string;
  indice: number;
  etiqueta: string;
  onOcultar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });

  useEffect(() => {
    let vigente = true; // si se cambia de comprobante antes de terminar, la respuesta vieja se ignora
    let temporal: string | null = null;
    setEstado({ fase: 'cargando' });
    (async () => {
      try {
        const res = await fetch(adjunto.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (Number(res.headers.get('content-length')) > LIMITE_VISTA_PREVIA) {
          void res.body?.cancel();
          if (vigente) setEstado({ fase: 'grande' });
          return;
        }
        const blob = await res.blob();
        if (blob.size > LIMITE_VISTA_PREVIA) {
          if (vigente) setEstado({ fase: 'grande' });
          return;
        }
        const { tipo, mime } = reconoceArchivo(new Uint8Array(await blob.slice(0, BYTES_PARA_RECONOCER).arrayBuffer()));
        if (tipo === 'otro' || !mime) {
          if (vigente) setEstado({ fase: 'noSoportado' });
          return;
        }
        // El tipo sale de los bytes, no de lo que haya dicho el servidor.
        temporal = URL.createObjectURL(blob.type === mime ? blob : new Blob([blob], { type: mime }));
        if (vigente) setEstado({ fase: 'listo', url: temporal, tipo, mime });
        else URL.revokeObjectURL(temporal);
      } catch {
        if (vigente) setEstado({ fase: 'error' });
      }
    })();
    return () => {
      vigente = false;
      if (temporal) URL.revokeObjectURL(temporal);
    };
  }, [adjunto.url]);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        {estado.fase === 'cargando' && (
          <div className="flex h-[480px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando comprobante…
          </div>
        )}
        {estado.fase === 'listo' && estado.tipo === 'pdf' && (
          <iframe src={`${estado.url}#toolbar=0&navpanes=0`} title={`${etiqueta} de la ODC ${poNumber ?? ''}`.trim()} className="h-[480px] w-full bg-card" />
        )}
        {estado.fase === 'listo' && estado.tipo === 'imagen' && (
          <img src={estado.url} alt={`${etiqueta} de la ODC ${poNumber ?? ''}`.trim()} className="mx-auto max-h-[480px] w-auto max-w-full object-contain" />
        )}
        {(estado.fase === 'grande' || estado.fase === 'noSoportado' || estado.fase === 'error') && (
          <div className="flex h-[140px] flex-col items-center justify-center gap-1.5 px-6 text-center text-sm text-muted-foreground">
            <FileWarning className="h-5 w-5" />
            {MENSAJE[estado.fase]}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={adjunto.url} target="_blank" rel="noopener noreferrer" className={CLASE_BOTON_SUAVE}>
          <ExternalLink className="h-3.5 w-3.5" /> Abrir en otra pestaña
        </a>
        {estado.fase === 'listo' && (
          <a href={estado.url} download={nombreDeDescarga(adjunto, poNumber, indice, estado.mime)} className={CLASE_BOTON_SUAVE}>
            <Download className="h-3.5 w-3.5" /> Descargar
          </a>
        )}
        <button type="button" onClick={onOcultar} className={CLASE_BOTON_SUAVE}>
          <EyeOff className="h-3.5 w-3.5" /> Ocultar vista previa
        </button>
      </div>
    </div>
  );
}
