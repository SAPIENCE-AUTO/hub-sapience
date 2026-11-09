import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { sendNDAEmail } from 'zite-endpoints-sdk';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NdaPill } from '@/components/nda/NdaPill';
import { ayudaDe, clasificarParaLote, enviarEnLote, estadoVisible, type NdaDeFila, type ResultadoDeLote } from '@/lib/nda';

export interface PersonaDeLote { id: string; nombre: string; correo: string; ndaSent?: boolean }

type Fase = 'elegir' | 'enviando' | 'listo';

/**
 * Mandar el NDA a varias personas a la vez: las de un grupo (menú del grupo) o las que se seleccionaron en la tabla. La sesión (día, hora y lugar) es una sola para todas y
 * viene llena del evento del calendario al que está ligado el grupo. A quien ya firmó, rechazó o no tiene correo no se le puede mandar; a quien ya tiene un envío sin firmar o
 * está marcada a mano viene sin marcar. Los correos salen uno por uno por el mismo envío de siempre (sendNDAEmail), así que cada uno hace lo mismo que el botón «NDA» de la fila.
 * Guía: docs/nda.md.
 */
export function NdaLoteDialog({ open, onOpenChange, titulo, personas, ndaMap, sesionInicial, onTerminado }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Para quién es, en la frase «Enviar el NDA a …»: «el grupo «S1»», «las personas seleccionadas». */
  titulo: string;
  personas: PersonaDeLote[];
  ndaMap: Record<string, NdaDeFila>;
  sesionInicial: { fecha: string; lugar: string };
  /** Cuando termina el envío (aunque haya fallas): para volver a pedir los estados. */
  onTerminado: () => void;
}) {
  const clasificar = (p: PersonaDeLote) => clasificarParaLote({ correo: p.correo, ndaSent: p.ndaSent }, ndaMap[p.id]);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [sesion, setSesion] = useState(sesionInicial);
  const [errorSesion, setErrorSesion] = useState('');
  const [fase, setFase] = useState<Fase>('elegir');
  const [avance, setAvance] = useState({ hechos: 0, total: 0 });
  const [resultados, setResultados] = useState<ResultadoDeLote[]>([]);
  const detener = useRef(false);

  // Al abrir: vienen marcadas las personas a las que todavía no se les manda nada; la sesión, la del evento del grupo.
  useEffect(() => {
    if (!open) return;
    setMarcadas(new Set(personas.filter(p => clasificar(p).marcada).map(p => p.id)));
    setSesion(sesionInicial);
    setErrorSesion('');
    setFase('elegir');
    setResultados([]);
    setAvance({ hechos: 0, total: 0 });
    detener.current = false;
    // Solo al abrir: los estados se siguen refrescando mientras el cuadro está abierto y no deben cambiar lo que la persona ya marcó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ocupado = fase === 'enviando';
  const seleccion = personas.filter(p => marcadas.has(p.id) && clasificar(p).puede);
  const porNombre = new Map(personas.map(p => [p.id, p.nombre || p.correo]));

  const alternar = (id: string, v: boolean) => setMarcadas(prev => { const n = new Set(prev); if (v) n.add(id); else n.delete(id); return n; });

  const enviar = async () => {
    if (ocupado || seleccion.length === 0) return;
    if (!sesion.fecha) { setErrorSesion('Falta el día y la hora de la sesión.'); return; }
    detener.current = false;
    setFase('enviando');
    setAvance({ hechos: 0, total: seleccion.length });
    const r = await enviarEnLote(
      seleccion.map(p => p.id),
      id => sendNDAEmail({ id, sesion: { fecha: sesion.fecha, lugar: sesion.lugar.trim() || undefined } }),
      { alAvanzar: (hechos, total) => setAvance({ hechos, total }), detener: () => detener.current },
    );
    setResultados(r);
    setFase('listo');
    onTerminado();
  };

  const enviadas = resultados.filter(r => r.ok).length;
  const fallidas = resultados.filter(r => !r.ok && !r.omitido).length;
  const omitidas = resultados.filter(r => r.omitido).length;

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && ocupado) return; onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl" onInteractOutside={e => { if (ocupado) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{fase === 'listo' ? 'Listo' : <>Enviar el NDA a {titulo}</>}</DialogTitle>
          <DialogDescription>
            {fase === 'listo'
              ? `${enviadas === 1 ? 'Se mandó a 1 persona' : `Se mandó a ${enviadas} personas`}${fallidas ? ` · no se pudo a ${fallidas}` : ''}${omitidas ? ` · ${omitidas} sin mandar` : ''}.`
              : 'Cada persona recibe su correo con una liga personal para firmar.'}
          </DialogDescription>
        </DialogHeader>

        {fase !== 'listo' ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="nda-lote-sesion" className="mb-1 block text-sm font-medium">Día y hora de la sesión</label>
                <Input id="nda-lote-sesion" type="datetime-local" value={sesion.fecha} disabled={ocupado} aria-invalid={!!errorSesion}
                  onChange={e => { setSesion(s => ({ ...s, fecha: e.target.value })); setErrorSesion(''); }} />
                {errorSesion && <p className="mt-1 text-sm text-destructive">{errorSesion}</p>}
              </div>
              <div>
                <label htmlFor="nda-lote-lugar" className="mb-1 block text-sm font-medium">Lugar <span className="font-normal text-muted-foreground">(opcional)</span></label>
                <Input id="nda-lote-lugar" value={sesion.lugar} disabled={ocupado} maxLength={200} placeholder="En línea, la sede…"
                  onChange={e => setSesion(s => ({ ...s, lugar: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">{seleccion.length} de {personas.length} {personas.length === 1 ? 'persona' : 'personas'}</span>
                <span className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={ocupado}
                    onClick={() => setMarcadas(new Set(personas.filter(p => clasificar(p).marcada).map(p => p.id)))}>Solo las que faltan</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" disabled={ocupado} onClick={() => setMarcadas(new Set())}>Ninguna</Button>
                </span>
              </div>
              <ul className="max-h-72 divide-y overflow-auto rounded-md border">
                {personas.map(p => {
                  const c = clasificar(p);
                  const nda = ndaMap[p.id];
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox id={`nda-lote-${p.id}`} checked={c.puede && marcadas.has(p.id)} disabled={!c.puede || ocupado} onCheckedChange={v => alternar(p.id, v === true)} />
                      <label htmlFor={`nda-lote-${p.id}`} className={`min-w-0 flex-1 ${c.puede ? 'cursor-pointer' : 'cursor-default text-muted-foreground'}`}>
                        <span className="block truncate text-sm">{p.nombre || 'Sin nombre'}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.correo || '—'}</span>
                      </label>
                      <span className="flex flex-shrink-0 items-center gap-2">
                        {c.motivo === 'pendiente' && marcadas.has(p.id) && <span className="text-xs text-muted-foreground">se reenvía</span>}
                        {nda && <NdaPill estado={estadoVisible(nda)} title={ayudaDe(nda)} />}
                        {!nda && c.motivo === 'marcado' && <Badge variant="outline" className="border-green-300 text-xs text-green-700" title="Marcado a mano como enviado">NDA ✓</Badge>}
                        {c.motivo === 'sin-correo' && <span className="text-xs text-destructive">Sin correo</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <ul className="max-h-80 divide-y overflow-auto rounded-md border">
            {resultados.map(r => (
              <li key={r.id} className="flex items-start gap-2 px-3 py-2">
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" /> : r.omitido ? <MinusCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />}
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{porNombre.get(r.id)}</span>
                  {!r.ok && <span className="block text-xs text-muted-foreground">{r.mensaje}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {fase === 'listo' ? (
            <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
          ) : ocupado ? (
            <>
              <span className="mr-auto flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Enviando {Math.min(avance.hechos + 1, avance.total)} de {avance.total}…</span>
              <Button variant="outline" onClick={() => { detener.current = true; }}>Detener</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button disabled={seleccion.length === 0} onClick={() => void enviar()}>
                {seleccion.length === 0 ? 'Enviar' : seleccion.length === 1 ? 'Enviar a 1 persona' : `Enviar a ${seleccion.length} personas`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
