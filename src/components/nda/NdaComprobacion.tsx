import { useEffect, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import { checkNDAIdentificacion } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { ALERTA, EXITO, GRIS } from '@/lib/toolColors';

type Veredicto = 'parecidas' | 'distintas' | 'no_concluyente';
interface Comprobacion {
  disponible: boolean;
  motivo?: string;
  nombreFirmado?: string;
  nombreIdentificacion?: string;
  nombre?: 'coincide' | 'distinto' | 'sin-dato';
  firma?: { veredicto: Veredicto; comentario: string; firmaNda: string; firmaIdentificacion?: string };
}

const NOMBRE: Record<NonNullable<Comprobacion['nombre']>, { texto: string; color: string }> = {
  coincide: { texto: 'Coincide con el que firmó', color: EXITO },
  distinto: { texto: 'Distinto al que firmó', color: ALERTA },
  'sin-dato': { texto: 'No se alcanzó a leer', color: GRIS },
};
const VEREDICTO: Record<Veredicto, { texto: string; color: string }> = {
  parecidas: { texto: 'Parecidas', color: EXITO },
  distintas: { texto: 'Distintas', color: ALERTA },
  no_concluyente: { texto: 'No concluyente', color: GRIS },
};

/** Pill «sólido chico» como NdaPill, con el texto y el color que se le pasan. */
function Etiqueta({ texto, color }: { texto: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: color }}>
      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {texto}
    </span>
  );
}

/**
 * Apoyo en el detalle de un NDA firmado: el nombre de la identificación que subió la persona en el filtro contra el nombre con que firmó (se ve al abrir, sin IA) y, con un botón,
 * las dos firmas lado a lado (la del NDA y la de la identificación) con la opinión de la IA. Solo orientativo: no descarta ni cambia nada. Qué hace y por qué: docs/nda.md.
 */
export function NdaComprobacion({ envioId }: { envioId: string }) {
  const [datos, setDatos] = useState<Comprobacion | null>(null);
  const [error, setError] = useState(false);
  const [comparando, setComparando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDatos(null); setError(false);
    checkNDAIdentificacion({ envioId })
      .then((d: Comprobacion) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [envioId]);

  const comparar = async () => {
    setComparando(true);
    try {
      setDatos(await checkNDAIdentificacion({ envioId, conFirma: true }));
    } catch (e) {
      toast.error((e as Error).message || 'No se pudo comparar con la IA. Inténtalo de nuevo.');
    } finally { setComparando(false); }
  };

  return (
    <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed">
      <p className="font-medium text-foreground/70">Identificación</p>
      {!datos && !error && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Revisando…</p>}
      {error && <p className="text-muted-foreground">No se pudo revisar. Cierra y vuelve a abrir.</p>}
      {datos && !datos.disponible && <p className="text-muted-foreground">{datos.motivo}</p>}

      {datos?.disponible && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">Nombre en la identificación:</span>
            {datos.nombreIdentificacion && <span className="font-medium">{datos.nombreIdentificacion}</span>}
            {datos.nombre && <Etiqueta {...NOMBRE[datos.nombre]} />}
          </div>

          {datos.firma && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground">Firma en el NDA</figcaption>
                  <div className="flex h-24 items-center justify-center rounded-md border bg-white p-1">
                    <img src={datos.firma.firmaNda} alt="Firma dibujada en el NDA" className="max-h-full max-w-full object-contain" />
                  </div>
                </figure>
                <figure className="space-y-1">
                  <figcaption className="text-muted-foreground">Firma en la identificación</figcaption>
                  <div className="flex h-24 items-center justify-center rounded-md border bg-white p-1">
                    {datos.firma.firmaIdentificacion
                      ? <img src={datos.firma.firmaIdentificacion} alt="Firma recortada de la identificación" className="max-h-full max-w-full object-contain" />
                      : <span className="px-2 text-center text-muted-foreground">No se pudo recortar</span>}
                  </div>
                </figure>
              </div>
              <div className="flex items-start gap-2">
                <Etiqueta {...VEREDICTO[datos.firma.veredicto]} />
                {datos.firma.comentario && <p className="min-w-0 flex-1">{datos.firma.comentario}</p>}
              </div>
              <p className="text-muted-foreground">Opinión de la IA, solo de apoyo. No prueba quién firmó.</p>
            </div>
          )}

          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={comparando} onClick={() => void comparar()}>
            {comparando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
            {comparando ? 'Comparando…' : datos.firma ? 'Comparar de nuevo' : 'Comparar firmas con IA'}
          </Button>
        </>
      )}
    </div>
  );
}
